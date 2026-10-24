#!/usr/bin/env node
// M8 exit: a SEPARATE mechanical checker (docs/wiki/the-module-ladder.md "M8", Done when: "A separate script checks the ledger, the hint text and the
// Audit record agree."). Shape copied from scripts/check-cited-run.mjs: read-only, $0, no model call, nothing written, one line per check, exit 1 on any FAIL.
//
// It judges nothing itself. It reads what the product recorded (run-1's audit rows, the ledger file, run-2's learnings.json, run-2's audit rows, the
// Audit tab's data function) and says whether those records agree with each other. The only src/ code it calls is the code that must agree with the records:
// `renderHints` / `parseHintBlock` (the hint text), `getRunAudit` (what the Audit box is fed), `readLedger`, and the books readers. No provider is touched.
//
// Usage: node scripts/m8-exit-check.mjs --root <flows dir> --flow <workflow> --runs run-1,run-2 [--home <config home>] [--negative <flow>/<run>]
//   --home      the config home holding learn/ledger.json (default ~/.config/fwdloop)
//   --negative  a run made with learningHints OFF: it has no learnings text and no audit row with hints (M8 Negative)
// Exit 0 = every check passed, 1 = a check failed, 2 = a file or option could not be read.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const die = (msg) => { console.error(`cannot check: ${msg}`); process.exit(2); };

