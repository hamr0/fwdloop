// POC copy of src/learn.js (v0.46.0 + B1) with three POC-only edits: c.endText ends the lesson sentence (plan notes), Fix touched is not rendered, What-changed lines over the char cap are dropped. Made for F80; never shipped.
// borrowed-from: bareloop src/learn.js@v0.46.0 (8b3d815)
// Adaptations: B1 (F79) flaggedText returns any non-empty trimmed line instead of null; redactSecrets imported from ./redact.js; line 17 names bareloop's proofs without its scratch path (E1 guard, test/m4d-am6-e.test.js). Nothing else changed.
// Cross-run learnings, CODE ONLY (ITEM33-BUILD.md "Addendum 2026-10-22 (rev 2)"; hamr's RULING 1: no model call
// anywhere in learnings — not to label, fold, rephrase, rank, judge or render). A lesson is a HINT made entirely by
// code from a run's own record: every field below is COPIED from the spine / gate audit, never written by a model.
//
// This module is PURE: no file IO, no clock reads (the caller injects `now`), and it imports nothing that can reach
// a provider (a static test walks its whole import closure). The thin reader/writer and the run-end call live in
// src/learnstore.js.
//
// Shape of the whole thing:
//   buildCards   one run's spine (+ gate audit) -> captioned cards (FIXED / NEVER FIXED), minus noise, suspect, thin
//   foldCards    when are two cards one lesson (same job + check + a shared error kind + 60% token overlap)
//   countLedger  fold a run's cards into the ONE ledger (+1 per run per row), climbing, decay
//   renderHints  the one function that turns the ledger into the block the PLANNER reads (2,000 chars, one render)
//
// Graduated from bareloop's own proofs (pocA2 candidates, pocC cards, pocE2 fold) as a REWRITE.
// The 60% threshold is FITTED on known cards (a fit, not a proof; the unseen-card proof is OPEN 2).

import { redactSecrets } from '../../src/redact.js';

// ── constants (every number here is a ruling, not a tuning knob) ─────────────────────────────────
/** The block the planner reads is never longer than this many characters (RULING 7). */
export const HINT_CHARS_MAX = 2000;
/** MEMORY filter only (hamr 2026-10-23): a row untouched this long is not handed to the planner. The ledger keeps every row. */
export const DECAY_DAYS = 56;
/** A rubric lesson waits this long for the human Accept, then is dropped uncounted (ruling 7, = the door TTL). */
export const PENDING_DAYS = 60;
/** Fold threshold on flagged-text token overlap (FITTED on 87 known cards — see section 1 of the addendum). */
export const JACCARD_MIN = 0.6;
/** Climbing: this many distinct workflows on one place -> place; this many distinct places -> user. */
export const CLIMB_AT = 3;
/** How many "It said" lines a card keeps. */
export const SAID_LINES = 3;
/** CHECK-SUSPECT cards are listed (not folded); the list keeps this many newest. */
export const SUSPECT_KEEP = 100;

const DAY_MS = 86_400_000;

/**
 * The no-suppressions tags an error kind may take (the closed list of `suppressions[].id` of the TYPES genre in
 * src/authoring.js; a test fails if the two drift apart). Anything else in a bracket is NOT a kind.
 */
export const ALLOWED_KINDS = Object.freeze([
  'ts-ignore', 'ts-expect-error', 'ts-nocheck', 'eslint-disable', 'any', 'any-star', 'cast', 'ignore', 'noqa', 'mypy-disable',
]);

// ── small text helpers ───────────────────────────────────────────────────────────────────────────
/** @param {unknown} v @returns {v is string} */
const isStr = (v) => typeof v === 'string' && v !== '';
/** @template T @param {T[]} a @returns {T[]} */
const uniq = (a) => [...new Set(a)];

/** Path prefixes of a patient / worktree / hidden-git tree: stripped from every quote so a card names `src/a.js`. */
// The two leading lookarounds on the first two add no match and drop none. A start that directly follows a whole path segment ("/seg") is covered by the
// start at that segment's "/" (the chain reads "/seg" and goes on to the same end), so it is skipped - unless that "/" is the last character of a
// previous match's tail, which the global scan has already consumed (the inner lookbehind). Without them a long "/a/a/a/..." with no marker is quadratic.
const PREFIXES = [
  /(?=\/)(?<!(?<!\/bareloop-patients\/[^/\s]+)\/[\w.@-]+)(?:\/[\w.@-]+)*\/bareloop-patients\/[^/\s]+\//g,
  /(?:(?=\/)|(?=\.bareloop\/wt\/))(?<!(?<!\.bareloop\/wt\/[^/\s]+)\/[\w.@-]+)(?:\/[\w.@-]+)*\.bareloop\/wt\/[^/\s]+\//g,
  /(?:\.\/)?out\/source-[^/\s]+\/tree\//g,
];

/**
 * Mask secrets and strip the working-tree prefix from a text. Pure.
 * @param {string} text @param {string|null} workdir
 * @returns {string}
 */
export function cleanText(text, workdir) {
  let s = redactSecrets(text);
  if (workdir) s = s.split(`${workdir}/`).join('');
  for (const r of PREFIXES) s = s.replace(r, '');
  return s;
}

/**
 * A card/audit path made relative to the run's tree, or null when it is not inside it. The workdir is the
 * authority; the patient-prefix shapes are the fallback for a spine read without one.
 * @param {string} abs @param {string|null} workdir
 * @returns {string|null}
 */
export function relPath(abs, workdir) {
  if (typeof abs !== 'string') return null;
  if (workdir && abs.startsWith(`${workdir}/`)) return abs.slice(workdir.length + 1);
  let s = abs;
  for (const r of PREFIXES) s = s.replace(r, '');
  return s.startsWith('/') ? null : s;
}

/**
 * Cut at a word / sentence edge, never mid-word where avoidable. Whitespace collapsed.
 * @param {unknown} text @param {number} n @returns {string}
 */
export function cutText(text, n) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const sl = s.slice(0, n - 1);
  const sp = sl.lastIndexOf(' ');
  return `${(sp >= n * 0.5 ? sl.slice(0, sp) : sl).replace(/[\s,;:]+$/, '')}…`;
}

/**
 * Deep-redact every string of a plain JSON value through the ONE secret inventory (a secret in a person's repo must
 * not enter an append-only record). Pure; returns a new value.
 * @template T @param {T} v @returns {T}
 */
export function redactDeep(v) {
  if (typeof v === 'string') return /** @type {any} */ (redactSecrets(v));
  if (Array.isArray(v)) return /** @type {any} */ (v.map((x) => redactDeep(x)));
  if (v && typeof v === 'object') {
    /** @type {Record<string, any>} */
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = redactDeep(x);
    return /** @type {any} */ (o);
  }
  return v;
}

