// M4e amendment 23 (SIGNED 2026-10-09): a flow that will not run says why in plain words. One function makes the sentence; bareguard's
// raw reason is kept apart (`detail`) in the run's records. $0: no provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { signFlow } from '../src/signature.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readHistory } from '../src/books.js';
import { sendViaPrimitive } from '../src/send.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { findUnbuildableCheckStep, unbuildableSay, willNotRunSay } from '../src/canrun.js';
import { killChildrenAfter, world } from './m4e-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const SIGN = 'and sign the job again';
const OLD = 'x'.repeat(1001);

// Every case a signed flow can hold that bareguard cannot build (a flow signed before the sign-time validator tightened).
const CASES = [
  ['a section name ending in ":"', (sh) => { sh.sections[0] += ':'; },
    `This flow will not run: step 3's section name "summary of work history blurb:" ends in ':'. Remove the ':' ${SIGN}.`],
  ['a blank section name', (sh) => { sh.sections[1] = '   '; },
    `This flow will not run: step 3's section name is blank. Fill it in or remove it, ${SIGN}.`],
  ['a blank required phrase', (sh) => { sh.linesPerInvoice = 2; sh.mustCarry = ['ok', ' ']; },
    `This flow will not run: step 3's required phrase is blank. Fill it in or remove it, ${SIGN}.`],
  ['an over-long section name', (sh) => { sh.sections[2] = OLD; },
    `This flow will not run: step 3's section name "${'x'.repeat(40)}..." is 1001 characters, and the most one may be is 1000. Shorten it ${SIGN}.`],
  ['an over-long required phrase', (sh) => { sh.linesPerInvoice = 2; sh.mustCarry = [OLD]; },
    `This flow will not run: step 3's required phrase "${'x'.repeat(40)}..." is 1001 characters, and the most one may be is 1000. Shorten it ${SIGN}.`],
  ['an empty section list', (sh) => { sh.sections = []; },
    `This flow will not run: step 3's section list is empty. Name at least one, or remove the list, ${SIGN}.`],
  ['an empty required-phrase list', (sh) => { sh.linesPerInvoice = 2; sh.mustCarry = []; },
    `This flow will not run: step 3's required-phrase list is empty. Name at least one, or remove the list, ${SIGN}.`],
  ['wordsPerSection with no sections', (sh) => { delete sh.sections; sh.wordsPerSection = 50; },
    `This flow will not run: step 3's check sets a size for each section but names no sections. Name the sections or remove the size, ${SIGN}.`],
  ['mustCarry alone', (sh) => { sh.mustCarry = ['x']; },
    `This flow will not run: step 3's invoice check has the words each invoice must carry but not the other half. Add the missing half or remove this one, ${SIGN}.`],
  ['linesPerInvoice alone', (sh) => { sh.linesPerInvoice = 2; },
    `This flow will not run: step 3's invoice check has the lines in each invoice but not the other half. Add the missing half or remove this one, ${SIGN}.`],
];
const RAW = /spec\.|checks\[|invalid rubric/;
const declWith = (mut) => {
  const d = JSON.parse(fixture('job2.m1.declaration.json'));
  mut(d.steps.find((x) => x.close?.shape?.sections).close.shape);
  return d;
};

for (const [name, mut, sentence] of CASES) {
  test(`23 ${name}: one plain sentence, no spec./checks[, the raw reason kept apart`, () => {
    const found = findUnbuildableCheckStep(declWith(mut));
    assert.ok(found, 'bareguard really cannot build this shape');
    assert.equal(found.say, sentence);
    assert.doesNotMatch(found.say, RAW);
    assert.match(found.why, /\S/);
    assert.notEqual(found.why, found.say);
  });
}

test('23 a shape no rule classifies gets the generic sentence', () => {
  assert.equal(unbuildableSay(4, { maxWords: 5 }), "This flow will not run: step 4's check cannot be built. Draft the job again.");
});

test('23 the sentence is not wrapped again by the run door / Run again', () => {
  const s = unbuildableSay(3, { sections: ['a:'] });
  assert.equal(willNotRunSay('job2', s), s);
});

function mk(tag, mut) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am23-${tag}-`));
  const w = { base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src') };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.flowDir = path.join(w.root, 'job2');
  w.runDir = path.join(w.flowDir, 'runs', 'run-1');
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  resign(w.flowDir, (d) => mut(d.steps.find((x) => x.close?.shape?.sections).close.shape));
  return w;
}
function resign(flowDir, mut) {
  const decl = JSON.parse(readFileSync(path.join(flowDir, 'declaration.json'), 'utf8'));
  mut(decl);
  const declarationText = `${JSON.stringify(decl, null, 2)}\n`;
  const sig = signFlow({ proseText: readFileSync(path.join(flowDir, 'prose.txt'), 'utf8'), declarationText, signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z' });
  assert.equal(sig.ok, true);
  writeFileSync(path.join(flowDir, 'declaration.json'), declarationText);
  writeFileSync(path.join(flowDir, 'signature.json'), `${JSON.stringify(sig.signature, null, 2)}\n`);
}

test('23 the run preflight refusal: plain sentence in red, raw reason in the history row detail, none in the sentence', async () => {
  const w = mk('run', CASES[0][1]);
  try {
    const r = await runFlow({
      root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep: async () => assert.fail('no model call'), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), sources: w.sources,
    });
    assert.equal(r.outcome, 'preflight-red');
    assert.equal(r.red, CASES[0][2]);
    assert.doesNotMatch(r.red, RAW);
    assert.match(r.detail, /checks\[\d+\]\.names\[0\]/);
    const rows = readHistory(w.flowDir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail, r.detail, 'the raw reason is in the history row');
    assert.equal(rows[0].outcome, 'preflight-red');
    assert.doesNotMatch(JSON.stringify({ ...rows[0], detail: '' }), RAW);
  } finally { rmSync(w.base, { recursive: true, force: true }); }
});

test('23 the panel run door and Run again say the same plain sentence', async () => {
  const w = await world();
  const bad = await w.signedFlow({ flowName: 'bad' });
  w.seedPassed('bad', 'seed');
  resign(bad.flowDir, CASES[0][1] && ((d) => {
    const st = d.steps.find((x) => x.close?.shape?.sections);
    if (st) CASES[0][1](st.close.shape);
  }));
  const again = await w.get('/api/author/run-again?flow=bad&runId=seed');
  assert.equal(again.status, 409, again.text);
  assert.match(again.json().say, /^This flow will not run: step \d+'s section name ".*:" ends in ':'\. Remove the ':' and sign the job again\.$/);
  assert.doesNotMatch(again.text, RAW);
  const run = await w.post('/api/author/run', { flow: 'bad', inputs: w.inputs(), runId: 'r1' });
  assert.equal(run.status, 409, run.text);
  assert.equal(run.json().say, again.json().say);
  assert.doesNotMatch(run.text, RAW);
});
