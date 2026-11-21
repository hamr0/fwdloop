// M19 S3 guard (hamr 2026-11-19: "checks move inside with the same flow we have, don't make unneccessary drift"): a $0 snapshot of what fwd's check block and its readers produce, so the
// catch-up of src/checkblock.js to bareloop v0.60.0's shape can be proved to change no row, no Not-checked reason, no signed close and no card word of any job this repo holds.
// Scenarios: (1) the block alone on the page/notes fixtures, before and after an Agree, and every Drop / Add back of every row; (2) the real `draft()` on the m14-walk-5 job with a stub provider;
// (3) a CSV plan through `draftToDir` and `rowEditPlan` (Drop and Add of every row); (4) every signed job folder in a root read through the readers a screen uses (checkedLines, the Audit list,
// the sheet card, the Not-checked view). Pure reads of the repo's own fixtures, plus `flowSnapshot(dir)` that a scratch script points at a read-only COPY of a real flows root.
// Test-only. Records nothing of a key, a path outside a tmp root, a hash or a time: those are scrubbed.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { parseSignedText } from '../src/signed-text.js';
import { csvRolesOf, sheetLineBlocks } from '../src/sheetblock.js';
import { CheckBlock, renderCard } from '../src/checkblock.js';
import { draft } from '../src/drafter.js';
import { draftToDir } from '../src/authoring.js';
import { rowEditPlan } from '../src/planrebuild.js';
import { checkedLines, notCheckedView } from '../src/checked.js';
import { auditChecksOf } from '../src/auditchecks.js';
import { withSheetRows } from '../src/sheetrows.js';
import { checkListReds, listLinesOf, cardLinesOf } from '../src/checklistsign.js';
import { RATES, MODEL, fakeProvider, textReply, toolReply } from './drafter-fixture.mjs';
import { callOf, router } from './m16-drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
const rd = (/** @type {string} */ p) => readFileSync(path.join(FIX, p), 'utf8');
const plain = (/** @type {any} */ x) => JSON.parse(JSON.stringify(x ?? null));
const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** a tmp path, a hash and a time are not part of what a screen shows: scrub them from a snapshot (a tmp dir is a fresh name every run) @param {any} v @param {string[]} tmps */
export function scrub(v, tmps = []) {
  if (typeof v === 'string') {
    let s = v;
    for (const t of tmps) s = s.split(t).join('<TMP>');
    return s.replace(/fwdloop-[a-z0-9]+-[A-Za-z0-9]{6}/g, '<TMP>').replace(/\b[0-9a-f]{64}\b/g, '<SHA>');
  }
  if (Array.isArray(v)) return v.map((x) => scrub(x, tmps));
  if (isRec(v)) {
    /** @type {Record<string, any>} */
    const o = {};
    for (const [k, x] of Object.entries(v)) { if (k === 'at' || k === 'hash') continue; o[k] = scrub(x, tmps); }
    return o;
  }
  return v;
}

// ---- (1) the block alone ----------------------------------------------------------------------------------------------------------------------------------------------
/** step lines only, in the block's jobLines shape (which lines are ask, send or sheet lines is fwd's own parser's word) */
function stepLines(/** @type {string} */ prose, /** @type {any} */ declaration) {
  const p = parseSignedText(prose);
  if (!p.ok) throw new Error(JSON.stringify(p.reds));
  const skip = new Set([...p.arbiter.asks.map((/** @type {any} */ a) => a.line), ...p.arbiter.sends.map((/** @type {any} */ s) => s.line)]);
  const sheet = declaration ? sheetLineBlocks({ declaration, lines: p.lines.map((/** @type {any} */ l) => ({ n: l.n, guardrail: l.guardrail })), csvRoles: csvRolesOf(p.arbiter) }) : [];
  for (const b of sheet) skip.add(b.line);
  return p.lines.filter((/** @type {any} */ l) => !skip.has(l.n)).map((/** @type {any} */ l) => ({ n: l.n, text: l.text, rules: l.guardrail ? l.guardrail.split('; ').map((/** @type {string} */ s) => s.trim()).filter(Boolean) : [] }));
}
const BLOCK_JOBS = [
  { id: 'm14-walk-5', prose: () => rd('m16-block/m14-walk-5/prose.txt'), texts: () => ({ notes: rd('m16-block/m14-walk-5/notes.md') }), look: () => null },
  { id: 'flights', prose: () => rd('m16-block/flights/draft-prose.txt'), texts: () => ({ flights: rd('m16-block/flights/flights.txt') }), look: () => JSON.parse(rd('m16-block/flights/page-look.json')) },
  { id: 'flights-agree', prose: () => rd('m16-block/flights/draft-prose.txt'), texts: () => ({ flights: rd('m10-walk-flights/flights.txt') }), look: () => null },
];