const root = opt('root');
const flow = opt('flow');
const runs = (opt('runs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const home = opt('home');
const negative = opt('negative');
if (!root || !flow || runs.length !== 2) die('usage: m8-exit-check.mjs --root <flows dir> --flow <workflow> --runs run-1,run-2 [--home <config home>] [--negative <flow>/<run>]');
const [run1, run2] = runs;

const { readAudit, readHistory, endRow } = await import('../src/books.js');
const { readLedger } = await import('../src/learnstore.js');
const { renderHints, parseHintBlock, HINT_HEADER, HINT_CHARS_MAX, placeOf } = await import('../src/learn.js');
const { resolvePlace, placeSpecOf, learningHintsOn } = await import('../src/learnstore.js');
const { NOT_A_RUN_END } = await import('../src/learnstore.js');
const { getRunAudit } = await import('../src/panel/data.js');
const { loadCatalogue } = await import('../src/catalogue.js');

const flowDir = join(root, flow);
const dirOf = (flowName, run) => join(root, flowName, 'runs', run);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isTry = (r) => Number.isInteger(r.attempt);
const OK_VERDICTS = new Set(['green', 'hitl', 'softgreen']);
const RED_VERDICTS = new Set(['red', 'not-done']);

let failed = 0;
const say = (ok, what, evidence) => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${what} — ${evidence}`); };

// ---- the files, read once --------------------------------------------------------------------------------------------------------------------------------
const dir1 = dirOf(flow, run1);
const dir2 = dirOf(flow, run2);
for (const d of [dir1, dir2]) if (!existsSync(d)) die(`no run folder ${d}`);
const led = readLedger(home);
if (led.problem) die(led.problem);
const ledger = led.ledger;
const audit1 = readAudit(dir1);
const audit2 = readAudit(dir2);
const history = readHistory(flowDir);
const rec2 = readJson(join(dir2, 'learnings.json'));
const text2 = typeof rec2?.text === 'string' ? rec2.text : '';
const ids2 = Array.isArray(rec2?.ids) ? rec2.ids : [];

// ---- 1. run-1: a step went red, then passed on a retry (a FIXED note); the run ended --------------------------------------------------------------------
{
  /** @type {string[]} */
  const fixed = [];
  const by = new Map();
  for (const r of audit1.filter(isTry)) { if (!by.has(r.step)) by.set(r.step, []); by.get(r.step).push(r); }
  for (const [step, rows] of by) {
    const red = rows.find((r) => RED_VERDICTS.has(r.verdict));
    const pass = red && rows.find((r) => r.attempt > red.attempt && OK_VERDICTS.has(r.verdict));
    if (pass) fixed.push(`${step} (try ${red.attempt} ${red.verdict}, try ${pass.attempt} ${pass.verdict})`);
  }
  say(fixed.length > 0, `1a ${run1}: a step went red then passed on a retry`, fixed.length ? fixed.join('; ') : `none of ${by.size} steps in ${run1}'s audit has a red try followed by a passing one`);
  const end = endRow(history, dir1, run1);
  // M8 am4 replaced item 4: the notes count when the run ENDS, whatever the asks did; so what is checked is that the run ended, and the asks are shown.
  const asks = audit1.filter((r) => r.step === 'ask' || r.class === 'hitl').length;
  say(!!end && !NOT_A_RUN_END.has(end.outcome), `1b ${run1}: the run ended (M8 am4: notes count at run end; item 4's Accept wait was replaced)`, end ? `history end row outcome=${end.outcome}, ${asks} hitl/ask audit rows` : `no history row for ${run1}`);
}

// ---- 2. the ledger: a counted row for this workflow, from run-1, not pending ------------------------------------------------------------------------
const wanted = `${flow}/${run1}`;
const rows1 = ledger.rows.filter((r) => r.workflow === flow && Array.isArray(r.runIds) && r.runIds.includes(wanted));
const fixedRows = rows1.filter((r) => r.sample?.kind === 'FIXED');
{
  const pending = ledger.pending.filter((p) => p.runid === wanted).length;
  say(fixedRows.length > 0 && pending === 0, `2 ledger: a counted FIXED row of ${flow} holds ${wanted}, nothing of it pending`,
    `${rows1.length} rows hold ${wanted} (${fixedRows.length} FIXED: ${fixedRows.map((r) => r.id).join(', ') || '-'}); ${pending} pending holds; health line ${Object.hasOwn(ledger.health, wanted) ? 'present' : 'ABSENT'}`);
}

// ---- 3. run-2's draft record: text non-empty, carries the row's lesson, ids name the row, the text is the ledger's render --------------------------------
{
  const hasRec = text2 !== '';
  const lessonRow = fixedRows.find((r) => text2.includes(r.lesson) && ids2.includes(r.id));
  say(hasRec && !!lessonRow, `3a ${run2} learnings.json: non-empty, holds a ${run1} FIXED row's lesson and id`,
    !hasRec ? `${join(dir2, 'learnings.json')} has no text` : lessonRow ? `${text2.length} chars; id ${lessonRow.id} in ids [${ids2.length}]; its lesson is in the text` : `${text2.length} chars; none of ${fixedRows.length} ${run1} FIXED rows (lesson + id) is in it; ids=[${ids2.join(', ')}]`);
  // The honest limit: the ledger as it was when run-2 drafted is gone once run-2 ended and counted. Two tiers, the stricter when the ledger is untouched by run-2.
  const byId = new Map(ledger.rows.map((r) => [r.id, r]));
  const missing = ids2.filter((id) => !byId.has(id));
  const wanted2 = `${flow}/${run2}`;
  const touched = Object.hasOwn(ledger.health, wanted2) || ledger.rows.some((r) => r.runIds?.includes(wanted2));
  const source = readJson(join(dir2, 'inputs.json'))?.[0]?.source ?? null;
  const place = placeOf(placeSpecOf(flow, typeof source === 'string' ? source : null), resolvePlace);
  let mtime = new Date();
  try { mtime = statSync(join(dir2, 'learnings.json')).mtime; } catch { /* no file: 3a already failed */ }
  if (!hasRec) {
    say(false, `3b ${run2} hint text agrees with the ledger`, 'no learnings text to compare');
  } else if (missing.length) {
    say(false, `3b ${run2} hint text agrees with the ledger`, `ids not in the ledger: ${missing.join(', ')}`);
  } else if (!touched) {
    // Tier A: run-2 has not counted yet, so the ledger is as the draft saw it: the text must be byte-equal to renderHints over it (now = the record's own write time).
    const r = renderHints(ledger, { workflow: flow, place, specHash: null, now: mtime });
    say(r.text === text2 && JSON.stringify(r.ids) === JSON.stringify(ids2), `3b ${run2} hint text is byte-equal to renderHints over the ledger (tier A: ledger untouched by ${run2})`,
      r.text === text2 ? `${text2.length} chars equal, ids equal` : `render gives ${r.text.length} chars, record has ${text2.length}; first difference at ${[...text2].findIndex((c, i) => c !== r.text[i])}`);
  } else {
    // Tier B: run-2 has ended and counted into the ledger (counts and samples moved), so byte-equality cannot be asked. Ask what cannot have moved: the header,
    // the length cap, the hint count = ids, and hint k is the ledger row ids[k-1] (its check name, its fixed/never-fixed kind), in level order.
    const parts = parseHintBlock(text2);
    const order = ['this job', 'this place', 'all jobs'];
    const bad = [];
    if (!text2.startsWith(HINT_HEADER)) bad.push('header differs');
    if (text2.length > HINT_CHARS_MAX) bad.push(`${text2.length} chars > ${HINT_CHARS_MAX}`);
    if (parts.length !== ids2.length) bad.push(`${parts.length} hints in the text, ${ids2.length} ids`);
    parts.forEach((p, i) => {
      const row = byId.get(ids2[i]);
      if (!row) return;
      if (p.check !== row.sample?.check) bad.push(`hint ${p.n}: check "${p.check}" vs ledger "${row.sample?.check}"`);
      if (p.fixed !== (row.sample?.kind === 'FIXED')) bad.push(`hint ${p.n}: fixed=${p.fixed} vs ledger ${row.sample?.kind}`);
      if (i > 0 && order.indexOf(p.level) < order.indexOf(parts[i - 1].level)) bad.push(`hint ${p.n}: level order`);
    });
    say(bad.length === 0, `3b ${run2} hint text agrees with the ledger rows named in its ids (tier B: ${run2} already counted, byte-equality not possible)`,
      bad.length ? bad.join('; ') : `${parts.length} hints = ${ids2.length} ids; header, cap, check names and kinds match rows ${ids2.join(', ')}`);
  }
}

// ---- 4. the Audit box is fed the same text -----------------------------------------------------------------------------------------------------------
{
  const cat = loadCatalogue();
  const a = cat.ok ? getRunAudit({ root, flow, runId: run2, catalogue: cat.primitives }) : null;
  const box = a?.learnings?.[0];
  const same = !!box && text2 !== '' && box.text === text2 && JSON.stringify(box.ids) === JSON.stringify(ids2) && box.hints.length === ids2.length;
  say(same, `4 ${run2} Audit box (getRunAudit.learnings) shows the exact text of learnings.json`,
    !a ? 'getRunAudit returned nothing' : !box ? 'the box is hidden (no learnings record read)' : `${box.text.length} chars vs ${text2.length}; ${box.hints.length} hints rendered vs ${ids2.length} ids; ${box.text === text2 ? 'text equal' : 'TEXT DIFFERS'}`);
}

// ---- 5. run-2's retries carry the block ------------------------------------------------------------------------------------------------------------
{
  const retries = audit2.filter((r) => isTry(r) && r.attempt >= 2);
  const carried = retries.filter((r) => Object.hasOwn(r, 'hints') && typeof r.hintsText === 'string' && Array.isArray(r.hintIds));
  const bad = [];
  for (const r of retries) {
    const tag = `${r.step}#${r.attempt}`;
    if (!carried.includes(r)) { bad.push(`${tag}: no hints/hintsText/hintIds`); continue; }
    if (r.hints !== r.hintIds.length) bad.push(`${tag}: hints=${r.hints} vs ${r.hintIds.length} ids`);
    // one block, whole: the step's text is the drafter's record (the ledger only moves at a run's end, so it is unchanged unless another run ended in between)
    if (r.hintsText !== text2) bad.push(`${tag}: text differs from learnings.json (${r.hintsText.length} vs ${text2.length} chars; another run ending in between would move the ledger)`);
    else if (JSON.stringify(r.hintIds) !== JSON.stringify(ids2)) bad.push(`${tag}: ids differ from learnings.json`);
  }
  say(retries.length > 0 && bad.length === 0, `5 ${run2} step retries carry hints, hintsText and hintIds equal to the drafter's block`,
    retries.length === 0 ? `no retry (attempt >= 2) in ${run2}'s audit, nothing to check` : bad.length ? bad.join('; ') : `${retries.length} retries (${retries.map((r) => `${r.step}#${r.attempt}`).join(', ')}) all carry the ${text2.length}-char block`);
}

// ---- books: every audit row's cost sums to the run's history total -------------------------------------------------------------------------------------
for (const [run, audit, dir] of [[run1, audit1, dir1], [run2, audit2, dir2]]) {
  const end = endRow(history, dir, run);
  const unknown = audit.filter((r) => r.usd !== undefined && typeof r.usd !== 'number').length;
  const sum = audit.reduce((s, r) => s + (typeof r.usd === 'number' ? r.usd : 0), 0);
  const total = end?.spentUsd;
  const ok = !!end && typeof total === 'number' && unknown === 0 && Math.abs(sum - total) < 1e-6;
  say(ok, `books ${run}: audit usd sum equals the history total`, !end ? 'no history row' : `audit sum $${sum.toFixed(6)} over ${audit.length} rows vs history spentUsd ${total}${unknown ? `; ${unknown} rows with a non-number cost` : ''}`);
}

// ---- 6. the negative: an OFF run was handed nothing ---------------------------------------------------------------------------------------------------
if (negative) {
  const [nf, nr] = negative.split('/');
  if (!nf || !nr || !existsSync(dirOf(nf, nr))) die(`--negative ${negative}: no such run folder`);
  const nd = dirOf(nf, nr);
  const rec = readJson(join(nd, 'learnings.json'));
  const handedText = typeof rec?.text === 'string' && rec.text !== '';
  const withHints = readAudit(nd).filter((r) => Object.hasOwn(r, 'hints') || r.hintsText);
  const cat = loadCatalogue();
  const a = cat.ok ? getRunAudit({ root, flow: nf, runId: nr, catalogue: cat.primitives }) : null;
  const boxShown = !!a && a.learnings.length > 0;
  say(!handedText && withHints.length === 0 && !boxShown, `6 negative ${negative}: no learnings text, no audit row with hints, no Audit box`,
    `learnings.json text ${handedText ? `PRESENT (${rec.text.length} chars)` : 'absent'}; ${withHints.length} audit rows with hints; box ${boxShown ? 'SHOWN' : 'hidden'}; learningHints now ${learningHintsOn(home) ? 'ON' : 'OFF'} in this config (it is the run's own setting at its time that counts)`);
}

console.log(failed ? `${failed} FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
