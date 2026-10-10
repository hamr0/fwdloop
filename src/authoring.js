// M6a — authoring backend: `fwdloop draft` and `fwdloop sign` (docs/wiki/the-module-ladder.md,
// "M6a — authoring backend", scope items 4 and 5).
//
// borrowed-from: fwdloop poc/m6a/batch.mjs@867c25b (literal key scrub + end-of-run sweep).
//
// draftToDir  — paid step: run the drafter, write a draft dir. Never writes a flow.
// signDraft   — the human step, $0: re-check, then writeFlow with a human `signedBy`.
//
// The spec hash (`specHash`, the ONE function; draft prints it, sign recomputes it) covers
// exactly what the human reads and signs: prose + declaration + input facts + readout, each
// canonicalised (signature.js canonicalBytes: CRLF -> LF for text, sorted-key JSON).
// target.json (root + name: where the flow lands) is covered too, so editing it after draft
// cannot sign under a different name/dir than the readout showed. It does NOT cover log.json /
// spend.jsonl (a record of how the draft was made, not of what is signed).

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { draft } from './drafter.js';
import { parseSignedText, unsignedAskTtls } from './signed-text.js';
import { validateDeclaration } from './declaration.js';
import { loadCatalogue } from './catalogue.js';
import { WIRED_VERBS } from './primitives.js';
import { canonicalBytes } from './signature.js';
import { writeFlow, readFileInside, readdirInside, checkFlowName } from './flow.js';
import { checkSendDestination } from './runner.js';
import { PROVIDER_SLOTS, checkKeyPreflight, appendSpendRow } from './provider.js';
import { writeDraftSpend } from './draftspend.js';
import { writeSetup } from './setup.js';

export const DRAFT_BUDGET_USD = 0.10;
export const SPEC_HASH_FILE = 'spec.hash';
/** The one folder under the flows root where the panel keeps its draft folders (M4e). Starts with a dot, so it is never a flow name. */
export const PANEL_DRAFTS_DIR = '.drafts';
/** Written when the end sweep finds a key in the draft dir; sign refuses a dir that has it. */
export const LEAK_MARKER_FILE = 'scrub-leak.red';
/** M4e amendments 24/25: the drafter's questions (written once by `fwdloop draft`), each human answer (`answer-<k>.json`, written once by the panel),
 *  and the drafter's own "not checked" reading (information only; never in the readout, so never in the hash). */
export const QUESTIONS_FILE = 'questions.json';
export const NOT_CHECKED_FILE = 'not-checked.json';
export const ANSWER_FILE = (k) => `answer-${k}.json`;
export const SIGN_LINE = (dir, hash) => `DRAFTED — NOT SIGNED. To sign: fwdloop sign ${dir} --approve ${hash}`;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The one spec hash. sha256 over the four canonical parts, JSON-array framed so no part can
 * bleed into the next. Never throws.
 * @param {{proseText:string, declarationText:string, inputFactsText:string, readoutText:string, targetText:string}} p
 * @returns {{ok:true, hash:string}|{ok:false, red:string}}
 */
export function specHash({
  proseText, declarationText, inputFactsText, readoutText, targetText,
}) {
  const prose = canonicalBytes('prose.txt', proseText);
  if (!prose.ok) return { ok: false, red: prose.red };
  const decl = canonicalBytes('declaration.json', declarationText);
  if (!decl.ok) return { ok: false, red: decl.red };
  // canonicalBytes' 'declaration.json' kind is the generic sorted-key JSON canonicaliser.
  const facts = canonicalBytes('declaration.json', inputFactsText);
  if (!facts.ok) return { ok: false, red: 'input-facts.json: is not valid JSON' };
  const readout = canonicalBytes('prose.txt', readoutText);
  if (!readout.ok) return { ok: false, red: readout.red };
  const target = canonicalBytes('declaration.json', targetText);
  if (!target.ok) return { ok: false, red: 'target.json: is not valid JSON' };
  const framed = JSON.stringify([sha(prose.bytes), sha(decl.bytes), sha(facts.bytes), sha(readout.bytes), sha(target.bytes)]);
  return { ok: true, hash: sha(Buffer.from(framed, 'utf8')) };
}

/**
 * The questions a plan folder raised and the answers on disk, READ from its files — the ONE reader (the panel's phase reader, the sign
 * checks and the page all use it). `questions` = [{ k, line, question, answer|null }], `open` = those with no answer. A blank or unreadable
 * answer file counts as no answer. No questions file = `{ questions: [], open: [] }`.
 * @param {string} planDir
 * @returns {{ questions: {k:number, line:number, question:string, answer:string|null}[], open: {k:number, line:number, question:string, answer:null}[] }}
 */