/** @param {any} b */
function blockView(b) {
  const cl = b.reconcile();
  return plain({
    rows: b.rows.map((/** @type {any} */ r) => ({ key: r.key, line: r.line, by: r.by, kind: r.kind, state: r.state, reason: r.reason ?? null, text: r.text ?? null, hidden: r.hidden === true })),
    card: renderCard(b.rows), suggested: b.suggestedView(), close: cl, open: b.open, signed: b.signedRows(), choices: b.choicesRecord(),
  });
}
/** a Drop or an Add back of one row: its answer, the card's words in full and a digest of the whole view (rows, close, signed rows, choices): the file stays small, a diff is read by recomputing @param {any} done @param {any} b */
function editView(done, b) {
  const v = blockView(b);
  return { done: plain(done), card: v.card, suggested: v.suggested, digest: createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16) };
}
/** @param {typeof BLOCK_JOBS[number]} j @param {boolean} agree */
function makeBlock(j, agree) {
  const b = new CheckBlock({ texts: j.texts(), labels: Object.keys(j.texts()), asks: true, split: true });
  b.fromJob(stepLines(j.prose(), null));
  const lk = j.look()?.look ?? { facts: [], dropped: [] };
  b.addLook(lk.facts.map((/** @type {any} */ f) => { const { phrases: _p, ...rest } = f; return rest; }), lk.dropped);
  b.reconcile();
  if (agree) b.drive({ answer: (/** @type {any} */ q) => (q.offers.agree ? { choice: 'agree' } : null) });
  return b;
}
export function blockSnapshots() {
  /** @type {Record<string, any>} */
  const out = {};
  for (const j of BLOCK_JOBS) {
    for (const agree of [false, true]) {
      const base = makeBlock(j, agree);
      const keys = base.rows.map((/** @type {any} */ r) => r.key);
      /** @type {Record<string, any>} */
      const edits = {};
      for (const k of keys) for (const op of ['drop', 'add']) {
        const b = makeBlock(j, agree);
        const done = b.rowChoice(k, op);
        edits[`${op} ${k}`] = editView(done, b);
        if (op === 'drop' && done.ok) {
          const again = b.rowChoice(k, 'add');
          edits[`drop-then-add ${k}`] = editView(again, b);
        }
      }
      out[`${j.id}${agree ? ' +agree' : ''}`] = { view: blockView(makeBlock(j, agree)), edits };
    }
  }
  return out;
}

