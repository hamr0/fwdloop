// M4e amendment 19 (SIGNED 2026-10-09): 1 (old roll-ups of "process gone" runs), 2 ("N more" counts blocks), 3 (one stopped-ask
// label reader), 4 (every softgreen check built before the first model call). $0: no provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readAudit } from '../src/books.js';
import { sendViaPrimitive } from '../src/send.js';
import * as R from '../src/runner.js';
import * as monthly from '../src/monthly.js';
import { fileURLToPath } from 'node:url';
import { getRunAsks, listRuns, listStops } from '../src/panel/data.js';

const { runFlow, makeParkingAskStep, requestStop } = R;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;

function mk(tag, declMut = (d) => d) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am19-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
  };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: declMut(JSON.parse(fixture('job2.m1.declaration.json'))), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.flowDir = path.join(w.root, 'job2');
  w.runDir = path.join(w.flowDir, 'runs', 'run-1');
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  return w;
}
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const emitsOf = (ctx) => (ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary');
let modelCalls = 0;
const stepFn = async (ctx) => {
  modelCalls += 1;
  const emits = emitsOf(ctx);
  return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
};
const args = (w, extra = {}) => ({
  root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep: stepFn, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), ...extra,
});
const view = (w) => ({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });

// ---- 1 ----
const NOW = Date.parse('2026-10-08T12:00:00Z');
const iso = (d) => new Date(NOW - d * 86400000).toISOString();
test('1 an OLD rolled row for a "process gone" run is ignored: month and total equal the disk', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-am19-1-'));
  try {
    const home = path.join(base, 'cfg');
    mkdirSync(home, { mode: 0o700 });
    const d = path.join(base, 'runs', 'gone');
    mkdirSync(d, { recursive: true });
    const spend = (usd) => `${JSON.stringify({ kind: 'step', provider: 'deepseek', costUsd: usd, spendComplete: true, at: iso(1) })}\n`;
    writeFileSync(path.join(d, 'spend.jsonl'), spend(0.01));
    const L = [
      { kind: 'hold', holdId: 'g', what: 'run', flow: 'j', runId: 'gone', runDir: d, pid: 1, procStart: null, holdUsd: 0.25, spentAtHold: 0, at: iso(1) },
      { kind: 'settled', holdId: 'g', at: iso(1), why: 'process gone' },
      // written by a build before amendment 17 3A: it stands in for the dir
      { kind: 'rolled', at: iso(1), seen: 2, dirs: { [d]: [{ u: 0.01, c: true, t: 0, w: null, p: 'deepseek', a: iso(1) }] } },
    ];
    writeFileSync(path.join(home, 'runs.jsonl'), `${L.map((l) => JSON.stringify(l)).join('\n')}\n`);
    appendFileSync(path.join(d, 'spend.jsonl'), spend(0.5));
    const s = monthly.spendSummary({ home, now: () => NOW });
    assert.ok(Math.abs(s.month.usd - 0.51) < 1e-9, `month ${s.month.usd}`);
    assert.ok(Math.abs(s.total.usd - 0.51) < 1e-9, `total ${s.total.usd}`);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// ---- 3 ----
test('3 a lost ask file (2 paused rows, 1 ask): the Runs label, the Ask tab and the Inbox all say plain "stopped"', async () => {
  const w = mk('3');
  try {
    const r = await runFlow({ ...args(w), sources: w.sources });
    assert.equal(r.outcome, 'paused', r.red);
    requestStop(w.runDir);
    const stop = await R.stopParkedRun({ root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT });
    assert.equal(stop.outcome, 'stopped', stop.red);
    const known = listRuns({ root: w.root, catalogue: CAT }).find((x) => x.runId === 'run-1');
    assert.match(known.label, /^stopped at the ask of step 4; /, 'sanity: with the books whole, the label names the step');
    // the books now hold one more "paused" row than asks: the step cannot be known
    const rows = readAudit(w.runDir);
    const paused = rows.find((x) => x.verdict === 'paused');
    writeFileSync(path.join(w.runDir, 'audit.jsonl'), `${[paused, ...rows].map((x) => JSON.stringify(x)).join('\n')}\n`);
    const label = listRuns({ root: w.root, catalogue: CAT }).find((x) => x.runId === 'run-1').label;
    const ask = getRunAsks(view(w)).asks[0].statusText;
    const inbox = listStops({ root: w.root }).find((x) => x.runId === 'run-1').statusText;
    assert.equal(ask, undefined, 'Ask tab: plain stopped');
    assert.equal(inbox, undefined, 'Inbox: plain stopped');
    assert.doesNotMatch(label, /at the ask of step/, `Runs label must not name a step the Ask tab cannot: ${label}`);
    assert.match(label, /^stopped\b/);
  } finally { rmSync(w.base, { recursive: true, force: true }); }
});
