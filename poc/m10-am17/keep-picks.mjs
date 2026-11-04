// F146 (pre-registered in docs/logs/FINDINGS.md): M10 am17's riskiest assumption, $0, no src/ change, no provider, no key.
// Can a Revise carry the last draft's check picks, and can code decide per guardrail keep-or-ask? The decision function lives HERE only.
// Run: node poc/m10-am17/keep-picks.mjs   (prints one line per bar, then the must-fail line per bar; exit 1 if any bar is not as registered)
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readQuestions } from '../../src/authoring.js';
import { ruleOfAnswer } from '../../src/pageask.js';
import { cardFields, cardToProse, appendAnswersToJob } from '../../src/panel/authorcard.js';
import { parseSignedText } from '../../src/signed-text.js';
import { scopedRules, settleRules } from '../../src/checkpick.js';
import { draft } from '../../src/drafter.js';
import { RATES, MODEL, fakeProvider, toolReply } from '../../test/drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixture');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const ok = [];
const check = (name, pass, note = '') => { ok.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? `  ${note}` : ''}`); };

// ---- (a) where the picks live, and a Revise's reader ------------------------------------------------------------------------------------------
// The answer path (src/panel/author.js, answer()) builds `--picks` from the plan dir's questions + answers. A Revise has only the draft dir; the pointer to the
// plan that asked is redraft-<n>.json `fromPlan`. This reader uses ONLY files on disk. It returns the picks (author.js shape) plus each pick's ruleText.
function picksFromDisk(draftDir) {
  const newest = readJson(path.join(draftDir, 'redraft-1.json')); // the answer redraft's marker: { fromPlan, answers }
  const planDir = path.join(draftDir, newest.fromPlan);
  const { questions } = readQuestions(planDir);
  const rows = questions
    .filter((q) => q.answer !== null && q.source === 'look' && (q.ask === 'check' || q.ask === 'no-check'))
    .map((q) => ({ q, eff: ruleOfAnswer(q, q.answer) }));
  const picks = rows.filter((x) => !x.eff.left).map(({ q, eff }) => ({ line: q.line, rule: q.ruleNo, check: eff.check ?? null, added: eff.rule, ...(eff.own ? { own: true } : {}), ruleText: q.ruleText }));
  const left = rows.filter((x) => x.eff.left).map(({ q }) => ({ line: q.line, rule: q.ruleNo, ruleText: q.ruleText }));
  return { picks, left, planDir };
}

// ---- the keep/ask decision (POC only) ---------------------------------------------------------------------------------------------------------
// A pick is kept when its line and the guardrail's exact words are still on the card. The `~` line an answer ADDED (`added`) is settled while a pick on that line
// recorded it. Everything else is new or changed: it would be sent to the suggestion call and asked.
function decide(stored, card) {
  const parsed = parseSignedText(cardToProse(cardFields(card)));
  assert.ok(parsed.ok, `card does not parse: ${parsed.reds}`);
  const rules = scopedRules(parsed.lines, parsed.arbiter);
  const kept = [];
  const keptLeft = [];
  const settledAdded = [];
  const asks = [];
  for (const r of rules) {
    const p = stored.picks.find((x) => x.line === r.line && x.ruleText === r.text);
    const l = stored.left.find((x) => x.line === r.line && x.ruleText === r.text);
    const covered = stored.picks.some((x) => x.line === r.line && x.added === r.text && (x.check || x.own));
    if (p) kept.push({ ...p, rule: r.rule }); // renumbered to where the guardrail is now
    else if (l) keptLeft.push({ line: r.line, rule: r.rule });
    else if (covered) settledAdded.push(r);
    else asks.push(r);
  }
  // what the plan would carry for the kept picks, by the real settleRules; an `added` line whose pick was not kept is a note, not asked
  const keptRules = rules.filter((r) => !asks.some((a) => a.line === r.line && a.rule === r.rule));
  const settled = settleRules(keptRules, kept, keptLeft);
  return { rules, kept, keptLeft, settledAdded, asks, settled };
}

const cardWith = (over) => ({ ...readJson(path.join(FIX, 'card-1.json')), ...over });
const jobWithout = (card, line) => card.job.split('\n').filter((l) => l !== line).join('\n');
const asksOf = (d) => d.asks.map((a) => `${a.line}:${a.text}`);

function scratch(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-f146-'));
  try { cpSync(FIX, dir, { recursive: true }); return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// bar (a): the rebuilt picks equal what the draft's plan really carries (draft-1/declaration.json) and what author.js would hand `--picks`
function barA(dir) {
  const stored = picksFromDisk(dir);
  const decl = readJson(path.join(dir, 'draft-1', 'declaration.json'));
  const carried = {};
  for (const st of decl.steps) if (st.close?.shape?.picked) carried[st.fromLine] = st.close.shape.picked;
  const rebuilt = {};
  for (const p of stored.picks) if (p.check) rebuilt[p.line] = [...(rebuilt[p.line] ?? []), p.check];
  try { assert.deepEqual(rebuilt, carried); } catch { return { pass: false, why: `rebuilt ${JSON.stringify(rebuilt)} != declaration ${JSON.stringify(carried)}` }; }
  if (stored.picks.length === 0) return { pass: false, why: 'no picks found' };
  return { pass: true, picks: stored.picks.length };
}

// bar (b): four scenarios on the real picks (and an own-words variant for b4)
function barB1(dir) {
  const d = decide(picksFromDisk(dir), cardWith({ capUsd: 0.8 }));
  return { pass: d.asks.length === 0 && d.kept.length === 2, why: `asks ${JSON.stringify(asksOf(d))} kept ${d.kept.length}` };
}
function barB2(dir, { alsoEdit = false } = {}) {
  let c = cardWith({}); c = { ...c, job: c.job.replace('~ under 80 words', '~ under 60 words') };
  if (alsoEdit) c = { ...c, job: c.job.replace('~ exactly 3 bullets', '~ exactly 4 bullets') };
  const d = decide(picksFromDisk(dir), c);
  return { pass: d.asks.length === 1 && d.asks[0].line === 5 && d.asks[0].text === 'under 60 words' && d.kept.length === 1 && d.kept[0].line === 3, why: `asks ${JSON.stringify(asksOf(d))} kept ${JSON.stringify(d.kept.map((k) => k.line))} settledAdded ${JSON.stringify(d.settledAdded.map((x) => x.text))}` };
}
function barB3(dir, { keepStale = false } = {}) {
  // the person deletes line 5's guardrail and the `~` line its agree wrote
  let job = jobWithout(cardWith({}), '~ under 80 words'); job = jobWithout({ job }, '~ at most 80 words');
  const stored = picksFromDisk(dir);
  const d = decide(keepStale ? { ...stored, picks: stored.picks } : stored, cardWith({ job }));
  const gone = !d.kept.some((k) => k.line === 5) && !d.settled.checks.has(5) && d.asks.length === 0 && d.settled.notes.every((n) => n.line !== 5);
  return { pass: gone && d.kept.length === 1, why: `kept ${JSON.stringify(d.kept.map((k) => k.line))} checks5 ${d.settled.checks.has(5)} asks ${JSON.stringify(asksOf(d))}` };
}
// b4: own words. A fresh answered plan dir where line 3's answer is the person's own words, the card grown by the REAL appendAnswersToJob
function ownWordsDir(dir, { stripOwn = false } = {}) {
  const a1 = path.join(dir, 'draft', 'answer-1.json');
  const j = readJson(a1); j.answer = 'three tidy bullets'; j.rule = 'three tidy bullets'; writeFileSync(a1, JSON.stringify(j));
  const base = readJson(path.join(dir, 'card.json'));
  const grown = appendAnswersToJob(base.job, [{ line: 3, answer: 'three tidy bullets' }, { line: 5, answer: 'at most 80 words' }]);
  const card = { ...base, job: grown.job };
  return { card, stripOwn };
}
function barB4(dir, { stripOwn = false } = {}) {
  const { card } = ownWordsDir(dir);
  const stored = picksFromDisk(dir);
  if (stripOwn) stored.picks = stored.picks.map(({ own, ...rest }) => rest);
  const d = decide(stored, { ...card, capUsd: 0.9 });
  const own = d.settled.notes.find((n) => n.line === 3 && n.reason === 'own-words');
  return { pass: d.asks.length === 0 && d.kept.some((k) => k.line === 3 && k.own) && own !== undefined, why: `asks ${JSON.stringify(asksOf(d))} kept ${JSON.stringify(d.kept.map((k) => [k.line, !!k.own]))} notes ${JSON.stringify(d.settled.notes.map((n) => [n.line, n.reason]))}` };
}

// bar (c): what draft() sends the model carries no pick. A sentinel in the picks (the added words and the check's phrase), a fake provider, every message of every call.
const SENT = 'SENTINEL_PICK_f146';
async function barC({ leak = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-f146c-'));
  try {
    const c = cardWith({ job: cardWith({}).job, inputs: `notes: ${path.join(dir, 'notes.md')}`, destination: path.join(dir, 'out') });
    writeFileSync(path.join(dir, 'notes.md'), '# Notes\n- a\n');
    mkdirSync(path.join(dir, 'out'));
    const prose = cardToProse(cardFields({ ...c, job: leak ? c.job.replace('~ exactly 3 bullets', `~ exactly 3 bullets\n~ keep ${SENT}`) : c.job }));
    const planFor = (decl) => decl;
    const plan = { steps: [
      { primitives: ['read'], reads: [], emits: 'garden', fromLine: 1, close: { class: 'hitl' } }, { primitives: [], reads: ['garden'], emits: 'ok1', fromLine: 2, close: { class: 'hitl' } },
      { primitives: ['read'], reads: ['ok1'], emits: 'jobs', fromLine: 3, close: { class: 'hitl' } }, { primitives: [], reads: ['jobs'], emits: 'ok2', fromLine: 4, close: { class: 'hitl' } },
      { primitives: ['read'], reads: ['ok2'], emits: 'note', fromLine: 5, close: { class: 'hitl' } }, { primitives: [], reads: ['note'], emits: 'ok3', fromLine: 6, close: { class: 'hitl' } },
      { primitives: ['write'], reads: ['note', 'ok3'], emits: 'sent', fromLine: 7, close: { class: 'hitl' } },
    ], guardrailClasses: {}, unjudgeable: {}, refused: [] };
    const picks = [
      { line: 3, rule: 1, check: { rule: 'listItems', value: 3 }, added: `${SENT} exactly 3 list items` },
      { line: 5, rule: 1, check: null, added: `${SENT} own words`, own: true },
    ];
    const suggest = { text: '', toolCalls: [{ id: 's1', name: 'suggest_checks', arguments: { checks: [] } }], usage: { inputTokens: 900, outputTokens: 100 }, stopReason: 'tool_calls', model: MODEL };
    const p1 = fakeProvider([suggest]);
    await draft({ proseText: prose, provider: p1, rates: RATES, modelId: MODEL, checkPicks: picks }); // offerQuestions true: the suggestion call
    const p2 = fakeProvider([toolReply(planFor(plan))]);
    await draft({ proseText: prose, provider: p2, rates: RATES, modelId: MODEL, offerQuestions: false, checkPicks: picks }); // the drafting rounds
    const sent = JSON.stringify([...p1.calls, ...p2.calls].map((c) => ({ m: c.messages, t: c.schemas })));
    return { pass: !sent.includes(SENT), why: `calls ${p1.calls.length}+${p2.calls.length}, ${sent.length} bytes sent, sentinel ${sent.includes(SENT) ? 'FOUND' : 'absent'}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- run ---------------------------------------------------------------------------------------------------------------------------------------