// ---- (2) draft() on the walk job -----------------------------------------------------------------------------------------------------------------------------------
const NONE = callOf('submit_edits', { edits: [] });
const LEDGER_NONE = callOf('suggest_extra_checks', { extra: [] });
const PICKS = [{ line: 3, rule: 1, check: { rule: 'listItems', value: 3 } }, { line: 5, rule: 1, check: { rule: 'maxWords', value: 80 } }];
const aiDecl = () => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 's1', fromLine: 1, close: { class: 'hitl' } },
    { primitives: [], reads: ['s1'], emits: 'a2', fromLine: 2, close: { class: 'hitl' } },
    { primitives: ['read'], reads: [], emits: 's3', fromLine: 3, close: { class: 'green', cited: { source: 'notes', facts: [{ name: 'job', shape: 'phrase', phrase: 'the AI wrote this' }] } } },
    { primitives: [], reads: ['s3'], emits: 'a4', fromLine: 4, close: { class: 'hitl' } },
    { primitives: ['read'], reads: [], emits: 's5', fromLine: 5, close: { class: 'softgreen', shape: { maxWords: 5 } } },
    { primitives: [], reads: ['s5'], emits: 'a6', fromLine: 6, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['a6'], emits: 'sent', fromLine: 7, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 3: 'green', 5: 'softgreen' }, unjudgeable: {}, refused: [],
});
const tmpRoot = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m19s-'));

/** the m14-walk-5 job with its notes and send folder in a tmp root @param {string} home @param {(s: string) => string} edit */
function walkProse(home, edit = (s) => s) {
  mkdirSync(path.join(home, 'out'), { recursive: true });
  const notes = path.join(home, 'notes.md');
  writeFileSync(notes, rd('m16-block/m14-walk-5/notes.md'));
  return edit(rd('m16-block/m14-walk-5/prose.txt')).replace('file:/home/user/walk/m14-garden-notes.md', `file:${notes}`).replace('file:/home/user/fwdloop-out', `file:${path.join(home, 'out')}`);
}
const WALK = (/** @type {string} */ s) => s.replace('guardrail: exactly 3 bullets', 'guardrail: exactly 3 list items').replace('guardrail: under 80 words', 'guardrail: at most 80 words');

