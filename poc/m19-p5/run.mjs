// M19 P5 (F228): the run path of a shape part, through fwd's real closer path. $0, no AI, no key.
// usage: node poc/m19-p5/run.mjs    (reads bareloop's tests/fixtures/shape-combined/* from the tag v0.61.0 with git show; never from a branch)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeByClass } from '../../src/closers.js';
import { buildShapePart } from '../../src/shaperows.js';
import { buildEmitArtifactSchema } from '../../src/model-step.js';
import { parseSignedText } from '../../src/signed-text.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { WIRED_VERBS } from '../../src/primitives.js';
import { validateDeclaration } from '../../src/declaration.js';

const tag = (f) => execFileSync('git', ['-C', '../bareloop', 'show', `v0.61.0:tests/fixtures/shape-combined/${f}`], { cwd: new URL('../..', import.meta.url).pathname, encoding: 'utf8', maxBuffer: 1 << 26 });
const TAG = buildShapePart({ text: 'the items of line 1', fields: [{ name: 'tag', spec: { kind: 'oneOf', required: true, values: ['a', 'b'] }, rule: 2, by: 'you' }] });
const itemShape = { fields: TAG.fields, ...(Number.isInteger(TAG.minItems) ? { minItems: TAG.minItems } : {}), ...(Number.isInteger(TAG.maxItems) ? { maxItems: TAG.maxItems } : {}) };
const FAKE = 'this sentence is not anywhere on the saved page';
const out = { scenarios: [], o1: {} };
const say = (name, ok, detail) => { out.scenarios.push({ name, ok, ...detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`); };

async function grade(name, mutate = () => {}) {
  const c = JSON.parse(tag(`${name}.part.json`));
  const input = tag(`${name}.input.txt`);
  const answer = JSON.parse(tag(`${name}.answer.json`));
  for (const it of answer.results) it.tag = 'a';
  answer.done = true; answer.blocker = null;
  mutate(answer);
  const cited = { source: c.part.source, facts: c.part.facts, ...(c.part.count ? { count: c.part.count } : {}) };
  const step = { fromLine: 1, close: { class: 'green', cited, itemShape } };
  const source = { ok: true, text: input, sha256: createHash('sha256').update(input).digest('hex') };
  return closeByClass(step, answer, { reads: {}, businessDate: '2026-11-20', source });
}
const gapChecks = (v) => (v.shapeGaps ?? []).map((g) => g.check);

const dell = await grade('dell-1');
say('1 dell-1 as saved is green', dell.verdict === 'green', { verdict: dell.verdict, red: dell.red });

for (const name of ['dell-1', 'flights-3']) {
  const v = await grade(name, (a) => { a.results[0].values.extra = 'x'; });
  const told = String(v.red).split('\n').filter((l) => /extra/.test(l));
  say(`2 V4 ${name}: red, one gap, from itemShape, told once`, v.verdict === 'red' && v.shapeGaps?.length === 1 && gapChecks(v)[0] === 'itemShape' && JSON.stringify(v.shapeGaps[0].items) === JSON.stringify(['#0:values:unknown-field:extra']) && told.length === 1 && String(v.red).split('\n').length === 1,
    { verdict: v.verdict, red: v.red, items: v.shapeGaps?.[0]?.items });
  const w = await grade(name, (a) => { a.results[0].tag = 'z'; a.results[0].quote = FAKE; });
  const lines = String(w.red).split('\n');
  say(`3 V3 ${name}: exactly two gaps, one cited line, one itemShape line`, w.verdict === 'red' && (w.reds ?? []).length === 2 && lines.length === 2 && lines.some((l) => /"tag" is not one of the allowed values/.test(l)) && w.shapeGaps?.length === 1,
    { verdict: w.verdict, reds: w.reds });
}
{
  const bad = await grade('flights-3', (a) => { a.results[0].tag = 'z'; });
  say('4a flights-3 bad tag reds itemShape only', bad.verdict === 'red' && (bad.reds ?? []).length === 1 && bad.shapeGaps?.length === 1 && /"tag" is not one of/.test(String(bad.red)), { reds: bad.reds });
  const q = await grade('flights-3', (a) => { a.results[0].quote = FAKE; });
  say('4b flights-3 made-up quote reds cited only', q.verdict === 'red' && !q.shapeGaps && !/"tag"|item 1/.test(String(q.red)), { red: q.red });
}

// SUPPLEMENT (added after the first run, NOT pre-registered): the dell answer's decimal-comma prices are red in fwd's fact check alone (no itemShape; src/citedcheck.js has no as-written second pass), so the items check
// is shown on dell by itself: the same answer, the same shape part, no quote check.
{
  const c = JSON.parse(tag('dell-1.part.json'));
  const answer = JSON.parse(tag('dell-1.answer.json'));
  for (const it of answer.results) { it.tag = 'a'; }
  const closeOnly = { fromLine: 1, close: { class: 'green', itemShape: { fields: [{ name: 'quote', spec: { kind: 'text', required: true } }, { name: 'values', spec: { kind: 'object', required: true, fields: Object.fromEntries(c.part.facts.map((f) => [f.name, f.shape === 'money' ? { kind: 'number', fromText: true } : { kind: 'text' }])) } }, ...TAG.fields] } } };
  const g = await closeByClass(closeOnly, { ...answer, done: true, blocker: null }, { reads: {}, businessDate: '2026-11-20' });
  say('S1 dell-1 through the items check alone (closed on quote and values) is green', g.verdict === 'green', { verdict: g.verdict, red: g.red });
  answer.results[0].values.extra = 'x';
  const v = await closeByClass(closeOnly, { ...answer, done: true, blocker: null }, { reads: {}, businessDate: '2026-11-20' });
  say('S2 dell-1 V4 through the items check alone: one gap, told once', v.verdict === 'red' && v.shapeGaps?.length === 1 && String(v.red).split('\n').length === 1, { red: v.red });
}

// O1: a shape-only answer through option (i) softgreen and option (ii) green with no cited
const GOODS = { results: [{ tag: 'a' }, { tag: 'b' }], done: true, blocker: null };
const BADS = { results: [{ tag: 'a' }, { tag: 'z' }], done: true, blocker: null };
const prose = `1. List my research items,
   guardrail: each item has a tag
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source notes = page:https://example.com/notes
`;
const signed = parseSignedText(prose);
const cat = loadCatalogue();
for (const [label, cls] of [['option i (softgreen reads results)', 'softgreen'], ['option ii (green with no cited)', 'green']]) {
  const rec = {};
  const step = { fromLine: 1, close: { class: cls, itemShape } };
  const g = await closeByClass(step, GOODS, { reads: {}, businessDate: '2026-11-20' });
  const b = await closeByClass(step, BADS, { reads: {}, businessDate: '2026-11-20' });
  rec.a = { good: g.verdict, bad: b.verdict, badRed: b.red };
  try { const s = buildEmitArtifactSchema(cls, false, null, false, true); rec.b = { ok: true, required: s.required, keys: Object.keys(s.properties) }; } catch (e) { rec.b = { ok: false, error: e.message }; }
  const decl = { steps: [
    { goal: signed.lines[0].text, primitives: [], reads: ['notes'], emits: 'items', fromLine: 1, close: { class: cls, itemShape } },
    { goal: signed.lines[1].text, primitives: [], reads: ['items'], emits: 'accepted', fromLine: 2, close: { class: 'hitl' } },
    { goal: signed.lines[2].text, primitives: ['write'], reads: ['accepted'], emits: 'sent', fromLine: 3, close: { class: 'hitl' } },
  ], guardrailClasses: { 1: cls, 2: 'hitl' }, unjudgeable: {}, refused: [], inputFacts: {} };
  const r = validateDeclaration(decl, { arbiter: signed.arbiter, lines: signed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: false, fitJobLine: true });
  rec.c = { ok: r.ok === true, reds: r.ok ? [] : r.reds };
  out.o1[label] = rec;
  console.log(`O1 ${label}\n  (a) closeByClass: good ${g.verdict}, bad ${b.verdict}: ${b.red}\n  (b) emit schema: ${JSON.stringify(rec.b)}\n  (c) validateDeclaration: ${r.ok === true ? 'accepted' : `refused: ${JSON.stringify(r.reds)}`}`);
}
// SUPPLEMENT 2 (added after the first run, NOT pre-registered): a list line that also carries the person's pick (a text check, `close.picked`), the "text+list" line of the signed section 3.6
{
  const picked = [{ rule: 'maxWords', value: 5 }];
  const ii = { fromLine: 1, pickedLines: [1], close: { class: 'green', itemShape, picked } };
  const g = await closeByClass(ii, { results: GOODS.results, text: 'four words only here', done: true, blocker: null }, { reads: {}, businessDate: '2026-11-20' });
  const b = await closeByClass(ii, { results: GOODS.results, text: 'this text has far more than five words in it', done: true, blocker: null }, { reads: {}, businessDate: '2026-11-20' });
  say('S3 option ii with a pick: good green, long text red by the pick, items still read', g.verdict === 'green' && b.verdict === 'red', { good: g.verdict, bad: b.verdict, badRed: b.red });
  const i = { fromLine: 1, close: { class: 'softgreen', itemShape, shape: { picked } } };
  const r = await closeByClass(i, { results: GOODS.results, text: 'this text has far more than five words in it', done: true, blocker: null }, { reads: {}, businessDate: '2026-11-20' });
  console.log(`O1 option i with a pick: closeByClass on a long text gives ${r.verdict} (the pick is ${r.verdict === 'green' ? 'NOT read' : 'read'}); the validator refuses the close (checkItemShapeKey)`);
  out.o1.optionIPick = { verdict: r.verdict };
}
const failed = out.scenarios.filter((s) => !s.ok);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nall scenarios passed');
process.exitCode = failed.length ? 1 : 0;