const report = (name, r, note = '') => check(name, r.pass, `${r.why ?? (r.picks ? `${r.picks} picks rebuilt` : '')}${note}`);
console.log('== bars as registered');
report('(a) picks rebuilt from questions.json + answer-K.json (via redraft-1.json fromPlan) equal draft-1/declaration.json shape.picked', scratch(barA));
report('(b1) cap-only change: 0 asks, both picks kept', scratch(barB1));
report('(b2) one guardrail changed (line 5): exactly that one asked, line 3 pick kept', scratch(barB2));
report('(b3) guardrail + its agree line deleted: pick gone, no check, no ask', scratch(barB3));
report('(b4) own words on line 3: kept as own-words, not asked, cap-only', scratch(barB4));
report('(c) the model prompt input carries no pick (sentinel in picks, fake provider, all calls)', await barC());

console.log('== must-fail: each bar made red by breaking its input');
const red = (name, r) => { const pass = r.pass === false; ok.push(pass); console.log(`${pass ? 'RED-OK' : 'NOT-RED'}  ${name}  (${r.why ?? ''})`); };
red('(a) with questions.json removed', scratch((d) => { rmSync(path.join(d, 'draft', 'questions.json')); try { return barA(d); } catch (e) { return { pass: false, why: `reader failed: ${e.message.slice(0, 60)}` }; } }));
red('(b1) cap change AND a guardrail word changed', scratch((d) => { const c = cardWith({ capUsd: 0.8 }); const dd = decide(picksFromDisk(d), { ...c, job: c.job.replace('~ exactly 3 bullets', '~ exactly 4 bullets') }); return { pass: dd.asks.length === 0 && dd.kept.length === 2, why: `asks ${JSON.stringify(asksOf(dd))}` }; }));
red('(b2) two guardrails changed', scratch((d) => barB2(d, { alsoEdit: true })));
red('(b3) the guardrail NOT deleted (stale pick would stay)', scratch((d) => { const dd = decide(picksFromDisk(d), cardWith({})); return { pass: !dd.kept.some((k) => k.line === 5), why: `kept lines ${JSON.stringify(dd.kept.map((k) => k.line))}` }; }));
red('(b4) the `own` flag lost', scratch((d) => barB4(d, { stripOwn: true })));
red('(c) a sentinel put into the job lines', await barC({ leak: true }));