export async function draftSnapshots() {
  /** @type {Record<string, any>} */
  const out = {};
  const home = tmpRoot();
  try {
    const cases = {
      'walk, picks given': { edit: WALK, extra: { checkPicks: PICKS, offerQuestions: false }, decl: aiDecl() },
      'walk, no picks (asks)': { edit: (/** @type {string} */ s) => s, extra: {}, decl: aiDecl() },
    };
    for (const [id, c] of Object.entries(cases)) {
      const p = router({ suggest_extra_checks: LEDGER_NONE, submit_edits: NONE, suggest_checks: callOf('suggest_checks', { checks: [{ line: 3, guardrail: 1, rule: 'listItems', value: 3 }, { line: 5, guardrail: 1, rule: 'maxWords', value: 80 }] }), emit_declaration: callOf('emit_declaration', c.decl) });
      const r = await draft({ proseText: walkProse(home, c.edit), provider: p, rates: RATES, modelId: MODEL, checkList: true, ...c.extra });
      out[id] = scrub(plain({
        ok: r.ok, stop: r.stop, reds: r.reds, questions: r.questions, checkRows: r.checkRows, checkCard: r.checkCard, notChecked: r.notChecked, notCheckedBy: r.notCheckedBy,
        steps: r.declaration?.steps, guardrailClasses: r.declaration?.guardrailClasses, checkList: r.declaration?.checkList, calls: p.names(),
      }), [home]);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
  return out;
}

// ---- (3) a CSV plan, its card and every Drop and Add ---------------------------------------------------------------------------------------------------------------
const AGING_CSV = path.join(FIX, 'm10b-sheets', 'aging.csv');
const ISO = [{ column: 'Due date', format: 'YYYY-MM-DD' }];
const BANDS = [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }];
const CSV_PROSE = `1. Read the aging report
2. Put each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+,
   guardrail: every invoice appears exactly once; flag amounts over 500
3. ask 1h: check it with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source aging = file:${AGING_CSV}
`;
const csvChecks = () => [
  { id: 'nodup', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #', covers: [1] },
  { id: 'over', rule: 'cells', table: 'aging', claim: 'over', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], covers: [2] },
  { id: 'bands', rule: 'cells', table: 'aging', claim: 'bands', op: 'band', column: 'Due date', asOf: '2026-10-11', dateFormats: ISO, bands: BANDS, covers: [] },
];
const csvDecl = (/** @type {any[]} */ sheet) => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'aging_text', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['aging'], emits: 'bucket_assignment', fromLine: 2, close: { class: 'green', sheet } },
    { primitives: [], reads: ['bucket_assignment'], emits: 'human_ok', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['bucket_assignment', 'human_ok'], emits: 'bucket_report', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' }, unjudgeable: {}, refused: [],
});
const rep = (/** @type {string} */ text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const planView = (/** @type {any} */ files, /** @type {string[]} */ tmps) => scrub(plain({
  declaration: JSON.parse(files['declaration.json']), notChecked: JSON.parse(files['not-checked.json'] ?? 'null'), record: JSON.parse(files['picks-record.json'] ?? 'null'),
  checkCard: JSON.parse(files['log.json']).checkCard, readout: files['readout.txt'],
}), tmps);

export async function csvSnapshots() {
  /** @type {Record<string, any>} */
  const out = {};
  const work = tmpRoot();
  try {
    writeFileSync(path.join(work, 'prose.txt'), CSV_PROSE);
    const provider = fakeProvider([rep(JSON.stringify({ facts: [] })), toolReply(csvDecl(csvChecks()))]);
    const dir = path.join(work, 'draft');
    const root = path.join(work, 'flows');
    mkdirSync(root);
    const r = await draftToDir({ proseFile: path.join(work, 'prose.txt'), dir, root, name: 'aging', provider, rates: RATES, modelId: MODEL, env: {}, slot: 'DEEPSEEK_API_KEY' });
    if (!r.ok) throw new Error(JSON.stringify(r.reds));
    const files = Object.fromEntries(readdirSync(dir).filter((f) => !f.endsWith('.log') && f !== 'pages').map((f) => [f, readFileSync(path.join(dir, f), 'utf8')]));
    out.draft = planView(files, [work]);
    const decl = JSON.parse(files['declaration.json']);
    const keys = decl.checkList.map((/** @type {any} */ x) => x.key);
    for (const key of keys) {
      const dropped = rowEditPlan({ planDir: dir, op: 'drop', key });
      out[`drop ${key}`] = dropped.ok ? planView(dropped.files, [work]) : scrub(plain(dropped), [work]);
      out[`add ${key}`] = (() => { const a = rowEditPlan({ planDir: dir, op: 'add', key }); return a.ok ? planView(a.files, [work]) : scrub(plain(a), [work]); })();
      // Add back after the Drop: write the dropped plan to a second folder and Add the same key there
      if (dropped.ok) {
        const d2 = path.join(work, `after-${keys.indexOf(key)}`);
        mkdirSync(path.join(d2, 'pages'), { recursive: true });
        for (const [f, t] of Object.entries(dropped.files)) writeFileSync(path.join(d2, f), t);
        for (const [f, t] of Object.entries(dropped.pages)) { mkdirSync(path.dirname(path.join(d2, f)), { recursive: true }); writeFileSync(path.join(d2, f), t); }
        const back = rowEditPlan({ planDir: d2, op: 'add', key });
        out[`drop-then-add ${key}`] = back.ok ? planView(back.files, [work]) : scrub(plain(back), [work]);
      }
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  return out;
}

// ---- (4) a signed job folder through the readers a screen uses --------------------------------------------------------------------------------------------------------
/**
 * What the screens read of a signed job: the signed readout lines, the Audit's check list, the sheet card, the Not-checked view and the gate's reds.
 * @param {{prose: string, declaration: any, notChecked?: any}} j
 */
export function signedReaders({ prose, declaration, notChecked }) {
  const p = parseSignedText(prose);
  if (!p.ok) return { unreadable: plain(p.reds) };
  const csvRoles = csvRolesOf(p.arbiter);
  const askLines = p.arbiter.asks.map((/** @type {any} */ a) => a.line);
  const items = Array.isArray(notChecked?.notChecked) ? notChecked.notChecked : Array.isArray(notChecked?.items) ? notChecked.items : [];
  const t = (/** @type {() => any} */ f) => { try { return plain(f()); } catch (e) { return { threw: String(/** @type {any} */ (e)?.message ?? e).slice(0, 200) }; } };
  return {
    list: t(() => ({ onList: [...listLinesOf(declaration)].sort(), card: [...cardLinesOf(declaration)].sort(), reds: checkListReds(declaration) })),
    checked: t(() => checkedLines(declaration, { askLines, lines: p.lines, csvRoles })),
    audit: t(() => auditChecksOf(declaration, [], { items, by: notChecked?.by ?? {} }, { lines: p.lines, csvRoles })),
    sheetCard: t(() => { const s = withSheetRows({ declaration, lines: p.lines, csvRoles }); return { card: s.sheet.card, signed: s.sheet.signed }; }),
    notChecked: t(() => notCheckedView(items, declaration)),
    closes: t(() => (declaration.steps ?? []).map((/** @type {any} */ s) => [s.fromLine, s.close])),
    checkList: declaration.checkList ?? null,
  };
}

/** a job folder: prose + declaration (the signed copy first), the signature's Not-checked block if it has one */
export function flowSnapshot(/** @type {string} */ dir) {
  const pick = (/** @type {string} */ f) => [path.join(dir, 'signed', f), path.join(dir, f)].find((x) => existsSync(x));
  const pf = pick('prose.txt');
  const df = pick('declaration.json');
  if (!pf || !df) return { skipped: 'no prose or declaration' };
  let declaration;
  try { declaration = JSON.parse(readFileSync(df, 'utf8')); } catch { return { skipped: 'declaration unreadable' }; }
  let notChecked = null;
  for (const f of ['signature.json', 'signed/signature.json']) {
    try { const s = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); if (isRec(s.notChecked)) notChecked = s.notChecked; } catch { /* none */ }
  }
  return signedReaders({ prose: readFileSync(pf, 'utf8'), declaration, notChecked });
}

/** every folder under `root` that holds a prose.txt and a declaration.json, found by walking down (a run's job copy is one too) @param {string} root */
export function flowDirs(root) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ d, /** @type {number} */ depth) => {
    if (existsSync(path.join(d, 'prose.txt')) && existsSync(path.join(d, 'declaration.json'))) out.push(d);
    if (depth >= 5) return;
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'inputs' && e.name !== 'artifacts') walk(path.join(d, e.name), depth + 1);
  };
  walk(root, 0);
  return out.sort();
}
/** @param {string} root @returns {Record<string, any>} keyed by the folder's path under root */
export function rootSnapshot(root) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const d of flowDirs(root)) out[path.relative(root, d) || '.'] = scrub(flowSnapshot(d), []);
  return out;
}

/** the repo fixtures that hold a signed job or a signed list, read by the readers (+ the csv fixture's own signed declaration) */
export function fixtureSnapshots() {
  /** @type {Record<string, any>} */
  const out = rootSnapshot(FIX);
  // m19-am10 was made after the S3 port, so it has no pre-port snapshot entry; test/m19-am10-itempick.test.js guards it
  delete out['m19-am10'];
  out['m16-block/csv (prose + signed-declaration)'] = scrub(signedReaders({ prose: rd('m16-block/csv/prose.txt'), declaration: JSON.parse(rd('m16-block/csv/signed-declaration.json')), notChecked: null }), []);
  return out;
}

/** everything the repo guard holds */
export async function allSnapshots() {
  return { blocks: blockSnapshots(), drafts: await draftSnapshots(), csv: await csvSnapshots(), fixtures: fixtureSnapshots() };
}