// ── error kinds, flagged text, tokens (pocE2 keyOf / stripFlag, ported) ─────────────────────────
/** `any` inside a `{...}` JSDoc type position: a real type use, not prose. */
function anyInBrace(/** @type {string} */ t) {
  let d = 0;
  const re = /[{}]|\bany\b/g;
  let m;
  while ((m = re.exec(t))) {
    if (m[0] === '{') d += 1;
    else if (m[0] === '}') d = Math.max(0, d - 1);
    else if (d > 0) return true;
  }
  return false;
}

/**
 * The flagged text of ONE quote line (wrapper stripped), or null when the line is not a flagged line.
 * Flagged lines: `... added <id> - <text>` and `close: [<id>] <file>:<line>: <text>` (id in the allowed list), and
 * lines with `error TS<digits>:` or `error:`.
 * @param {string} line @returns {string|null}
 */
export function flaggedText(line) {
  let am = line.match(/: added ([a-z-]+) [—-] (.*)$/);
  if (am && ALLOWED_KINDS.includes(am[1])) return am[2];
  am = line.match(/^close:\s+\[([a-z-]+)\]\s+\S+?:\d+: (.*)$/);
  if (am && ALLOWED_KINDS.includes(am[1])) return am[2];
  if (/\berror TS\d+:|\berror:/.test(line)) {
    return line.replace(/^.*?\berror TS\d+:/, '').replace(/^.*?\berror:/, '').replace(/\[[a-z]+(?:-[a-z]+)*\]\s*$/, '');
  }
  // B1 (F79): a fwdloop gap line IS the check's red line, so any non-empty line is flagged text.
  return line.trim() !== '' ? line.trim() : null;
}

/**
 * The error-kind set of a quote: TS codes; `[id]` of `added <id>` and `close: [id]` lines; a mypy trailing bracket
 * code; empty -> `other`. Also the files named, the first symbol, and whether the card is CHECK-SUSPECT.
 * @param {string} text the (path-stripped) quote @param {string} [fullGap] the whole gap, for the suspect read
 * @returns {{kinds: string[], files: string[], symbol: string|null, suspect: boolean}}
 */