export function readQuestions(planDir) {
  const none = { questions: [], open: [] };
  const f = readFileInside(planDir, QUESTIONS_FILE);
  if (!f.ok) return none;
  let list;
  try { list = JSON.parse(f.text)?.questions; } catch { return none; }
  if (!Array.isArray(list)) return none;
  const questions = list.map((q, i) => {
    const k = i + 1;
    const a = readFileInside(planDir, ANSWER_FILE(k));
    let answer = null;
    if (a.ok) { try { const t = JSON.parse(a.text)?.answer; if (typeof t === 'string' && t.trim() !== '') answer = t; } catch { /* unreadable = unanswered */ } }
    return { k, line: q.line, question: String(q.question), answer };
  });
  return { questions, open: /** @type {any} */ (questions.filter((q) => q.answer === null)) };
}

export const OPEN_QUESTION_SAY = 'A question the plan raised is still open. Answer it in the panel (fwdloop panel), then sign the plan it drafts after your answers. Nothing was signed.';
export const ANSWERED_QUESTION_SAY = 'This plan raised questions, and your answers went into a newer plan. Sign the newest plan, not this one. Nothing was signed.';

/** The ONE check that a plan folder with questions is not signable (CLI sign, the page's sign route and signDraft all call it). null = fine. @param {string} planDir */
export function questionsRefusal(planDir) {
  const q = readQuestions(planDir);
  if (q.questions.length === 0) return null;
  return q.open.length > 0 ? OPEN_QUESTION_SAY : ANSWERED_QUESTION_SAY;
}

/** Literal (never RegExp) key scrub; a secret under 8 chars is skipped so it can't blank ordinary text. */
export function scrub(text, secrets) {
  let out = text;
  for (const s of secrets) if (typeof s === 'string' && s.length >= 8) out = out.split(s).join('[redacted-key]');
  return out;
}

/** Count files directly inside `dir` that contain a secret literally. */
export function sweepForSecrets(dir, secrets) {
  const live = secrets.filter((s) => typeof s === 'string' && s.length >= 8);
  if (live.length === 0) return 0;
  let leaks = 0;
  for (const name of readdirInside(dir, '.')) {
    const r = readFileInside(dir, name);
    if (r.ok && live.some((s) => r.text.includes(s))) leaks += 1;
  }
  return leaks;
}

