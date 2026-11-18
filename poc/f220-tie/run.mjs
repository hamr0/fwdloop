// F220 harness ($0, no AI, no key): M17 am9, a column tie asks which column (docs/logs/FINDINGS.md "F220 PRE-REGISTRATION"). Run: node --experimental-test-module-mocks poc/f220-tie/run.mjs
// Real: findColumn / applySheetWords / draft() (drafter.js, MAX_LOOK_ASKS) / applyAnswers (src/panel/authorcard.js) / the panel's answer door (via test/m4e-world.mjs). Patched copy: sheetlook.js (poc/f220-tie/patch.mjs).
import { mock } from 'node:test';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { findColumn } from '../../src/sheetfind.js';
import * as realLook from '../../src/sheetlook.js';
import { applyAnswers } from '../../src/panel/authorcard.js';
import { RATES, MODEL, fakeProvider, toolReply, textReply } from '../../test/drafter-fixture.mjs';
import { buildPatchedLook, offersOf, refuseChoice, ruleOfColumnAnswer, SAYS } from './patch.mjs';

const work = mkdtempSync(join(tmpdir(), 'fwdloop-f220-'));
const EXPENSES = new URL('../../test/fixtures/m10b-sheets/expenses.csv', import.meta.url).pathname;
const results = [];
const bar = (id, pass, why) => results.push({ id, pass, why });
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const LOOK = (from, word = 'Price') => JSON.stringify({ facts: [{ from, word, kind: 'number' }] });
const QWORDS = "I found 2 columns matching 'Price': Amount, Tax. Choose one. (your answer replaces that ~ rule on line 2).";

