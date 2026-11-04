// M10 am19: a plan where an input can be reached by no step is red at $0: `Input "<role>" is read by no step.` Fake provider, no key.
// Ruling A by hamr 2026-11-04: md/txt/page/ticket -> read or grep; docx -> readDocx; csv -> addressCells; or the role in `reads`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';
import { draft } from '../src/drafter.js';
import { plainPlanCheck } from '../src/plain-checks.js';
import { RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply } from './drafter-fixture.mjs';

const cat = loadCatalogue();
const red = (role) => `Input "${role}" is read by no step.`;

/** the job2 plan with resume/jd pointed at files of the given extensions, step 1 (resume) and 2 (jd) granted `verbs1` / `verbs2` */
function check({ extResume = '.md', extJd = '.md', verbs1, verbs2, reads1 = [], reads2 = [], page = false }) {
  const fx = job2Fixture();
  let prose = fx.prose.replace(fx.resume, fx.resume.replace(/\.md$/, extResume)).replace(fx.jd, fx.jd.replace(/\.md$/, extJd));
  if (page) prose = prose.replace(/guardrail: source jd = file:\S+/, 'guardrail: source jd = page:http://127.0.0.1:1/x');
  const signed = parseSignedText(prose);
  assert.equal(signed.ok, true, signed.ok ? '' : signed.reds.join('\n'));
  const d = validArgs();
  d.inputFacts = { resume: [], jd: [] };
  d.steps[0].primitives = verbs1; d.steps[0].reads = reads1;
  d.steps[1].primitives = verbs2; d.steps[1].reads = reads2;
  d.steps[2].primitives = [];
  const v = validateDeclaration(d, { arbiter: signed.arbiter, lines: signed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, fitJobLine: true });
  return v.ok ? [] : v.reds;
}
const has = (reds, role) => reds.includes(red(role));

test('walk-7 shape: steps hold write only, so the input is read by no step, named', () => {
  const reds = check({ verbs1: ['write'], verbs2: ['write'] });
  assert.ok(has(reds, 'resume') && has(reds, 'jd'), reds.join(' | '));
});

test('walk-6 shape: read granted to steps, no unreached red', () => {
  const reds = check({ verbs1: ['read'], verbs2: ['read'] });
  assert.ok(!reds.some((r) => /is read by no step/.test(r)), reds.join(' | '));
});

test('md input: grep counts, read counts', () => {
  assert.ok(!has(check({ verbs1: ['grep'], verbs2: ['read'] }), 'resume'));
});

test('docx input: readDocx counts, an unrelated read does not', () => {
  assert.ok(!has(check({ extResume: '.docx', verbs1: ['readDocx'], verbs2: ['read'] }), 'resume'));
  assert.ok(has(check({ extResume: '.docx', verbs1: ['read'], verbs2: ['read'] }), 'resume'));
});

test('csv input: addressCells counts, an unrelated read does not', () => {
  assert.ok(!has(check({ extResume: '.csv', verbs1: ['addressCells'], verbs2: ['read'] }), 'resume'));
  assert.ok(has(check({ extResume: '.csv', verbs1: ['read'], verbs2: ['read'] }), 'resume'));
});

test('page input: read counts, readDocx does not', () => {
  assert.ok(!has(check({ page: true, verbs1: ['read'], verbs2: ['read'] }), 'jd'));
  { const r = check({ page: true, verbs1: ['readDocx'], verbs2: ['readDocx'] }); assert.ok(has(r, 'jd'), r.join(' | ')); }
});

test('a role in `reads` counts', () => {
  const reds = check({ extResume: '.csv', verbs1: [], verbs2: ['read'], reads1: ['resume'] });
  assert.ok(!has(reds, 'resume'), reds.join(' | '));
});

test('ask and send steps are not model steps: a grant on them does not count', () => {
  const fx = job2Fixture();
  const signed = parseSignedText(fx.prose);
  const d = validArgs();
  d.inputFacts = { resume: [], jd: [] };
  d.steps[0].primitives = ['write']; d.steps[1].primitives = ['write']; d.steps[2].primitives = [];
  d.steps[3].primitives = ['read']; d.steps[4].primitives = ['read'];
  const v = validateDeclaration(d, { arbiter: signed.arbiter, lines: signed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, fitJobLine: true });
  assert.ok(has(v.reds, 'resume') && has(v.reds, 'jd'), v.reds.join(' | '));
});

test('plain words: the shown sentence names the input', () => {
  assert.match(plainPlanCheck(red('notes')).say, /notes/);
  assert.equal(plainPlanCheck(red('notes')).fix, 'Draft again.');
});

test('draft: refused on try 1, the red told to try 2, fixed on try 2 -> green', async () => {
  const fx = job2Fixture();
  const bad = validArgs();
  bad.steps[0].primitives = []; bad.steps[1].primitives = []; bad.steps[2].primitives = [];
  const p = fakeProvider([toolReply(bad), toolReply(validArgs())]);
  const r = await draft({ proseText: fx.prose, provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(p.calls.length, 2);
  const told = JSON.stringify(p.calls[1].messages);
  assert.ok(told.includes(JSON.stringify(red('resume')).slice(1, -1)) && told.includes(JSON.stringify(red('jd')).slice(1, -1)), 'try 2 was told the red');
});

test('draft: tries run out -> red to the human with the sentence', async () => {
  const fx = job2Fixture();
  const bad = validArgs();
  bad.steps[0].primitives = []; bad.steps[1].primitives = []; bad.steps[2].primitives = [];
  const r = await draft({ proseText: fx.prose, provider: fakeProvider([toolReply(bad)]), rates: RATES, modelId: MODEL });
  assert.equal(r.ok, false);
  assert.ok(r.reds.includes(red('resume')));
});