export function errorKinds(text, fullGap = text) {
  const kinds = [...text.matchAll(/\bTS\d+\b/g)].map((m) => m[0]);
  for (const line of text.split('\n')) {
    let am = line.match(/: added ([a-z-]+) [—-] (.*)$/);
    if (!am) am = line.match(/^close:\s+\[([a-z-]+)\]\s+\S+?:\d+: (.*)$/);
    if (am && ALLOWED_KINDS.includes(am[1])) kinds.push(`[${am[1]}]`);
    if (/\berror:/.test(line)) {
      const bm = line.match(/\[([a-z]+(?:-[a-z]+)*)\]\s*$/);
      if (bm) kinds.push(`[${bm[1]}]`);
    }
  }
  // CHECK-SUSPECT: a no-suppressions hit on `any`/`any-star` whose flagged text sits on a prose comment, not on a JSDoc
  // type position. Read over the WHOLE gap (the quote is only a display cut), so a prose hit past the cut still counts.
  let suspect = false;
  for (const line of fullGap.split('\n')) {
    let am = line.match(/: added ([a-z-]+) [—-] (.*)$/);
    if (!am) am = line.match(/^close:\s+\[([a-z-]+)\]\s+\S+?:\d+: (.*)$/);
    if (am && (am[1] === 'any' || am[1] === 'any-star') && /^(\/\/|\/\*|\*|#)/.test(am[2].trim()) && !anyInBrace(am[2])) suspect = true;
  }
  const kindSet = uniq(kinds).sort();
  if (!kindSet.length) kindSet.push('other');
  const files = uniq([...text.matchAll(PATH_RE)].map((m) => m[0].replace(/^\.\//, ''))).sort();
  const sm = text.match(/(?:Variable|Parameter|Property) '([^']+)'/) || text.match(/Name "([^"]+)"/) || text.match(/'([^']+)' is of type/);
  return { kinds: kindSet, files, symbol: sm ? sm[1] : null, suspect };
}

/**
 * The token set of a quote's flagged lines: lowercase runs of `[a-z0-9_]` of length >= 2, union over flagged lines.
 * File paths, line numbers, `added <id> -`, `error TS<n>:` and the trailing mypy code are already stripped.
 * @param {string} text @returns {string[]} sorted
 */
export function flaggedTokens(text) {
  const s = new Set();
  for (const line of text.split('\n')) {
    const t = flaggedText(line);
    if (t === null) continue;
    for (const m of t.toLowerCase().matchAll(/[a-z0-9_]{2,}/g)) s.add(m[0]);
  }
  return [...s].sort();
}

// ── cards ────────────────────────────────────────────────────────────────────────────────────────
/**
 * @typedef {object} Card
 * @property {string} id            `<runid>:<check>:<fixed|stuck>`
 * @property {string} runid
 * @property {string} at            the run's end (ISO)
 * @property {string} date          YYYY-MM-DD of `at`
 * @property {string} job           the workflow key
 * @property {string|null} model
 * @property {string} check         the check / close stage name
 * @property {'FIXED'|'NEVER_FIXED'} kind
 * @property {string} goal          Job (as written), cut
 * @property {string|null} stepId
 * @property {string|null} stepAction  Step (as planned), cut
 * @property {string|null} meaning  the check's own catalogue sentence (code-owned)
 * @property {string[]} said        It said: <= 3 lines, paths and prefixes stripped
 * @property {number} saidMore      lines left out
 * @property {string[]} kinds       error kinds, sorted; ['other'] when none
 * @property {string[]} files       files the quote names, sorted
 * @property {string|null} symbol
 * @property {string[]} tokens      the flagged-text token set, sorted
 * @property {string|null} nextCheck  the next failing check after this moment, if any
 * @property {string} ended         how the run ended (job-end outcome, or its escalation word)
 * @property {string[]} fixTouched  files written by the passing try (the try that followed the red, for NEVER FIXED)
 * @property {{files: {path: string, diff: string, truncated: boolean, cutLines?: number}[], binary: string[], truncated: boolean}|null} whatChanged
 *   the passing try's attempt-diff (FIXED only), as the spine capped it
 * @property {string} key           the one-line machine key
 */

/**
 * The one-line machine key of a card. Line numbers never appear in it.
 * @param {{id: string, job: string, check: string, kinds: string[], files: string[], model: string|null, runid: string, date: string}} c
 * @returns {string}
 */
export function cardKey(c) {
  return `card=${c.id} job=${c.job} check=${c.check} kinds=${c.kinds.join(',')} file=${c.files[0] ?? '-'} model=${c.model ?? '-'} run=${c.runid} date=${c.date}`;
}

/** the check name inside a gap text */
const nameOf = (/** @type {string} */ g) => (g.match(/check "([^"]+)"/)?.[1] ?? g.match(/close stage "([^"]+)"/)?.[1] ?? 'close');
const CODE = /\bTS\d+\b|\[[a-z][a-z-]+\]|\bE[A-Z]{2,}\b|\bERR_[A-Z_0-9]+\b/g;

/**
 * The lines of a gap a card quotes: lines that carry a path:line or an error code come first, accumulated up to
 * ~250 characters (the cut the fold was fitted on). Pure.
 * @param {string} gap @returns {string[]}
 */
export function quoteLines(gap) {
  const ls = gap.split('\n').filter((l) => l.trim());
  if (!ls.length) return [];
  const pri = ls.filter((l) => /\.\w+[:(]\d+/.test(l) || (l.match(CODE) || []).length);
  const pick = pri.length ? pri : ls;
  /** @type {string[]} */
  const out = [];
  let len = 0;
  for (const l of pick) {
    if (len + l.length + 1 > 250) break;
    out.push(l);
    len += l.length + 1;
  }
  if (!out.length) out.push(pick[0].slice(0, 250));
  return out;
}

/** terminal words that mean the run ended well */
const isGreen = (/** @type {unknown} */ o) => o === 'green' || o === 'already-green';
/** escalation categories that make a run NOISE: the instrument, not the work, failed */
const NOISE_CATEGORIES = new Set(['provider-red', 'close-crashed']);

/**
 * @typedef {object} CardBuild
 * @property {Card[]} cards         foldable cards (FIXED and NEVER FIXED), suspect and too-thin removed
 * @property {Card[]} suspect       CHECK-SUSPECT cards: listed, never folded
 * @property {number} thin          TOO-THIN count: no error kind and no fix files
 * @property {string|null} noise    why the whole run was set aside (provider-red, close-crashed, worker-crash, no-close-spoke, no-job-end), else null
 */

/**
 * Turn one run's record into cards. Every field is COPIED from the spine / gate audit; nothing is generated.
 *
 * Candidates: FIXED = a check red, then the SAME check passes later in the same run; NEVER FIXED = a check still red
 * at run end. At most one of each per check per run (the last red before the pass; the last red). Excluded, counted:
 * noise runs, CHECK-SUSPECT, TOO-THIN.
 *
 * Written files come from `attempt-diff` events (rubric `output/steps/<n>.json` included: the diff force-adds the
 * fence) and the REAL gate audit's allow write/edit rows relative to `workdir` — never `git status`, and never a
 * reader that drops a path it cannot place under a known patient prefix (the POC defect: a rubric job's writes read
 * as none).
 * `questions` is the check catalogue (stage name -> plain question, src/stagewords.js) the caller resolved from the signed
 * spec; a check with none reads `(not in the record)`.
 * @param {{runid: string, events: any[], audit?: any[]|null, workdir?: string|null, spec?: any, model?: string|null, questions?: Map<string, string|null>}} o
 * @returns {CardBuild}
 */
export function buildCards({ runid, events, audit = null, workdir = null, spec = null, model = null, questions = new Map() }) {
  const ev = (Array.isArray(events) ? events : []).filter((e) => e && typeof e === 'object');
  /** @type {CardBuild} */
  const out = { cards: [], suspect: [], thin: 0, noise: null };
  const jobEnd = ev.findLast((e) => e.type === 'job-end') ?? null;
  if (!jobEnd) { out.noise = 'no-job-end'; return out; }
  const jobStart = ev.find((e) => e.type === 'job-start' && isStr(e.goal)) ?? ev.find((e) => e.type === 'job-start') ?? null;
  const job = isStr(spec?.job) ? spec.job : (isStr(jobStart?.job) ? jobStart.job : null);
  if (job === null) { out.noise = 'no-job-start'; return out; }
  const runModel = model ?? (isStr(jobStart?.model) ? jobStart.model : null);
  const at = isStr(jobEnd.ts) ? jobEnd.ts : '';

  // ── the walk: stage verdicts, red moments, red->pass pairs (pocA2, indexes instead of timestamps) ──
  /** @type {Map<string, string>} */ const verdict = new Map();
  /** @type {Map<string, any>} */ const gaps = new Map();
  /** @type {Map<string, any>} */ const pend = new Map();
  /** @type {Map<string, {red: any, pass: {i: number, note: string|null}}>} */ const pairs = new Map();
  /** @type {{i: number, check: string}[]} */ const reds = [];
  /** @type {[number, any[]][]} */ const plans = [];
  /** @type {number[]} */ const iters = [];
  let curStep = null;
  let inFix = false;
  for (let i = 0; i < ev.length; i += 1) {
    const e = ev[i];
    if (e.type === 'plan-accepted' && Array.isArray(e.plan?.steps)) plans.push([i, e.plan.steps]);
    if (e.type === 'step-start') { curStep = isStr(e.step) ? e.step : null; inFix = false; }
    if (e.type === 'fix-loop') inFix = true;
    if (e.type === 'iteration-start') iters.push(i);
    const sat = (/** @type {string} */ name, /** @type {unknown} */ note) => {
      const g0 = pend.get(name);
      if (g0) { pairs.set(name, { red: g0, pass: { i, note: isStr(note) ? note : null } }); pend.delete(name); }
    };
    const red = (/** @type {string} */ name, /** @type {any} */ g) => { pend.set(name, { ...g, i }); reds.push({ i, check: name }); };
    if (e.type === 'check-run' && isStr(e.name)) {
      verdict.set(e.name, e.verdict);
      if (e.verdict === 'satisfied') sat(e.name, null);
    }
    if (e.type === 'close-verdict' || e.type === 'outer-close') {
      const stageScoped = e.type === 'outer-close' || inFix;
      if (Array.isArray(e.stages)) {
        for (const st of e.stages) {
          if (st && isStr(st.name)) {
            verdict.set(st.name, st.verdict);
            if (st.verdict === 'satisfied') sat(st.name, st.notes);
          }
        }
      }
      if (isStr(e.gap)) {
        const n = nameOf(e.gap);
        if (n === 'close' && !Array.isArray(e.stages)) verdict.set('close', e.verdict);
        const gg = { gap: e.gap, step: stageScoped ? null : curStep, seq: e.seq };
        gaps.set(n, gg);
        red(n, gg);
      } else if (!Array.isArray(e.stages)) {
        verdict.set('close', e.verdict);
        if (e.verdict === 'satisfied') sat('close', null);
      }
    }
    if (e.type === 'exit-eval') {
      for (const r of e.results || []) {
        if (!r || typeof r !== 'object') continue;
        if (r.type === 'check-passes') {
          if (r.pass === false && isStr(r.detail)) {
            const gg = { gap: r.detail, step: isStr(e.step) ? e.step : curStep, seq: e.seq };
            gaps.set(nameOf(r.detail), gg);
            red(nameOf(r.detail), gg);
          }
        } else if (isStr(r.type)) {
          if (r.pass === true) { verdict.set(r.type, 'satisfied'); sat(r.type, null); }
          else if (r.pass === false) {
            verdict.set(r.type, 'needs_revision');
            if (isStr(r.detail)) {
              const gg = { gap: r.detail, step: isStr(e.step) ? e.step : curStep, seq: e.seq };
              gaps.set(r.type, gg);
              red(r.type, gg);
            }
          }
        }
      }
    }
  }

  // ── noise runs: the instrument failed, so no lesson about the work can be read off them ──
  const lastEsc = ev.findLast((e) => e.type === 'escalation') ?? null;
  const cat = lastEsc && isStr(lastEsc.category) ? lastEsc.category : null;
  if (cat !== null && NOISE_CATEGORIES.has(cat)) { out.noise = cat; return out; }
  if (verdict.size === 0) { out.noise = cat === 'worker-crash' ? 'worker-crash' : 'no-close-spoke'; return out; }

  const ended = isGreen(jobEnd.outcome) ? String(jobEnd.outcome) : (cat ?? (isStr(jobEnd.outcome) ? jobEnd.outcome : 'ended'));
  const goal = isStr(jobStart?.goal) ? cutText(cleanText(jobStart.goal, workdir), 200) : '(not in the record)';
  const date = at.slice(0, 10);

  const writtenIn = (/** @type {{fromI: number, toI: number}} */ w) => {
    /** @type {string[]} */
    const files = [];
    let diff = null;
    for (let k = w.fromI; k <= w.toI && k < ev.length; k += 1) {
      const e = ev[k];
      if (e.type === 'attempt-diff') {
        diff = e;
        for (const f of e.files || []) if (f && isStr(f.path)) files.push(f.path);
        for (const b of e.binary || []) if (isStr(b)) files.push(b);
      }
    }
    if (Array.isArray(audit)) {
      const t0 = Date.parse(ev[w.fromI]?.ts ?? '');
      const t1 = Date.parse(ev[Math.min(w.toI, ev.length - 1)]?.ts ?? '');
      if (Number.isFinite(t0) && Number.isFinite(t1)) {
        for (const a of audit) {
          if (!a || a.phase !== 'gate' || a.decision !== 'allow') continue;
          if (a.action?.type !== 'write' && a.action?.type !== 'edit') continue;
          const t = Date.parse(a.ts ?? '');
          if (!Number.isFinite(t) || t < t0 || t > t1 + 1000) continue;
          const p = relPath(a.action.path, workdir);
          if (p !== null) files.push(p);
        }
      }
    }
    return { files: uniq(files), diff };
  };

  /**
   * @param {string} check @param {any} g the red moment @param {'FIXED'|'NEVER_FIXED'} kind
   * @param {{i: number, note: string|null}|null} pass
   */
  const mk = (check, g, kind, pass) => {
    const lines = quoteLines(String(g.gap)).map((l) => cleanText(l, workdir));
    const quote = lines.join('\n');
    const full = cleanText(String(g.gap), workdir);
    const k = errorKinds(quote, full);
    // Step (as planned): the failing step's action text in the plan live at that moment
    const stepId = isStr(g.step) ? g.step : null;
    const plan = plans.filter(([pi]) => pi <= g.i).at(-1) ?? plans.at(-1) ?? null;
    const step = stepId && plan ? plan[1].find((x) => x?.id === stepId) : null;
    const stepAction = isStr(step?.action) ? cutText(cleanText(step.action, workdir), 300) : null;
    // the passing try (FIXED) / the try that followed the red (NEVER FIXED)
    let w;
    if (kind === 'FIXED' && pass) {
      const start = Math.max(iters.filter((x) => x <= pass.i).at(-1) ?? 0, g.i + 1);
      w = { fromI: start, toI: pass.i };
    } else {
      const start = iters.find((x) => x > g.i);
      const end = start === undefined ? -1 : (iters.find((x) => x > start) ?? ev.length) - 1;
      w = start === undefined ? { fromI: 0, toI: -1 } : { fromI: start, toI: end };
    }
    const wr = writtenIn(w);
    const fixTouched = wr.files.map((p) => cleanText(p, workdir));
    const diffEv = kind === 'FIXED' ? wr.diff : null;
    const afterI = kind === 'FIXED' && pass ? pass.i : g.i;
    const nextRed = reds.find((r) => r.i > afterI && r.check !== check);
    const said = lines.map((l) => l.replace(/^\s*close:\s*/, '').replace(/^[A-Z][A-Z0-9_-]* \| /, '').trim())
      .filter((l) => l && !/^(check ".*" red: )?close stage ".*" failed:$/.test(l));
    const id = `${runid}:${check}:${kind === 'FIXED' ? 'fixed' : 'stuck'}`;
    const base = {
      id, runid, at, date, job, model: runModel, check, kind, goal,
      stepId, stepAction,
      meaning: questions.get(check) ?? (check === 'tree-changed' ? 'did the step change a file in its scope?' : check === 'close' ? "does the job's close pass?" : null),
      said: said.slice(0, SAID_LINES).map((l) => cutText(l, 220)), saidMore: Math.max(0, said.length - SAID_LINES),
      kinds: k.kinds, files: k.files, symbol: k.symbol, tokens: flaggedTokens(quote),
      nextCheck: nextRed ? nextRed.check : null, ended,
      fixTouched,
      whatChanged: diffEv
        ? {
          files: (diffEv.files || []).map((/** @type {any} */ f) => ({ path: String(f.path), diff: String(f.diff ?? ''), truncated: f.truncated === true, ...(Number.isInteger(f.cutLines) ? { cutLines: f.cutLines } : {}) })),
          binary: (diffEv.binary || []).map(String),
          truncated: diffEv.truncated === true,
        }
        : null,
    };
    /** @type {Card} */
    const card = redactDeep({ ...base, key: cardKey(base) });
    return { card, suspect: k.suspect };
  };

  /** @type {Card[]} */ const all = [];
  /** @type {Card[]} */ const sus = [];
  const push = (/** @type {{card: Card, suspect: boolean}} */ r) => {
    if (r.suspect) sus.push(r.card);
    else if (r.card.kind === 'FIXED' && r.card.kinds[0] === 'other' && r.card.fixTouched.length === 0) out.thin += 1;
    else all.push(r.card);
  };
  for (const [check, p] of pairs) push(mk(check, p.red, 'FIXED', p.pass));
  for (const [check, g] of gaps) {
    const v = verdict.get(check);
    if (v === 'satisfied') continue;
    if (v !== undefined || check === 'close') push(mk(check, pend.get(check) ?? { ...g, i: reds.findLast((r) => r.check === check)?.i ?? 0 }, 'NEVER_FIXED', null));
  }
  out.cards = all;
  out.suspect = sus;
  return out;
}

// ── fold ─────────────────────────────────────────────────────────────────────────────────────────
/** @param {{kinds: string[]}} a @param {{kinds: string[]}} b */
export function sharedKind(a, b) {
  return a.kinds[0] !== 'other' && b.kinds[0] !== 'other' && a.kinds.some((x) => b.kinds.includes(x));
}

/**
 * Do two cards agree on kind? A shared error code / kind, OR (RULED 2026-10-23 R1) both carry NO code (`other`) and both
 * have a non-empty flagged-text token set, so the text rule alone decides. A coded card never matches a code-less one.
 * The 60% was fitted on cards WITH codes; the code-less use is UNTESTED on real data.
 * @param {{kinds: string[], tokens: string[]}} a @param {{kinds: string[], tokens: string[]}} b
 */
export function kindAgrees(a, b) {
  if (sharedKind(a, b)) return true;
  return a.kinds[0] === 'other' && b.kinds[0] === 'other' && a.tokens.length > 0 && b.tokens.length > 0;
}

/** Jaccard of two token arrays; an empty side scores 0. @param {string[]} a @param {string[]} b */
export function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  let n = 0;
  for (const x of a) if (sb.has(x)) n += 1;
  return n / (a.length + b.length - n);
}

/**
 * Are two cards one lesson? Same check, kinds that agree ({@link kindAgrees}: a shared code, or both code-less with text
 * on both sides) and Jaccard >= 60% on flagged-text tokens. `sameJob: false` drops the job test (RULING 1: the cross-job rule for climbing).
 * @param {Card} a @param {Card} b @param {{sameJob?: boolean}} [o]
 * @returns {{match: boolean, score: number}}
 */
export function cardsMatch(a, b, { sameJob = true } = {}) {
  if ((sameJob && a.job !== b.job) || a.check !== b.check || !kindAgrees(a, b)) return { match: false, score: 0 };
  const score = jaccard(a.tokens, b.tokens);
  return { match: score >= JACCARD_MIN, score };
}

/**
 * Group cards into lessons: single-link components over eligible pairs; every pair INSIDE a component is re-checked
 * for a shared kind, and a component with any pair lacking one splits back to singletons.
 * @param {Card[]} cards
 * @returns {Card[][]} groups, in first-card order; each group in input order
 */
export function foldCards(cards) {
  const n = cards.length;
  const par = cards.map((_, i) => i);
  const find = (/** @type {number} */ x) => { let r = x; while (par[r] !== r) r = par[r]; par[x] = r; return r; };
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) if (cardsMatch(cards[i], cards[j]).match) par[find(i)] = find(j);
  /** @type {Map<number, number[]>} */
  const comps = new Map();
  for (let i = 0; i < n; i += 1) { const r = find(i); comps.set(r, [...(comps.get(r) ?? []), i]); }
  /** @type {Card[][]} */
  const groups = [];
  for (const m of comps.values()) {
    let ok = true;
    for (let a = 0; a < m.length && ok; a += 1) for (let b = a + 1; b < m.length; b += 1) if (!kindAgrees(cards[m[a]], cards[m[b]])) { ok = false; break; }
    if (ok) groups.push(m.map((i) => cards[i]));
    else for (const i of m) groups.push([cards[i]]);
  }
  return groups.sort((x, y) => cards.indexOf(x[0]) - cards.indexOf(y[0]));
}

// ── the ledger ───────────────────────────────────────────────────────────────────────────────────
/**
 * @typedef {object} Row
 * @property {string} id
 * @property {string} lesson        ONE sentence, template-only (see {@link lessonOf})
 * @property {number} count         runs seen; STARTS AT 1
 * @property {Card} sample          the LATEST card
 * @property {Record<string, number>} models  per-model counts (read-only information; never a filter)
 * @property {string} workflow
 * @property {string|null} place
 * @property {'workflow'|'place'|'user'} level  STORED as 'workflow' only; the level a reader sees is derived by {@link readableRows} from the rows memory still shows (an older file's stored value is ignored and reset on the next write)
 * @property {'deterministic'|'rubric'} trust
 * @property {string[]} runIds
 * @property {string} firstSeen
 * @property {string} lastSeen
 * @property {string|null} specHash  the signed hash the lesson was last seen under (a workflow row of another hash is never matched or read)
 * @property {string} key           check + sorted kinds (job-independent); information only since R2 removed the check-wide set-aside
 */
/**
 * @typedef {object} Pending
 * @property {string} runid @property {string} at @property {string} workflow @property {string|null} place
 * @property {string|null} specHash @property {Card[]} cards
 */
/**
 * @typedef {object} Ledger
 * @property {1} version
 * @property {Row[]} rows
 * @property {Pending[]} pending     rubric cards held until a human Accept (NOT counted, NOT readable)
 * @property {Card[]} suspect        CHECK-SUSPECT cards, listed, newest last
 * @property {Record<string, {at: string, noise: string|null, cards: number, suspect: number, thin: number}>} health  per run (idempotent by run id)
 */

/** @returns {Ledger} */
export function emptyLedger() {
  return { version: 1, rows: [], pending: [], suspect: [], health: {} };
}

/** The job-independent key of a card: check + sorted kinds. @param {{check: string, kinds: string[]}} c */
export const keyOfCard = (c) => `${c.check}|${[...c.kinds].sort().join(',')}`;

/**
 * ONE sentence, rendered by code from the card's own fields (RULING 5, template-only).
 * @param {Card} c @returns {string}
 */
export function lessonOf(c) {
  const what = c.meaning ? ` (${c.meaning.replace(/[?.]+$/, '')})` : '';
  const kinds = c.kinds[0] === 'other' ? '' : ` on ${c.kinds.join(' ')}`;
  const file = c.files[0] ? ` in ${c.files.slice(0, 3).join(', ')}${c.files.length > 3 ? ` +${c.files.length - 3} more` : ''}` : '';
  const end = c.endText ?? (c.kind === 'FIXED' ? 'fixed later in the same run' : 'got stuck here, never fixed');
  return `check "${c.check}"${what} failed${kinds}${file}; ${end}.`;
}

const stem = (/** @type {string|undefined} */ f) => (f ?? '').split('/').at(-1)?.replace(/\.[^.]+$/, '') ?? '';

/** Stable row id from the fold's shared fields: job + check + kinds + file stem. @param {Card} c */
function rowId(c) {
  return [c.job, c.check, [...c.kinds].sort().join('+'), stem(c.files[0]) || '-'].join('~').replace(/[^\w~+.@-]+/g, '_');
}

/**
 * Memory filter: is this row older than 56 days at `now`? Decided from `lastSeen` alone, read-time, never stored.
 * @param {Row} r @param {Date} now
 */
export const isDecayed = (r, now) => { const t = Date.parse(r.lastSeen); return Number.isFinite(t) && now.getTime() - t > DECAY_DAYS * DAY_MS; };

/**
 * Is this workflow row from another job version (a different signed hash than this run's)? Decided from the stored
 * `specHash`, read-time, never stored. Unknown hash on either side is the same version.
 * @param {Row} r @param {string} workflow @param {string|null} specHash
 */
export const otherJobVersion = (r, workflow, specHash) => r.level === 'workflow' && r.workflow === workflow && r.specHash !== null && specHash !== null && r.specHash !== specHash;

/** Drop the retired stored `status`/`expiredBy` fields an older ledger file may carry, and reset a stored `level` (never read; stripped on the next write). @param {Row} r */
const stripLegacy = (r) => { const { status: _s, expiredBy: _e, ...rest } = /** @type {Row & {status?: unknown, expiredBy?: unknown}} */ (r); return /** @type {Row} */ ({ ...rest, level: 'workflow' }); };

/** Rank order for matching and reading: highest count, most recent lastSeen, then id. */
const byRank = (/** @type {Row} */ a, /** @type {Row} */ b) => b.count - a.count || (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Fold ONE run's cards into the ledger. Pure: returns a new ledger.
 *
 * +1 per RUN per row: the run's own cards are folded into lessons first, and a row whose `runIds` already holds the
 * run id is never counted twice (a resumed run, one id, never double counts). A matching lesson replaces the row's
 * sample, bumps the model count and appends the run id (a row last seen 56+ days ago counts +1 and is read again);
 * otherwise it opens a new row at count 1. NEVER FIXED cards count like FIXED ones (RULING 3). A workflow row of
 * another signed hash is never matched here: the new version opens its own rows. Nothing is ever deleted or stamped.
 * @param {Ledger} ledger
 * @param {{runid: string, cards: Card[], workflow: string, place: string|null, specHash: string|null, trust: 'deterministic'|'rubric', now: Date}} o
 * @returns {Ledger}
 */
export function countLedger(ledger, { runid, cards, workflow, place, specHash, trust, now }) {
  const rows = ledger.rows.map((r) => ({ ...stripLegacy(r), runIds: [...r.runIds], models: { ...r.models } }));
  for (const group of foldCards(cards)) {
    const rep = group.reduce((a, c) => (c.at >= a.at ? c : a));
    const hit = [...rows].sort(byRank).find((r) => r.workflow === workflow && !otherJobVersion(r, workflow, specHash) && cardsMatch(rep, r.sample).match);
    if (hit) {
      if (hit.runIds.includes(runid)) continue;
      hit.count += 1;
      hit.models[rep.model ?? 'unknown'] = (hit.models[rep.model ?? 'unknown'] ?? 0) + 1;
      hit.runIds.push(runid);
      hit.sample = rep;
      hit.lesson = lessonOf(rep);
      hit.key = keyOfCard(rep);
      hit.lastSeen = rep.at;
      hit.specHash = specHash;
      hit.place = place ?? hit.place;
    } else {
      let id = rowId(rep);
      for (let n = 2; rows.some((r) => r.id === id); n += 1) id = `${rowId(rep)}-${n}`;
      rows.push({
        id, lesson: lessonOf(rep), count: 1, sample: rep, models: { [rep.model ?? 'unknown']: 1 }, workflow, place, level: 'workflow',
        trust, runIds: [runid], firstSeen: rep.at, lastSeen: rep.at, specHash, key: keyOfCard(rep),
      });
    }
  }
  return finish({ ...ledger, rows }, now);
}

/**
 * Recompute the derived parts after any change: pending expiry. Ledger rows are never aged out or deleted, and carry no
 * climbed level (that is decided at read time, see {@link readableRows}).
 * @param {Ledger} L @param {Date} now @returns {Ledger}
 */
function finish(L, now) {
  const rows = L.rows.map(stripLegacy);
  return {
    ...L,
    rows: rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    pending: L.pending.filter((p) => now.getTime() - Date.parse(p.at) <= PENDING_DAYS * DAY_MS),
  };
}

const LEVEL_RANK = { workflow: 0, place: 1, user: 2 };

/**
 * Climbing (RULING 1): the same lesson across workflows — the section-3 rule with "same job" dropped — seen in 3
 * distinct workflows on one place climbs to `place`; in 3 distinct places, to `user`. Derived from the rows handed in
 * alone (every row starts at `workflow`, a stored level is ignored): {@link readableRows} hands it only the rows memory
 * still shows, so a level drops back when siblings age out. Returns copies; keeps every run id.
 * @param {Row[]} rows @returns {Row[]}
 */
export function climb(rows) {
  const n = rows.length;
  const par = rows.map((_, i) => i);
  const find = (/** @type {number} */ x) => { let r = x; while (par[r] !== r) r = par[r]; par[x] = r; return r; };
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) if (cardsMatch(rows[i].sample, rows[j].sample, { sameJob: false }).match) par[find(i)] = find(j);
  /** @type {Map<number, number[]>} */
  const fam = new Map();
  for (let i = 0; i < n; i += 1) { const r = find(i); fam.set(r, [...(fam.get(r) ?? []), i]); }
  /** @type {Row[]} */
  const out = rows.map((r) => ({ ...r, level: 'workflow' }));
  for (const idx of fam.values()) {
    if (idx.length < CLIMB_AT) continue;
    /** @type {Map<string, Set<string>>} */
    const perPlace = new Map();
    for (const i of idx) {
      const p = rows[i].place;
      if (p !== null) perPlace.set(p, (perPlace.get(p) ?? new Set()).add(rows[i].workflow));
    }
    for (const i of idx) {
      const p = rows[i].place;
      /** @type {'workflow'|'place'|'user'} */
      let level = out[i].level;
      if (p !== null && (perPlace.get(p)?.size ?? 0) >= CLIMB_AT && LEVEL_RANK[level] < LEVEL_RANK.place) level = 'place';
      if (perPlace.size >= CLIMB_AT && LEVEL_RANK[level] < LEVEL_RANK.user) level = 'user';
      out[i].level = level;
    }
  }
  return out;
}

/**
 * A rubric run's cards are HELD, not counted, until a human Accept (the existing quarantine is the rule). Replaces
 * an earlier hold for the same run id (a resumed run re-derives its cards). Pure.
 * @param {Ledger} ledger
 * @param {{runid: string, cards: Card[], workflow: string, place: string|null, specHash: string|null, at: string}} o
 * @param {Date} now @returns {Ledger}
 */
export function holdPending(ledger, { runid, cards, workflow, place, specHash, at }, now) {
  const pending = ledger.pending.filter((p) => p.runid !== runid);
  if (cards.length) pending.push({ runid, at, workflow, place, specHash, cards });
  return finish({ ...ledger, pending }, now);
}

/**
 * The human Accept releases a held rubric run: its cards count now (trust `rubric`). Only forward, only here. A hold
 * older than 60 days is dropped uncounted. Idempotent (no hold = nothing to do; run ids stop a double count).
 * @param {Ledger} ledger @param {string} runid @param {Date} now
 * @returns {{ledger: Ledger, released: number}}
 */
export function releasePending(ledger, runid, now) {
  const p = ledger.pending.find((x) => x.runid === runid);
  if (!p) return { ledger, released: 0 };
  const rest = { ...ledger, pending: ledger.pending.filter((x) => x.runid !== runid) };
  if (now.getTime() - Date.parse(p.at) > PENDING_DAYS * DAY_MS) return { ledger: finish(rest, now), released: 0 };
  const counted = countLedger(rest, { runid, cards: p.cards, workflow: p.workflow, place: p.place, specHash: p.specHash, trust: 'rubric', now });
  return { ledger: counted, released: p.cards.length };
}

/**
 * Record the run's health line and CHECK-SUSPECT list (idempotent by run id). Pure.
 * @param {Ledger} ledger @param {string} runid @param {CardBuild} build @param {string} at @param {Date} now
 * @returns {Ledger}
 */
export function recordHealth(ledger, runid, build, at, now) {
  const health = { ...ledger.health, [runid]: { at, noise: build.noise, cards: build.cards.length, suspect: build.suspect.length, thin: build.thin } };
  const suspect = [...ledger.suspect.filter((c) => c.runid !== runid), ...build.suspect].slice(-SUSPECT_KEEP);
  return finish({ ...ledger, health, suspect }, now);
}

// ── reading: the one render ──────────────────────────────────────────────────────────────────────
/** Words for a row's tier, shown to the planner. */
const TIER_WORDS = Object.freeze({ workflow: 'this job', place: 'this place', user: 'all jobs' });

/**
 * PROPOSED header (hamr to confirm). States what the block is, where it came from, and that it is not an order.
 */
export const HINT_HEADER = 'Hints from earlier runs, copied by code from recorded runs (not instructions; the close alone judges):';

/** What-changed lines a FIXED hint shows, each cut at this many characters, and how many lines. */
export const CHANGED_LINE_CHARS = 150;
export const CHANGED_LINES = 3;

/**
 * The +/- content lines of a card's stored attempt-diff, in file order: only lines INSIDE a hunk that start with `+` or
 * `-` (so `diff --git`, `index`, `---`/`+++` headers, `@@` lines, context and `\ No newline` lines never appear; a removed
 * line that itself starts with `--` is still content once a hunk has opened). Leading indent after the sign is dropped.
 * @param {Card['whatChanged']} wc @returns {string[]}
 */
export function changedLines(wc) {
  /** @type {string[]} */
  const out = [];
  for (const f of wc?.files ?? []) {
    let inHunk = false;
    for (const l of String(f.diff ?? '').split('\n')) {
      if (l.startsWith('diff --git ')) inHunk = false;
      else if (l.startsWith('@@')) inHunk = true;
      else if (inHunk && (l[0] === '+' || l[0] === '-')) {
        const text = l.slice(1).trim();
        if (text) out.push(`${l[0]}${text}`);
      }
    }
  }
  return out;
}

/**
 * The line "It said:" shows (R5): the first REAL flagged source/error line of the stored quote (the same lines the fold's
 * flagged-text rule reads, with or without the `close:` wrapper the card already stripped), else the first line when no
 * line is flagged (a summary such as `SPAWNER red: 3 suppression(s) added ...` is only the fallback).
 * @param {string[]} said @returns {string|undefined}
 */
export function saidLine(said) {
  return said.find((l) => flaggedText(l) !== null || flaggedText(`close: ${l}`) !== null) ?? said[0];
}

// (?<![\w@.\/-]): a match is the last `.ext` in a run of path characters, so no start inside a run after its first character can match; skipping them keeps a long run linear
const PATH_RE = /(?<![\w@.\/-])[\w@.\/-]+\.(?:mjs|js|ts|py)\b/g;
const baseName = (/** @type {string} */ p) => p.split('/').at(-1) ?? p;

/**
 * Shorten file paths in a text (R5): a path already shown in full earlier in the SAME hint (`shown`, filled in reading
 * order) is written by its basename; a first mention stays as written. Pure apart from filling `shown`.
 * @param {string} text @param {Set<string>} shown @returns {string}
 */
function shortenPaths(text, shown) {
  return text.replace(PATH_RE, (p) => {
    if (shown.has(p) && p.includes('/')) return baseName(p);
    shown.add(p);
    return p;
  });
}

/** One hint, whole. @param {Row} r @param {number} n */
function hintText(r, n) {
  const c = r.sample;
  /** @type {Set<string>} */
  const shown = new Set();
  const lesson = `${n}. [${TIER_WORDS[r.level]}, seen ${r.count} time${r.count === 1 ? '' : 's'}] ${r.lesson}`;
  for (const p of lesson.match(PATH_RE) ?? []) shown.add(p);
  const L = [lesson];
  const said = saidLine(c.said);
  if (said) L.push(`   It said: ${cutText(shortenPaths(said, shown), 150)}`);
  if (false && c.kind === 'FIXED' && c.fixTouched.length) {
    const touched = c.fixTouched.slice(0, 4).map((p) => { const out = shown.has(p) && p.includes('/') ? baseName(p) : p; shown.add(p); return out; });
    L.push(`   Fix touched: ${touched.join(', ')}${c.fixTouched.length > 4 ? ` +${c.fixTouched.length - 4} more` : ''}${c.fixTouched.length >= 2 && c.fixTouched.length <= 4 ? ' (changed together)' : ''}`);
  }
  if (c.kind === 'FIXED') {
    const ch = changedLines(c.whatChanged).filter((l) => l.length <= CHANGED_LINE_CHARS);
    if (ch.length) {
      const pad = ' '.repeat('   What changed: '.length);
      const show = ch.slice(0, CHANGED_LINES).map((l) => (l.length > CHANGED_LINE_CHARS ? `${l.slice(0, CHANGED_LINE_CHARS - 1)}…` : l));
      if (ch.length > CHANGED_LINES) show.push(`(+${ch.length - CHANGED_LINES} more)`);
      L.push(`   What changed: ${show[0]}`, ...show.slice(1).map((l) => `${pad}${l}`));
    }
  }
  return L.join('\n');
}

/**
 * Which rows may be read for this job, in reading order (THE memory filter; the ledger itself keeps every row).
 * Excluded: pending rows, any row last seen more than 56 days ago, any row with no run id, a workflow row of another
 * job or of another signed hash, a place row of another place. The level (this job / this place / all jobs) is
 * derived HERE by {@link climb} over the rows not decayed at `now` only; the stored level is never read.
 * Order: this job's, then this place's, then all-jobs LAST (R2: climbing wins, so an all-jobs hint only uses leftover
 * room); inside each level highest count first (ties: most recent lastSeen, then id), so the order is total and stable.
 * @param {Ledger} ledger @param {{workflow: string, place: string|null, specHash?: string|null, now: Date}} o
 * @returns {Row[]}
 */
export function readableRows(ledger, { workflow, place, specHash = null, now }) {
  return climb(ledger.rows.filter((r) => !isDecayed(r, now))).filter((r) => {
    if (r.runIds.length === 0) return false;
    if (r.level === 'workflow') return r.workflow === workflow && !otherJobVersion(r, workflow, specHash);
    if (r.level === 'place') return place !== null && r.place === place;
    return true;
  }).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || byRank(a, b));
}

/**
 * THE one render: the block the PLANNER reads at draft and at the first replan. Byte-for-byte reproducible from the
 * ledger as it stood. Stops at 2,000 characters; a hint is added whole or not at all; nothing readable -> empty text.
 * @param {Ledger} ledger @param {{workflow: string, place: string|null, specHash?: string|null, now: Date}} o
 * @returns {{text: string, ids: string[]}}
 */
export function renderHints(ledger, o) {
  /** @type {string[]} */
  const ids = [];
  let text = HINT_HEADER;
  for (const r of readableRows(ledger, o)) {
    const next = `${text}\n${hintText(r, ids.length + 1)}`;
    if (next.length > HINT_CHARS_MAX) break;
    text = next;
    ids.push(r.id);
  }
  return ids.length ? { text, ids } : { text: '', ids: [] };
}

/**
 * @typedef {object} HintParts one hint of a rendered block, split back into its fields (for the panel's Audit view)
 * @property {number} n the hint's number in the block
 * @property {string} level 'this job' | 'this place' | 'all jobs' (the words {@link renderHints} wrote)
 * @property {number} count how many runs saw it
 * @property {string} check the check's name
 * @property {string[]} kinds the error codes (empty when the hint names none)
 * @property {boolean} fixed true = fixed later in the same run, false = never fixed
 * @property {string|null} said the "It said" line
 * @property {string|null} touched the "Fix touched" text
 * @property {string[]} changed the shown What-changed lines (+/- lines), without the "(+N more)" line
 * @property {number} moreChanged N of "(+N more)", 0 when absent
 */

const HINT_HEAD_RE = /^(\d+)\. \[(this job|this place|all jobs), seen (\d+) times?\] (.*)$/;

/**
 * Split a block {@link renderHints} wrote back into its hints. The ONLY reader of that text: it lives beside the
 * writer ({@link hintText}, {@link lessonOf}) and a test renders real blocks and parses them back. A hint it cannot
 * read is returned with what it could read (never thrown, never invented). Pure.
 * @param {string} text @returns {HintParts[]}
 */
export function parseHintBlock(text) {
  /** @type {HintParts[]} */
  const out = [];
  /** @type {HintParts|null} */
  let cur = null;
  let inChanged = false;
  for (const line of String(text).split('\n')) {
    const m = HINT_HEAD_RE.exec(line);
    if (m) {
      const lesson = m[4];
      const check = /^check "([^"]*)"/.exec(lesson)?.[1] ?? '';
      const kinds = /(?:"|\)) failed on (.+?)(?: in |;)/.exec(lesson)?.[1]?.split(' ') ?? [];
      cur = { n: Number(m[1]), level: m[2], count: Number(m[3]), check, kinds, fixed: /; fixed later in the same run\.$/.test(lesson), said: null, touched: null, changed: [], moreChanged: 0 };
      out.push(cur);
      inChanged = false;
    } else if (cur && line.startsWith('   It said: ')) { cur.said = line.slice('   It said: '.length); inChanged = false; }
    else if (cur && line.startsWith('   Fix touched: ')) { cur.touched = line.slice('   Fix touched: '.length); inChanged = false; }
    else if (cur && line.startsWith('   What changed: ')) { inChanged = true; cur.changed.push(line.slice('   What changed: '.length)); }
    else if (cur && inChanged && line.startsWith(' '.repeat('   What changed: '.length))) {
      const t = line.slice('   What changed: '.length);
      const more = /^\(\+(\d+) more\)$/.exec(t);
      if (more) cur.moreChanged = Number(more[1]); else cur.changed.push(t);
    }
  }
  return out;
}

// ── the place of a job ───────────────────────────────────────────────────────────────────────────
/**
 * Where a job lives, derived by code from the signed spec's inputs line 1: a website job = the URL host; a repo or
 * plain folder/file job = that path (resolved by the caller). Null when the spec carries no inputs.
 * @param {any} spec @param {(p: string) => string} [resolve] path resolver (the caller passes `realpath`)
 * @returns {string|null}
 */
export function placeOf(spec, resolve = (p) => p) {
  const v = Array.isArray(spec?.inputs) ? spec.inputs[0]?.value : null;
  if (!isStr(v)) return null;
  if (/^https?:\/\//i.test(v)) {
    try { return new URL(v).host; } catch { return null; }
  }
  return resolve(v);
}