// a sheet of `n` number columns with the same rows (Amount copied under other names), for the 3 and 5 column ties
function sheetOf(n) {
  const names = ['Amount', 'Tax', 'Fee', 'Net', 'Gross'].slice(0, n);
  const rows = readFileSync(EXPENSES, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')); // the fixture's simple rows (a quoted comma row is skipped below)
  const lines = [['Date', 'Description', ...names].join(',')];
  for (const r of rows) { if (r.length !== 4) continue; lines.push([r[0], r[1], ...names.map(() => r[2])].join(',')); }
  const f = join(work, `tie${n}.csv`); writeFileSync(f, `${lines.join('\n')}\n`); return f;
}
const proseFor = (csv, rules = ['Price over 500']) => `1. Read the sheet\n2. List expenses\n${rules.map((r) => `   guardrail: ${r}`).join('\n')}\n3. ask 1h: check it with me\n4. Write it out\n\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $0.25 per run\nguardrail: send at line 4 to file:poc/m0/out\nguardrail: source expenses = file:${csv}\n`;
// NB the signed-text parser takes ONE `guardrail:` per line: several rules are one string joined by "; "
const proseOne = (csv, rules) => proseFor(csv, [rules.join('; ')]);
const jobLines = (rules) => [{ n: 1, text: 'Read the sheet', rules: [] }, { n: 2, text: 'List expenses', rules }];
const csvText = readFileSync(EXPENSES, 'utf8');

// ─────────────────────── Step 1: today's code (red) ───────────────────────
const pre = findColumn(csvText, 'Price');
if (pre.kind !== 'tie' || pre.columns.join() !== 'Amount,Tax') { console.log(`STOP: precondition failed, findColumn gives ${JSON.stringify(pre)}`); process.exit(2); }
const w = [{ from: 'line 2 rule 1', word: 'Price', kind: 'number' }];
const today = realLook.applySheetWords(csvText, w, jobLines(['Price over 500']), 'expenses');
console.log(`STEP 1 today: findColumn -> ${JSON.stringify(pre)}; applySheetWords asks=${today.asks.length}, dropped=${JSON.stringify(today.dropped.map((d) => d.reason))}`);
bar('a-today', today.asks.length === 0 && today.dropped[0]?.reason === 'column-tie', `today: ${today.asks.length} asks, dropped reason ${today.dropped[0]?.reason} (the red: bar (a) FAILS on current code)`);
// today's real door, through the real panel (test/m4e-world.mjs): choice 'column'
let doorToday = 'not run';
try {
  const { world, until, killChildrenAfter } = await import('../../test/m4e-world.mjs');
  const { JOB } = await import('../../test/m4e-world.mjs');
  const { readFileSync: rf } = await import('node:fs');
  const { isFwdloopAlive } = await import('../../src/liveness.js');
  const w2 = await world({});
  const id = (await w2.post('/api/author/draft', w2.card({ job: JOB.replace('Read my resume,', 'Read my resume QMARK,') }))).json().draftId;
  const st = async () => (await w2.get(`/api/author/${id}`)).json();
  await until(async () => { const j = await st(); return ['questions-open', 'green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  await until(() => { try { const p = JSON.parse(rf(join(w2.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; } });
  const before = JSON.stringify(readdirSync(join(w2.dir(id), 'draft')).sort());
  const r = await w2.post(`/api/author/${id}/answer`, { k: 1, choice: 'column', answer: 'Tax' });
  doorToday = `status ${r.status} ${r.json().refused}: ${r.json().say}; draft folder unchanged: ${before === JSON.stringify(readdirSync(join(w2.dir(id), 'draft')).sort())}`;
  void killChildrenAfter;
} catch (e) { doorToday = `door not driven: ${String(e?.message ?? e).slice(0, 120)}`; }
console.log(`STEP 1 today's real door, choice "column": ${doorToday}`);
bar('door-today', /bad-choice: That answer is not one of the choices/.test(doorToday), `today's real door: ${doorToday} (signed words for a column on a question with no list: "${SAYS.notOffered}")`);

// ─────────────────────── Step 2: the POC patch ───────────────────────
const patchedUrl = buildPatchedLook(work);
const P = await import(patchedUrl);
const tieAsk = (csv, rules, from = 'line 2 rule 1', word = 'Price', mod = P) => mod.applySheetWords(readFileSync(csv, 'utf8'), [{ from, word, kind: 'number' }], jobLines(rules), 'expenses');

// (a)
{
  const r = tieAsk(EXPENSES, ['Price over 500']);
  const a = r.asks[0];
  const offers = a ? offersOf({ ...a, rule: a.rule }) : null;
  bar('a', r.asks.length === 1 && a.question === QWORDS && JSON.stringify(a.columns) === '["Amount","Tax"]' && JSON.stringify(offers) === JSON.stringify({ agree: false, drop: true, columns: ['Amount', 'Tax'] }), `asks ${r.asks.length}; question ${JSON.stringify(a?.question)}; columns ${JSON.stringify(a?.columns)}; offers ${JSON.stringify(offers)}`);
  // (b)(c) the door
  const step = { offers };
  const rb = refuseChoice(step, 'column', 'Date');
  const rc1 = refuseChoice(step, 'rule', 'Amount over 500');
  const rc2 = refuseChoice(step, 'agree');
  const rc3 = refuseChoice({ offers: { agree: true, drop: true } }, 'column', 'Tax');
  const okTax = refuseChoice(step, 'column', 'Tax') === null && refuseChoice(step, 'column', 'Amount') === null && refuseChoice(step, 'drop') === null;
  bar('b', rb === SAYS.pickColumn && okTax, `column/Date -> ${JSON.stringify(rb)}; Tax, Amount, Drop it accepted: ${okTax}. (UNCHECKED: "question stays open, nothing on disk": the POC door copy has no writer; the real door is inline in src/panel/author.js:808-835)`);
  bar('c', rc1 === SAYS.pickColumn && rc2 === SAYS.pickColumn && rc3 === SAYS.notOffered, `rule -> ${rc1 === SAYS.pickColumn}; agree -> ${rc2 === SAYS.pickColumn}; column on a question with no list -> ${JSON.stringify(rc3)}`);
  // (d) the pick through the REAL applyAnswers
  const job = 'Read the sheet,\nList expenses,\n~ Price over 500\nAsk 1h: check it with me,\nWrite it out\n';
  const pick = (col, ruleText = 'Price over 500', jobText = job, mod = null) => {
    const q = { ...a, ruleText };
    const ans = ruleOfColumnAnswer(q, 'column', col);
    return applyAnswers(jobText, [{ line: 2, question: q.question, answer: col, ...ans, ruleNo: 1, ruleText, ask: 'reading', proposal: q.readings[col] }]);
  };
  const lineCount = (j) => j.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('~')).length;
  const ruleLines = (j) => j.split('\n').filter((l) => l.startsWith('~'));
  const tax = pick('Tax'); const amt = pick('Amount');
  const okD = ruleLines(tax.job).join() === '~ Tax over 500' && ruleLines(amt.job).join() === '~ Amount over 500' && lineCount(tax.job) === lineCount(job) && tax.added === 1 && ruleLines(tax.job).length === 1;
  bar('d', okD, `Tax -> ${JSON.stringify(ruleLines(tax.job))}, Amount -> ${JSON.stringify(ruleLines(amt.job))}; lines ${lineCount(job)} -> ${lineCount(tax.job)}; rules on line 2: ${ruleLines(tax.job).length}`);
  // (d2) the word is not inside the rule's text: signed am9 item 4 says the rule becomes `use the column 'Tax' for 'Price'`
  const job2 = 'Read the sheet,\nList expenses,\n~ under budget\nAsk 1h: check it with me,\nWrite it out\n';
  const odd = pick('Tax', 'under budget', job2);
  const gotRule = ruleLines(odd.job);
  bar('d2', gotRule.join() === "~ use the column 'Tax' for 'Price'" && lineCount(odd.job) === lineCount(job2), `rule lines after the pick: ${JSON.stringify(gotRule)}; real applyAnswers returned columns=${JSON.stringify(odd.columns)}, added=${odd.added} (fwd's signed M17 ruling 2 / am1: a column for a word that is not in the tied rule's text rewrites nothing and is told to the AI)`);
  // pre-break 3: a pick that adds a line beside the rule (the answer carried no rule number) -> bar (d) red
  const q = { ...a, ruleText: 'Price over 500' };
  const bad = applyAnswers(job, [{ line: 2, question: q.question, answer: 'Tax', rule: q.readings.Tax, left: false, ruleText: 'Price over 500', ask: 'reading', proposal: null }]);
  bar('10-3', !(lineCount(bad.job) === lineCount(job) && ruleLines(bad.job).length === 1), `a pick written without its rule number: rule lines on line 2 now ${JSON.stringify(ruleLines(bad.job))} (the (d) check would be red)`);
  // (f) Drop it leaves the rule, Not checked
  const dr = applyAnswers(job, [{ line: 2, question: q.question, answer: 'drop', ...ruleOfColumnAnswer(q, 'drop'), ruleNo: 1, ruleText: 'Price over 500', ask: 'reading', proposal: null }]);
  bar('f1', dr.job === job && JSON.stringify(dr.left) === '[{"line":2,"rule":1}]' && dr.added === 0, `Drop it: job unchanged ${dr.job === job}; left ${JSON.stringify(dr.left)}`);
  // pre-break 1: a door that accepts any text -> (b) red
  const loose = refuseChoice(step, 'column', 'Date', { strict: false });
  bar('10-1', loose === null, `a door that accepts any column text lets column/Date through (${loose === null ? 'bar (b) red' : 'NOT red'})`);
}
// pre-break 2: the patched copy built WITHOUT the tie branch (the look drops the tie again) -> bar (a) red
{
  const Q = await import(buildPatchedLook(work, { noTieAsk: true }, 'sheetlook-notie.mjs'));
  const r = tieAsk(EXPENSES, ['Price over 500'], 'line 2 rule 1', 'Price', Q);
  bar('10-2', r.asks.length === 0, `the look drops the tie again: ${r.asks.length} asks (the (a) check would be red)`);
}
// (e) 3 and 5 columns
for (const n of [3, 5]) {
  const csv = sheetOf(n);
  const r = tieAsk(csv, ['Price over 500']);
  const want = ['Amount', 'Tax', 'Fee', 'Net', 'Gross'].slice(0, n);
  const a = r.asks[0];
  const q = `I found ${n} columns matching 'Price': ${want.join(', ')}. Choose one. (your answer replaces that ~ rule on line 2).`;
  bar(`e${n}`, a && JSON.stringify(a.columns) === JSON.stringify(want) && a.question === q && JSON.stringify(offersOf(a).columns) === JSON.stringify(want), `columns ${JSON.stringify(a?.columns)}; question lists them all: ${a?.question === q}`);
  if (n === 5) { const cut = { ...a, columns: a.columns.slice(0, 2) }; bar('10-4', JSON.stringify(offersOf(cut).columns) !== JSON.stringify(want), 'a picker cut to two columns on the 5-column sheet (the (e) check would be red)'); }
}
// (f2) a tie on a prose word of the line asks nothing, stays Not checked
{
  const r = tieAsk(EXPENSES, ['Price over 500'], 'line 2', 'Price');
  bar('f2', r.asks.length === 0 && r.dropped[0]?.reason === 'column-tie', `prose word tie: ${r.asks.length} asks, dropped ${JSON.stringify(r.dropped.map((d) => [d.reason, d.other]))}`);
}
// (g) a rule that already names a real header asks nothing
{
  const r = tieAsk(EXPENSES, ['Amount over 500']);
  bar('g', r.asks.length === 0, `rule "Amount over 500", word Price: ${r.asks.length} asks, facts ${JSON.stringify(r.facts.map((f) => f.column))}, dropped ${JSON.stringify(r.dropped.map((d) => d.reason))}`);
}
// (h) the REAL drafter with the patched look (mock.module): 1 tie -> asks the question; 4 ties -> the real cap stops at $0
mock.module(new URL('../../src/sheetlook.js', import.meta.url).href, { namedExports: { ...realLook, lookAtSheet: P.lookAtSheet, applySheetWords: P.applySheetWords } });
const { draft } = await import(`../../src/drafter.js?f220=${Date.now()}`);
async function realDraft(rules, look) {
  const p = fakeProvider([reply(look), toolReply({ steps: [], guardrailClasses: {}, unjudgeable: {}, refused: [] })]);
  const r = await draft({ proseText: proseOne(EXPENSES, rules), provider: p, rates: RATES, modelId: MODEL, offerQuestions: true });
  return { r, calls: p.calls?.length };
}
try {
  const one = await realDraft(['Price over 500'], LOOK('line 2 rule 1'));
  const q1 = one.r.questions?.[0];
  bar('h1', one.r.stop === 'look-asks' && one.r.questions.length === 1 && q1.question === QWORDS && one.r.costUsd < 0.01, `real draft(): stop ${one.r.stop}; ${one.r.questions?.length} question; words ok: ${q1?.question === QWORDS}; proposal ${JSON.stringify(q1?.proposal)}; has columns field: ${'columns' in (q1 ?? {})}; cost ${one.r.costUsd}`);
  const four = await realDraft(['Price over 500', 'Price under 900', 'Price not 700', 'Price above 100'], JSON.stringify({ facts: [1, 2, 3, 4].map((i) => ({ from: `line 2 rule ${i}`, word: 'Price', kind: 'number' })) }));
  bar('h', four.r.stop === 'look-asks-too-many' && four.r.questions.length === 0, `real draft() with 4 tie asks: stop ${four.r.stop}; questions ${four.r.questions?.length}; reds ${JSON.stringify(four.r.reds).slice(0, 120)}; cost ${four.r.costUsd}`);
} catch (e) { bar('h', false, `real drafter not driven: ${String(e?.stack ?? e).slice(0, 300)}`); }
// (i) the CLI never answers draft questions: read, not run
{
  const t = readFileSync(new URL('../../bin/fwdloop', import.meta.url), 'utf8');
  bar('i', t.includes('Answer it in the panel'), `bin/fwdloop contains "Answer it in the panel": ${t.includes('Answer it in the panel')} (read, not run)`);
}
console.log(`F220 work root: ${work}`);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}\n   ${r.why}`);
process.exit(0);
