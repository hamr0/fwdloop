// M20 am1 item 8: the NOW row. A model step's try writes one report-only `try-start` diary row; the Run tab's summary says "AI working · M:SS"
// (30 s steps) only while the run is live and that try is running; the row changes no check, cost or count the Audit shows. $0, in-process.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { readTryStarts } from '../src/diary.js';
import { getRunAudit, getRunDetail, nowOf } from '../src/panel/data.js';
import { killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';

async function greenRun() {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m20now-'));
  const w = { root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src') };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = readFileSync(path.join(HERE, 'fixtures', 'job2-with-sources.signed.txt'), 'utf8').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const decl = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'job2.m1.declaration.json'), 'utf8'));
  const r = writeFlow({ root: w.root, name: 'job2', proseText: prose, declaration: decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.runDir = path.join(w.root, 'job2', 'runs', 'run-1');
  const modelStep = async (ctx) => {
    const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  const run = await runFlow({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), sources: [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }],
  });
  w.run = run;
  w.cleanup = () => rmSync(base, { recursive: true, force: true });
  return w;
}

const live = { historyRow: null, glyphOk: true };
const ctxOf = (over) => ({ historyRow: null, tryStart: { step: 's', try: 1, at: '2026-11-25T10:00:00.000Z' }, auditRows: [], ...over });
const T0 = Date.parse('2026-11-25T10:00:00.000Z');

test('nowOf: AI working · M:SS in 30 s steps, only while live and the try is running', () => {
  assert.equal(nowOf(ctxOf({}), '[▶]', T0 + 29_000), 'AI working · 0:00');
  assert.equal(nowOf(ctxOf({}), '[▶]', T0 + 31_000), 'AI working · 0:30');
  assert.equal(nowOf(ctxOf({}), '[▶]', T0 + 125_000), 'AI working · 2:00');
  assert.equal(nowOf(ctxOf({ historyRow: { outcome: 'complete' } }), '[✓]', T0 + 5000), null, 'ended');
  assert.equal(nowOf(ctxOf({}), '[·]', T0 + 5000), null, 'parked at an ask: not live');
  assert.equal(nowOf(ctxOf({ tryStart: null }), '[▶]', T0 + 5000), null, 'no try begun');
  assert.equal(nowOf(ctxOf({ auditRows: [{ at: '2026-11-25T10:00:09.000Z' }] }), '[▶]', T0 + 20_000), null, 'the try wrote its audit row: ended');
  assert.equal(nowOf(ctxOf({ auditRows: [{ at: '2026-11-25T10:00:00.000Z' }] }), '[▶]', T0 + 20_000), null, 'tie: an equal time counts as ended');
  assert.equal(nowOf(ctxOf({ auditRows: [{ at: '2026-11-25T09:59:59.999Z' }] }), '[▶]', T0 + 20_000), 'AI working · 0:00', 'an earlier try\'s row does not end this one');
  assert.equal(nowOf(ctxOf({ tryStart: { step: 's', try: 1, at: 'junk' } }), '[▶]', T0), null, 'unreadable time: nothing made up');
});

test('a real run writes a try-start row per model-step try, and the Audit answer is the same without them', async () => {
  const w = await greenRun();
  try {
    assert.equal(w.run.outcome, 'paused', w.run.red);
    const rows = readTryStarts(w.runDir);
    assert.ok(rows.length >= 3, `one per model-step try, got ${rows.length}`);
    for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['at', 'kind', 'step', 'try']);
    const detail = getRunDetail({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
    assert.equal(detail.summary.now, null, 'parked at its ask: no NOW');
    const audit = () => JSON.stringify(getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT }));
    const withRows = audit();
    const f = path.join(w.runDir, 'diary.jsonl');
    const kept = readFileSync(f, 'utf8').split('\n').filter((l) => l !== '' && JSON.parse(l).kind !== 'try-start');
    assert.ok(kept.length > 0);
    writeFileSync(f, `${kept.join('\n')}\n`);
    assert.equal(readTryStarts(w.runDir).length, 0);
    assert.equal(audit(), withRows, 'the try-start rows change nothing the Audit shows');
  } finally { w.cleanup(); }
});