console.log('== recorded, not deciding (hard-to-build cases for am17 as signed)');
scratch((d) => {
  const only = (job) => decide(picksFromDisk(d), cardWith({ job }));
  const base = cardWith({}).job;
  const x = only(base.replace('~ at most 80 words', '~ at most 60 words'));
  console.log(`edit only the agree-written line (80 -> 60): asks ${JSON.stringify(asksOf(x))}; kept check on line 5 still ${JSON.stringify(x.settled.checks.get(5))}`);
  const y = only(base.replace('~ under 80 words\n', ''));
  console.log(`delete only the original (agree line stays): asks ${JSON.stringify(asksOf(y))}; settledAdded ${JSON.stringify(y.settledAdded.map((r) => r.text))}`);
  const z = only(`Intro line\n${base}`);
  console.log(`insert a line at the top (line numbers shift by 1): asks ${JSON.stringify(asksOf(z))}; kept ${z.kept.length}`);
  console.log(`a Revise of the newest plan (draft-1) has questions: ${existsSync(path.join(d, 'draft-1', 'questions.json'))}; its picks are only in draft-1/declaration.json shape.picked (checks, no guardrail words), the words are in draft/questions.json + answer-K.json`);
});

const all = ok.every(Boolean);
console.log(all ? 'ALL AS REGISTERED' : 'NOT ALL AS REGISTERED');
process.exit(all ? 0 : 1);