/** Exact signed TTL with its unit, never rounded: 2h / 30m / 20s / 1500ms (the largest unit that divides it exactly). */
export function fmtTtl(ms) {
  if (!Number.isFinite(ms)) return String(ms);
  if (ms % 3600000 === 0 && ms > 0) return `${ms / 3600000}h`;
  if (ms % 60000 === 0 && ms > 0) return `${ms / 60000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

/** One cost renderer: an incomplete total is "at least", never a bare number. */
export const costText = (n, spendComplete = true) => {
  if (n == null) return 'UNKNOWN (unpriced round)';
  return spendComplete === false ? `at least $${n.toFixed(4)} (incomplete: a provider call is unpriced)` : `$${n.toFixed(4)}`;
};
const usd = costText;

/** The readout's section headings: the ONE list. buildReadout writes them from here and `readoutHeadIndexes` finds them by it,
 *  so the panel's bold and the template cannot drift (M4e amendment 7 item 3). */
const READOUT_HEADS = {
  inputs: 'INPUTS',
  steps: 'STEPS',
  asks: 'ASKS (human stops)',
  sends: 'SEND TARGET (nothing leaves before an accepted ask)',
  refused: 'REFUSED LINES',
  jobLines: 'JOB LINES',
};
/** Zero-based indexes of the heading lines in a readout's text (split on "\n"): the panel renders those bold. */
export function readoutHeadIndexes(text) {
  const heads = new Set(Object.values(READOUT_HEADS));
  const idx = [];
  String(text).split('\n').forEach((l, i) => { if (heads.has(l)) idx.push(i); });
  return idx;
}

/** Plain-text readout of what the human is about to sign. Pure. */
export function buildReadout({
  declaration, arbiter, lines, name, modelId, costUsd, rounds, spendComplete, root,
}) {
  const out = [];
  out.push(`DRAFT READOUT — NOT SIGNED — flow "${name}"`, '');
  out.push(`Drafted by: ${modelId ?? '?'} in ${rounds} round(s), cost ${usd(costUsd, spendComplete)}`);
  if (typeof root === 'string') out.push(`Flows root: ${root}  (the flow is written to <flows root>/${name} when you sign)`);
  out.push(`Cap per run (signed by you in the prose): $${arbiter.capUsd}`, '');
  out.push(READOUT_HEADS.inputs);
  for (const s of arbiter.sources) {
    const h = declaration.inputFacts?.[s.role];
    out.push(`  ${s.role} = ${s.path}${h ? `  [headings: ${h.join(' | ') || 'none'}]` : ''}`);
  }
  out.push('', READOUT_HEADS.steps);
  declaration.steps.forEach((st, i) => {
    out.push(`  ${i + 1}. (line ${st.fromLine}) ${st.goal}`);
    out.push(`     grants: ${st.primitives?.length ? st.primitives.join(', ') : 'none (pure stop)'}`
      + ` | reads: ${st.reads?.length ? st.reads.join(', ') : '-'} | emits: ${st.emits} | check: ${st.close?.class}`);
    // M4e amendment 14 item 5: the check's sections in its order (+ word limit); fixed text from typed fields, never model prose.
    const shape = st.close?.shape;
    if (Array.isArray(shape?.sections) && shape.sections.length > 0) {
      const per = Number.isInteger(shape.wordsPerSection) ? ` · about ${shape.wordsPerSection} words each` : '';
      const lim = Number.isInteger(shape.maxWords) ? ` · under ${shape.maxWords} words` : '';
      out.push(`     sections: ${shape.sections.join(' · ')}${per}${lim}`);
    }
  });
  out.push('', READOUT_HEADS.asks);
  for (const a of arbiter.asks) out.push(`  line ${a.line}: "${a.question}" (ttl ${fmtTtl(a.ttlMs)})`);
  if (arbiter.asks.length === 0) out.push('  none');
  out.push('', READOUT_HEADS.sends);
  for (const s of arbiter.sends) out.push(`  line ${s.line} -> ${s.target.kind}:${s.target.path}`);
  if (arbiter.sends.length === 0) out.push('  none');
  const refused = declaration.refused ?? [];
  if (refused.length) {
    out.push('', READOUT_HEADS.refused);
    for (const r of refused) out.push(`  line ${r.line}: ${r.reason}`);
  }
  out.push('', READOUT_HEADS.jobLines);
  for (const l of lines) {
    out.push(`  ${l.n}. ${l.text}`);
    if (typeof l.guardrail === 'string' && l.guardrail.trim() !== '') out.push(`  ~ ${l.guardrail}`);
  }
  return `${out.join('\n')}\n`;
}

/** realpath of a path that may not exist yet: the real path of its nearest existing ancestor plus the rest. */
function realpathOfNew(p) {
  const rest = [];
  let cur = path.resolve(p);
  for (;;) {
    try { return path.join(realpathSync(cur), ...rest.reverse()); } catch (e) {
      const up = path.dirname(cur);
      if (up === cur || e.code === 'EACCES') return path.resolve(p);
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}

/** Read the prose file. Refuses (a red, never a throw) on unreadable or blank. */
export function readProseFile(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { return { ok: false, red: `prose: cannot read "${file}": ${e.code ?? e.message}` }; }
  if (text.trim() === '') return { ok: false, red: `prose: "${file}" is empty` };
  return { ok: true, text };
}

/**
 * The ONE check of a draft's API key, at $0 before any ledger write (C3, amendment 16): `bin/fwdloop draft` and `draftToDir` both call
 * it, so both refuse with the same sentence. null = the key is fine; else the sentence (never the key's value).
 * @param {string} slot @param {Record<string,string|undefined>} env
 * @returns {string|null}
 */
export function draftKeyRefusal(slot, env) {
  const key = checkKeyPreflight(slot, env);
  return key.ok ? null : String(key.message);
}

/**
 * Draft into `dir`. $0 refusals (return {ok:false, wrote:false}, nothing on disk): bad key,
 * unreadable/blank prose, prose that contains the key, missing inputs / bad signed text, dir
 * already exists. After a paid round the dir is ALWAYS written — green (spec.hash present) or
 * red (reds, no spec.hash). Spend is booked in `<dir>/spend.jsonl` with the runner's own
 * writer (appendSpendRow); an unpriced round books null, never 0.
 *
 * Test seam: `provider`/`rates`/`modelId` are injected; without them a live provider is built.
 */
export async function draftToDir({
  proseFile, dir, root, name, slot = 'deepseek', model, budgetUsd = DRAFT_BUDGET_USD, env = process.env, provider, rates, modelId, noQuestions = false,
}) {
  const refuse = (reds) => ({ ok: false, wrote: false, reds, costUsd: 0 });
  const nameCheck = checkFlowName(name);
  if (!nameCheck.ok) return refuse([nameCheck.red]);
  if (typeof root !== 'string' || root === '') return refuse(['draft: --root <flows dir> is required']);
  if (!(budgetUsd > 0)) return refuse(['draft: budget must be a positive number']);
  // An unsigned draft folder inside the flows root would list as a flow in the panel and Inbox (checked by realpath, at use time).
  const realRoot = realpathOfNew(root);
  const realDir = realpathOfNew(dir);
  const rel = path.relative(realRoot, realDir);
  // M4e piece 2: the panel's own draft folders live at exactly `<root>/.drafts/<id>/...` (a dot-name is never a flow:
  // `checkFlowName` refuses it, so `listFlowNames`/`readFlow` never list it). Nothing else under the root is allowed.
  const panelDrafts = rel.startsWith(`${PANEL_DRAFTS_DIR}${path.sep}`) && !path.isAbsolute(rel);
  if (!panelDrafts && (rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)))) {
    return refuse([`draft: "${dir}" is inside the flows root "${root}" — an unsigned draft would show as a flow; use a --out outside the flows root`]);
  }
  const read = readProseFile(proseFile);
  if (!read.ok) return refuse([String(read.red)]);
  const prose = { text: String(read.text) };
  const injected = provider != null;
  const secretVar = PROVIDER_SLOTS[slot]?.envVar;
  if (!injected) {
    const refusal = draftKeyRefusal(slot, env);
    if (refusal !== null) return refuse([refusal]);
  }
  const secrets = secretVar && env[secretVar] ? [env[secretVar]] : [];
  if (secrets.some((s) => s.length >= 8 && prose.text.includes(s))) return refuse(['prose: contains an API key value — refused']);
  // Red messages can echo what a provider's error body echoed (a key): scrubbed like every file, before anything prints them.
  const cleanReds = (reds) => (reds ?? []).map((r) => scrub(String(r), secrets));
  // Claim the dir BEFORE the paid round (exclusive mkdir: a race or an existing path refuses at $0).
  const exists = () => refuse([`draft: "${dir}" already exists — never overwritten, use a new dir`]);
  if (existsSync(dir)) return exists();
  try {
    mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
    mkdirSync(dir);
  } catch (e) {
    return e.code === 'EEXIST' ? exists() : refuse([`draft: cannot create "${dir}": ${e.code ?? e.message}`]);
  }

  // Spend is booked per call into `<dir>/draft-spend.json` (src/draftspend.js), so a draft stopped between rounds
  // keeps what it paid. The first write is the mark that a call is in flight: if that cannot be written, the call is not made.
  let startedAt = null;
  const onBook = ({
    inFlight, calls, unmetered, metered, modelId: usedModel, price,
  }) => {
    const now = new Date().toISOString();
    startedAt ??= now;
    try {
      writeDraftSpend(dir, {
        kind: 'draft-live', provider: slot, model: usedModel ?? modelId ?? null, price: price ?? null, tokens: metered.tokens, costUsd: metered.costUsd, rounds: metered.rounds,
        calls, spendComplete: !inFlight && unmetered === 0 && metered.costUsd !== null, inFlight, at: startedAt, startedAt, updatedAt: now,
      });
    } catch (e) {
      if (inFlight) throw new Error(`draft: cannot book the spend before the call (${e.code ?? e.message}) — nothing was spent`);
      // after a call the cost is already in the file as "one call in flight" (a ceiling): the honest direction, so no throw
    }
  };
  const result = await draft({
    proseText: prose.text, slot, model, budgetUsd, provider, rates, modelId, env, onBook, offerQuestions: !noQuestions,
  });
  if (result.stop === 'pre-flight') {
    try { rmdirSync(dir); } catch { /* the claimed dir is still empty; leave it rather than mask the refusal */ }
    return refuse(cleanReds(result.reds));
  }

  // After a paid round: never a silent throw. The cost is returned so the caller prints it; the dir is claimed and stays.
  const paidFail = (red) => ({
    ok: false, wrote: true, dir, reds: [red], costUsd: result.costUsd, spendComplete: result.spendComplete, stop: 'write', rounds: result.rounds, calls: result.calls, leaks: 0,
  });
  const parsed = parseSignedText(prose.text); // the drafter already proved it parses
  if (!parsed.ok) return paidFail(`parse: ${parsed.reds.join('; ')}`);
  const dj = (o) => `${JSON.stringify(o, null, 2)}\n`;
  const files = {};
  files['prose.txt'] = prose.text; // verbatim
  const targetText = dj({ root, name });
  files['target.json'] = targetText;
  // Amendments 24/25: the questions and the drafter's own "not checked" reading are written BEFORE log.json/spec.hash (the panel reads those
  // two as "the draft finished"), as their own files: never in the readout, so never in the hash.
  if (result.questions?.length) files[QUESTIONS_FILE] = scrub(dj({ questions: result.questions }), secrets);
  files[NOT_CHECKED_FILE] = scrub(dj({ notChecked: result.notChecked ?? [] }), secrets);
  files['log.json'] = scrub(dj({
    ok: result.ok, stop: result.stop, reds: result.reds, rounds: result.rounds, calls: result.calls, costUsd: result.costUsd, spendComplete: result.spendComplete,
    modelId: result.modelId, modelReturned: result.modelReturned, structureRetries: result.structureRetries,
    revisions: result.revisions, log: result.log,
  }), secrets);
  let hash = null;
  if (result.ok) {
    const declarationText = scrub(dj(result.declaration), secrets);
    const inputFactsText = scrub(dj(result.declaration.inputFacts), secrets);
    const readoutText = scrub(buildReadout({
      declaration: result.declaration, arbiter: parsed.arbiter, lines: parsed.lines, name, modelId: result.modelId, costUsd: result.costUsd, rounds: result.rounds, spendComplete: result.spendComplete, root,
    }), secrets);
    files['declaration.json'] = declarationText;
    files['input-facts.json'] = inputFactsText;
    files['readout.txt'] = readoutText;
    const h = specHash({
      proseText: prose.text, declarationText, inputFactsText, readoutText, targetText,
    });
    if (!h.ok) return paidFail(`hash: ${h.red}`);
    hash = h.hash; // spec.hash is written only after a clean sweep, below
  } else if (result.declaration) {
    files['declaration.rejected.json'] = scrub(dj(result.declaration), secrets);
  }

  // The spend is booked FIRST, so a later write failure cannot leave a paid round unbooked.
  let leaks;
  try {
    appendSpendRow(path.join(dir, 'spend.jsonl'), {
      kind: 'draft',
      provider: slot,
      price: result.price ?? null,
      model: result.modelId ?? modelId ?? null,
      modelReturned: result.modelReturned,
      tokens: result.tokens ?? null,
      costUsd: result.costUsd, // null when any round was unpriced — never 0
      rounds: result.rounds,
      calls: result.calls,
      spendComplete: result.spendComplete,
      stop: result.stop,
      budgetUsd,
      // the draft's own time (amendment 7 item 2: the Draft's total time adds up from these); null when no call was booked
      startedAt,
      wallMs: startedAt === null ? null : Math.max(0, Date.now() - Date.parse(startedAt)),
    });
    for (const [f, text] of Object.entries(files)) writeFileSync(path.join(dir, f), text);
    leaks = sweepForSecrets(dir, secrets);
    if (leaks > 0) {
      const red = `scrub: ${leaks} file(s) in the draft dir contain a key value`;
      writeFileSync(path.join(dir, LEAK_MARKER_FILE), `${red}\n`); // no spec.hash; sign also refuses on this marker
      return { ok: false, wrote: true, reds: [red], costUsd: result.costUsd, spendComplete: result.spendComplete, leaks };
    }
    if (hash) writeFileSync(path.join(dir, SPEC_HASH_FILE), `${hash}\n`);
  } catch (e) {
    return paidFail(`write failed after the paid round (${e.code ?? e.message}); the draft dir is incomplete and never signable`);
  }
  return {
    ok: result.ok, wrote: true, dir, hash, questions: result.questions?.length ?? 0, reds: cleanReds(result.reds), costUsd: result.costUsd, spendComplete: result.spendComplete, stop: result.stop, rounds: result.rounds, calls: result.calls, leaks: 0,
  };
}

/**
 * The human step, $0. Every refusal returns reds and writes NO flow.
 * `signedBy` must come from the human's own invocation (the CLI's --signed-by/username).
 * `sessionDir` (the panel's draft folder: card, notes, every change) widens the setup record; the CLI has none, so its record is the one plan folder.
 * M6: `replaces: {flowHash}` (a draft opened from an existing signed job, carrying that job's signature hash) makes this sign REPLACE that job
 * (`writeFlow` checks the hash is still the job's); without it a taken name is refused as ever.
 */
export function signDraft({
  dir, approve, signedBy, signedAt = new Date().toISOString(), env = process.env, sessionDir, replaces,
}) {
  const refuse = (...reds) => ({ ok: false, reds });
  if (readFileInside(dir, LEAK_MARKER_FILE).ok) return refuse(`sign: "${dir}" carries a key-leak marker (${LEAK_MARKER_FILE}) — never signed`);
  const openQuestion = questionsRefusal(dir);
  if (openQuestion !== null) return refuse(`sign: ${openQuestion}`);
  // Sign is $0 and takes no key, so it can only sweep for keys present in ITS env (any provider slot's).
  // With none set the sweep is skipped: the marker above and the missing spec.hash are then the guard.
  const keys = Object.values(PROVIDER_SLOTS).map((p) => env[p.envVar]).filter(Boolean);
  if (sweepForSecrets(dir, keys) > 0) return refuse(`sign: "${dir}" contains a key value — nothing signed`);
  if (typeof approve !== 'string' || approve === '') return refuse('sign: --approve <hash> is required');
  const read = (f) => readFileInside(dir, f);
  const parts = {};
  for (const f of ['prose.txt', 'declaration.json', 'input-facts.json', 'readout.txt', SPEC_HASH_FILE, 'target.json']) {
    const r = read(f);
    if (!r.ok) return refuse(`sign: "${dir}" is not a green draft — ${f} ${r.missing ? 'is missing' : `is refused (${r.red})`}`);
    parts[f] = r.text;
  }
  const h = specHash({
    proseText: parts['prose.txt'], declarationText: parts['declaration.json'], inputFactsText: parts['input-facts.json'], readoutText: parts['readout.txt'], targetText: parts['target.json'],
  });
  if (!h.ok) return refuse(`sign: ${h.red}`);
  if (approve !== h.hash) return refuse('sign: --approve does not match the draft as it is now (edited since it was drafted, or the wrong hash) — nothing signed');
  if (parts[SPEC_HASH_FILE].trim() !== h.hash) return refuse('sign: spec.hash was not written by the draft for these files — nothing signed');

  let target;
  let declaration;
  try {
    target = JSON.parse(parts['target.json']);
    declaration = JSON.parse(parts['declaration.json']);
  } catch (e) {
    return refuse(`sign: draft file is not valid JSON — ${e.message}`);
  }
  const signed = parseSignedText(parts['prose.txt']);
  if (!signed.ok) return { ok: false, reds: signed.reds };
  const ttlReds = unsignedAskTtls(signed.arbiter);
  if (ttlReds.length) return { ok: false, reds: ttlReds };
  const cat = loadCatalogue();
  if (!cat.ok) return refuse(`sign: catalogue: ${cat.reds.join('; ')}`);
  const verdict = validateDeclaration(declaration, {
    arbiter: signed.arbiter, lines: signed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
  });
  if (!verdict.ok) return { ok: false, reds: verdict.reds };

  const reds = [];
  for (const s of signed.arbiter.sources) {
    if (s.kind === 'file' && !existsSync(s.path)) reds.push(`sign: input source "${s.role}" is missing at ${s.path}`);
  }
  for (const s of signed.arbiter.sends) {
    const d = checkSendDestination(`${s.target.kind}:${s.target.path}`, { root: target.root });
    if (!d.ok) reds.push(`sign: ${d.red}`);
  }
  if (reds.length) return { ok: false, reds };

  const written = writeFlow({
    root: target.root, name: target.name, proseText: parts['prose.txt'], declaration, signedBy, signedAt, catalogue: cat.primitives, replaces,
  });
  if (!written.ok) return { ok: false, reds: written.reds };
  // M4e amendment 6 item 4: the draft's record goes into the flow folder once, outside the three signed files. The flow IS signed by now, so a
  // failure to write it never un-signs: it is returned (`setup.ok:false`) for the caller to say, and the audit reads "no setup record".
  const setup = writeSetup({
    flowDir: written.dir, sessionDir, planDir: dir, hash: h.hash, signedBy, signedAt, flowHash: written.signature?.flow, secrets: /** @type {string[]} */ (keys.filter((k) => typeof k === 'string' && k.length >= 8)),
  });
  return { ok: true, flowDir: written.dir, signature: written.signature, setup };
}
