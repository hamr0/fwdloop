// M4e amendment 18 ledger idea: a softgreen step that cannot be built (or whose answer cannot be judged) is never green and never unpriced.
// Runner level, $0 (fake model steps). Which path each old-green/new-crash shape takes:
//   - every unbuildable shape is stopped BEFORE any model call (preflight-red from runFlow, refused from resumeRun/continueRun;
//     'refused' at read when the signed validator itself rejects the declaration: sections not an array, wordsPerSection as an array): no spend, named by step, never green.
//   - the close-casualty + spend booking is reached by an unjudgeable answer on a buildable step (unparseable): booked, priced, never green.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFlow } from '../src/flow.js';
import { signFlow } from '../src/signature.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readAudit, readHistory } from '../src/books.js';
import { sendViaPrimitive } from '../src/send.js';
import * as R from '../src/runner.js';

const { runFlow, resumeRun, continueRun, makeParkingAskStep } = R;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const COST = 0.001;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const emitsOf = (ctx) => (ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary');

function mk(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am18r-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'), calls: 0, badAnswer: false,
  };
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
  w.modelStep = async (ctx) => {
    w.calls += 1;
    const emits = emitsOf(ctx);
    const artifact = emits === 'resume-summary' ? (w.badAnswer ? { notText: 'x', done: true } : { text: GOOD, done: true }) : { text: emits, done: true };
    return { ok: true, costUsd: COST, turns: 1, artifact };
  };
  w.args = (extra = {}) => ({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep: w.modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), ...extra,
  });
  return w;
}

/** Re-sign the flow with the step-3 shape changed: a flow signed before amendment 18 (the sign-time validator would refuse it now). */
function resignWithShape(w, mut) {
  const declPath = path.join(w.flowDir, 'declaration.json');
  const decl = JSON.parse(readFileSync(declPath, 'utf8'));
  mut(decl.steps.find((x) => x.close?.shape?.sections).close.shape);
  const declarationText = `${JSON.stringify(decl, null, 2)}\n`;
  const sig = signFlow({
    proseText: readFileSync(path.join(w.flowDir, 'prose.txt'), 'utf8'), declarationText, signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z',
  });
  assert.equal(sig.ok, true);
  writeFileSync(declPath, declarationText);
  writeFileSync(path.join(w.flowDir, 'signature.json'), `${JSON.stringify(sig.signature, null, 2)}\n`);
}

const auditUsd = (dir) => readAudit(dir).reduce((a, r) => a + (typeof r.usd === 'number' ? r.usd : 0), 0);
const histUsd = (flowDir) => readHistory(flowDir).reduce((a, r) => a + (typeof r.spentUsd === 'number' ? r.spentUsd : 0), 0);

const SHAPES = [
  ['mustCarry alone', (sh) => { delete sh.linesPerInvoice; sh.mustCarry = ['x']; }, 'preflight-red'],
  ['linesPerInvoice alone', (sh) => { delete sh.mustCarry; sh.linesPerInvoice = 2; }, 'preflight-red'],
  ['sections not an array', (sh) => { sh.sections = 'summary'; }, 'refused'],
  ['wordsPerSection (array) with no sections', (sh) => { delete sh.sections; sh.wordsPerSection = [1, 5]; }, 'refused'],
  ['wordsPerSection (number) with no sections', (sh) => { delete sh.sections; sh.wordsPerSection = 20; }, 'preflight-red'],
];

for (const [name, mut, firstOutcome] of SHAPES) {
  test(`runFlow: "${name}" is stopped before any model call: ${firstOutcome}, $0, never green`, async () => {
    const w = mk(`run-${name.replace(/\W/g, '')}`);
    try {
      resignWithShape(w, mut);
      const r = await runFlow({ ...w.args(), sources: w.sources });
      assert.equal(w.calls, 0, 'no model call');
      assert.equal(r.outcome, firstOutcome, JSON.stringify(r).slice(0, 300));
      if (firstOutcome === 'preflight-red') assert.match(r.red, /^This flow will not run: step 3/);
      assert.equal(readAudit(w.runDir).some((x) => x.verdict === 'green' || x.verdict === 'close-casualty'), false);
      assert.equal(existsSync(path.join(w.runDir, 'spend.jsonl')), false, 'nothing spent');
      assert.equal(auditUsd(w.runDir), 0);
      assert.equal(histUsd(w.flowDir), 0, 'history books $0');
    } finally { rmSync(w.base, { recursive: true, force: true }); }
  });

  test(`resumeRun/continueRun: "${name}" after a first run parked is refused by name, no model call, no new spend`, async () => {
    const w = mk(`res-${name.replace(/\W/g, '')}`);
    try {
      const first = await runFlow({ ...w.args(), sources: w.sources });
      assert.equal(first.outcome, 'paused', JSON.stringify(first).slice(0, 300));
      const callsBefore = w.calls;
      const usdBefore = auditUsd(w.runDir);
      assert.ok(near(usdBefore, first.spentUsd), 'the paused run reports what the audit holds');
      resignWithShape(w, mut);
      for (const fn of [resumeRun, continueRun]) {
        const r = await fn(w.args());
        assert.equal(r.outcome, 'refused', `${fn.name}: ${JSON.stringify(r).slice(0, 300)}`);
        if (firstOutcome === 'preflight-red') assert.match(r.red, /step 3/, `${fn.name} names the step`);
        assert.equal(w.calls, callsBefore, `${fn.name}: no model call`);
        assert.ok(near(auditUsd(w.runDir), usdBefore), `${fn.name}: no new spend booked`);
        assert.equal(readAudit(w.runDir).some((x) => x.verdict === 'close-casualty'), false);
      }
    } finally { rmSync(w.base, { recursive: true, force: true }); }
  });
}

test('close-casualty with spend: an unjudgeable answer on a buildable softgreen step is booked priced, never green, and the books balance', async () => {
  const w = mk('casualty');
  try {
    w.badAnswer = true;
    const r = await runFlow({ ...w.args(), sources: w.sources });
    assert.equal(r.outcome, 'close-casualty', JSON.stringify(r).slice(0, 300));
    assert.match(r.red, /resume-summary|Draft the summary/, 'names the step');
    assert.match(r.red, /unparseable/);
    const rows = readAudit(w.runDir);
    const bad = rows.filter((x) => x.step === 'resume-summary');
    assert.equal(bad.length, 1, 'one attempt, a casualty is not a retry');
    assert.equal(bad[0].verdict, 'close-casualty');
    assert.equal(bad[0].spendComplete, true);
    assert.ok(near(bad[0].usd, COST), `the casualty round is priced, not 0/null: ${bad[0].usd}`);
    assert.equal(rows.some((x) => x.step === 'resume-summary' && x.verdict === 'green'), false, 'never green');
    // 2 read steps + the casualty round, every call priced
    assert.equal(w.calls, 3);
    assert.ok(near(auditUsd(w.runDir), 3 * COST), `audit sum ${auditUsd(w.runDir)}`);
    assert.ok(near(histUsd(w.flowDir), auditUsd(w.runDir)), `history total ${histUsd(w.flowDir)} equals audit total`);
  } finally { rmSync(w.base, { recursive: true, force: true }); }
});
