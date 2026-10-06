// M4e amendment 7 walk defects in Audit: a Stop's rows name their step (so the group is the step's, never a null id), a row with no
// attempt/close shows nothing / "—", a step-less row is the group "run", and the phone layout wraps the verdict and the group header.
// $0: a fake modelStep; page checks are source-level (a real render is the browser re-walk).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readHistory, readAudit } from '../src/books.js';
import { answerAsk } from '../src/ask.js';
import { makeLiveModelStep } from '../src/model-step.js';
import {
  runFlow, resumeRun, continueRun, makeParkingAskStep, STOP_FILE, requestStop, readHaltRecord,
} from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { getRunAudit, deriveAuditGroups } from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const cat = loadCatalogue();
assert.equal(cat.ok, true);
const CAT = cat.primitives;

function mk(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am7-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
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
  return w;
}

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const emitsOf = (ctx) => (ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary');
/** A fake modelStep: steps 1-2 always green; step 3 returns `plan(callNo)` ('red' | 'good'); `onCall(callNo)` runs inside the call. */
function fake({ plan = () => 'good', onCall } = {}) {
  const calls = [];
  const fn = async (ctx) => {
    const emits = emitsOf(ctx);
    calls.push(emits);
    const callNo = calls.filter((c) => c === 'resume-summary').length;
    if (emits === 'resume-summary' && onCall) await onCall(callNo);
    if (emits === 'resume-summary' && plan(callNo) === 'red') return { ok: true, costUsd: 0.001, turns: 2, artifact: { text: 'no headings here', done: true } };
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  return { fn, calls };
}
const args = (w, modelStep, extra = {}) => ({
  root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), ...extra,
});
const stopRows = (runDir) => readAudit(runDir).filter((r) => /^stop/.test(r.verdict));
const PAGE = readFileSync(path.join(HERE, '../src/panel/index.html'), 'utf8');
const rule = (sel) => { const i = PAGE.indexOf(sel); assert.ok(i >= 0, sel); return PAGE.slice(i, PAGE.indexOf('}', i)); };

test('walk 2: a Stop mid-step names the step it is about on both rows; the served group is that step\'s, never null', async () => {
  const w = mk('g1');
  const { fn } = fake({ plan: () => 'red', onCall: (n) => { if (n === 1) requestStop(w.runDir); } });
  const r = await runFlow({ ...args(w, fn), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  assert.deepEqual(stopRows(w.runDir).map((x) => x.step), ['resume-summary', 'resume-summary']);
  const groups = getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT }).groups;
  assert.ok(groups.every((g) => typeof g.step === 'string' && g.step.length > 0 && !g.run), 'no nameless group');
  const g = groups.find((x) => x.step === 'resume-summary');
  assert.equal(g.tryCount, 1, 'the notes are not tries');
});

test('walk 2: a Stop at a step boundary lands in the step it follows; "not honoured" in the step the run ended on', async () => {
  const w = mk('g2');
  const { fn } = fake();
  let seen = 0;
  const gated = async (ctx, ...rest) => { const out = await fn(ctx, ...rest); seen += 1; if (seen === 2) requestStop(w.runDir); return out; };
  await runFlow({ ...args(w, gated), sources: w.sources });
  assert.deepEqual(stopRows(w.runDir).map((x) => x.step), ['jd-text', 'jd-text'], 'stopped after step 2');
  const w2 = mk('g3');
  const f2 = fake({ plan: () => 'red', onCall: (n) => { if (n === 3) requestStop(w2.runDir); } });
  await runFlow({ ...args(w2, f2.fn), sources: w2.sources });
  assert.deepEqual(stopRows(w2.runDir).map((x) => [x.verdict, x.step]), [['stop-asked', 'resume-summary'], ['stop-not-honoured', 'resume-summary']]);
});

test('walk 2: a Stop before step 1 has no step; deriveAuditGroups makes it the group "run" with no tries, never a null id', () => {
  const rows = [
    { step: null, attempt: null, class: null, verdict: 'stop-asked', gap: 'stop asked (you) at t', usd: 0, spendComplete: true, wallMs: 0 },
    { step: null, attempt: null, class: null, verdict: 'stopped', gap: 'stopped before step 1', usd: 0, spendComplete: true, wallMs: 0 },
  ];
  const groups = deriveAuditGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].step, 'run');
  assert.equal(groups[0].run, true);
  assert.equal(groups[0].tryCount, 0);
  assert.deepEqual(groups[0].tryMarks, []);
  // the page: no tries, no dots, and a Stop's own words do not open the group
  const i = PAGE.indexOf('function buildAuditGroupHeaderEl');
  assert.match(PAGE.slice(i, PAGE.indexOf('return h4;', i)), /else if\(g\.run\)/);
  assert.match(PAGE, /!!r\.gap && !\/\^stop\/\.test/);
});

test('walk 1: a row with no attempt/close renders nothing / "—" at the one place the cells are built, never null/unknown/#null', () => {
  assert.match(PAGE, /function auditAttemptText\(r\)\{ return \(typeof r\.attempt === "number"/);
  assert.match(PAGE, /"<td data-label=\\"Attempt\\">" \+ escapeXml\(auditAttemptText\(r\)\)/);
  assert.match(PAGE, /function auditCloseText\(r\)\{ return \(r\.setup \|\| r\.class === null/);
  assert.match(PAGE, /escapeXml\(auditCloseText\(r\)\) \+ "<\/td>"/);
  assert.doesNotMatch(PAGE, /escapeXml\(String\(r\.attempt\)\)/);
  assert.match(PAGE, /td\[data-label="Attempt"\]:empty::before[^{]*\{content:none;\}/, 'no "#" before an empty attempt on a phone');
});

test('walk 3: the phone Verdict cell wraps, never cuts or spills', () => {
  const r = rule('[data-testid="audit-table"] td[data-label="Verdict"], .audit-group table td[data-label="Verdict"]{order:4');
  assert.match(r, /white-space:normal/);
  assert.match(r, /overflow-wrap:anywhere/);
  assert.doesNotMatch(r, /text-overflow:ellipsis/);
});

test('walk 4: a narrow Audit group header wraps so the name keeps its own readable line', () => {
  const i = PAGE.indexOf('a narrow header WRAPS');
  assert.ok(i > 0);
  const blk = PAGE.slice(i, PAGE.indexOf('\n  }', i));
  assert.match(blk, /h4\.audit-status-header\{flex-wrap:wrap;/);
  assert.match(blk, /\.audit-fold-name\{[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/);
});

test('walk 2: a Stop before a step\'s first call (Resume then an immediate Stop) says "stopped after step N-1" and is filed under step N-1 — one value', async () => {
  const w = mk('g4');
  const { fn } = fake();
  const cut = async (ctx, ...rest) => (emitsOf(ctx) === 'resume-summary' ? { ok: false, stopped: true, costUsd: 0, turns: 0 } : fn(ctx, ...rest));
  const r = await runFlow({ ...args(w, cut), sources: w.sources });
  assert.equal(r.outcome, 'stopped', r.red);
  const row = stopRows(w.runDir).find((x) => x.verdict === 'stopped');
  assert.equal(row.gap, 'stopped after step 2', 'the signed words');
  assert.equal(row.step, 'jd-text', 'filed under the step the words name (step 2)');
});
