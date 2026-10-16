// M11 amendment 11 (docs/wiki/the-module-ladder.md): Needs you tags (Answer / Reopen / Resume), expired-and-reopenable asks join it, "Remove from Needs you" (written once,
// changes nothing else), the 7-day leave, and a removed run that needs you again comes back. $0: a fake modelStep in-process, the panel over real HTTP.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep, requestStop, stopParkedRun } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { listRuns, listStops, getRunAudit } from '../src/panel/data.js';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { killChildrenAfter, rq } from './m4e-world.mjs';

killChildrenAfter();
const HANDLES = [];
after(async () => { await Promise.all(HANDLES.map((h) => h.close())); });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const D = 86_400_000;

/** A signed job2 whose first run parks at its ask. */
async function parkedRun(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-m11am11-${tag}-`));
  const w = { base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src') };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.runDir = path.join(w.root, 'job2', 'runs', 'run-1');
  const modelStep = async (ctx) => {
    const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  const run = await runFlow({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(),
    sources: [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }],
  });
  assert.equal(run.outcome, 'paused', run.red);
  w.h = remember(await createPanelServer({ port: 0, root: w.root }));
  HANDLES.push(w.h);
  w.post = (url, body) => rq(w.h.port, { method: 'POST', url, body });
  w.get = (url) => rq(w.h.port, { url });
  w.row = () => listRuns({ root: w.root, catalogue: CAT }).find((x) => x.runId === 'run-1');
  w.askPath = path.join(w.runDir, 'ask.json');
  // a real expiry is in the three files the runner wrote (ask.json, asks/<id>.json, state.json); after a reopen the deadline is the reopen record's
  w.expireAt = (iso) => {
    const askId = JSON.parse(readFileSync(w.askPath, 'utf8')).askId;
    const reopens = readdirSync(w.runDir).filter((f) => /^reopen\..*\.json$/.test(f)).sort();
    const files = reopens.length > 0 ? [path.join(w.runDir, reopens.at(-1))] : [w.askPath, path.join(w.runDir, 'asks', `${askId}.json`), path.join(w.runDir, 'state.json')];
    for (const f of files) { const j = JSON.parse(readFileSync(f, 'utf8')); j.expiresAt = iso; if ('askedAt' in j) j.askedAt = new Date(Date.parse(iso) - 3_600_000).toISOString(); writeFileSync(f, JSON.stringify(j)); }
    return askId;
  };
  w.markers = () => readdirSync(w.runDir).filter((n) => n.startsWith('needs-removed-'));
  return w;
}
const stopIt = async (w) => {
  requestStop(w.runDir);
  const s = await stopParkedRun({ root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT });
  assert.equal(s.outcome, 'stopped', s.red);
};

test('Must fail: a waiting run\'s tag reads anything but Answer; a run waiting at a live ask shows Remove (item 1, 3)', async () => {
  const w = await parkedRun('answer');
  assert.equal(w.row().glyph, '[·]');
  assert.equal(w.row().needs, 'Answer');
  assert.deepEqual((await w.get('/api/runs/job2/run-1')).json().needsYou, { tag: 'Answer', removable: false });
  assert.equal((await w.get('/api/runs/job2/run-1/asks')).json().needsYou.removable, false);
  const r = await w.post('/api/needs-remove', { flow: 'job2', runId: 'run-1' });
  assert.equal(r.status, 409, r.text);
  assert.deepEqual(w.markers(), [], 'nothing written for a live ask');
  assert.equal(w.row().needs, 'Answer');
});

test('Must fail: a reopenable expired ask is missing from Needs you; it carries Reopen (item 2)', async () => {
  const w = await parkedRun('reopen');
  w.expireAt(new Date(Date.now() - 3_600_000).toISOString());
  const row = w.row();
  assert.equal(row.glyph, '[!]');
  assert.equal(row.needs, 'Reopen');
  assert.deepEqual((await w.get('/api/runs/job2/run-1/asks')).json().needsYou, { tag: 'Reopen', removable: true });
});

test('Must fail: Remove changes the run\'s status or hides it from the Inbox or Jobs; it is written once and Audit says so (item 3)', async () => {
  const w = await parkedRun('remove');
  w.expireAt(new Date(Date.now() - 3_600_000).toISOString());
  const before = w.row();
  const r = await w.post('/api/needs-remove', { flow: 'job2', runId: 'run-1' });
  assert.equal(r.status, 200, r.text);
  const after = w.row();
  assert.equal(after.needs, null, 'out of Needs you');
  assert.equal(after.glyph, before.glyph);
  assert.equal(after.label, before.label);
  assert.deepEqual(after.controls, before.controls);
  assert.ok(listStops({ root: w.root, catalogue: CAT }).some((x) => x.runId === 'run-1'), 'the Inbox row stays');
  assert.ok(listRuns({ root: w.root, catalogue: CAT }).some((x) => x.runId === 'run-1'), 'the Jobs card keeps the run');
  assert.equal((await w.get('/api/runs/job2/run-1/asks')).json().asks.at(-1).reopen !== null, true, 'Reopen stays');
  const [m] = w.markers();
  assert.equal(w.markers().length, 1);
  assert.equal(statSync(path.join(w.runDir, m)).mode & 0o777, 0o600);
  assert.match((await w.get('/api/runs/job2/run-1/audit')).json().needsLeft, /^removed from Needs you by you · \d\d\/\d\d \d\d:\d\d$/);
  const again = await w.post('/api/needs-remove', { flow: 'job2', runId: 'run-1' });
  assert.equal(again.status, 409, 'not in Needs you any more: a second Remove writes nothing');
  assert.equal(w.markers().length, 1);
});

test('Must fail: a removed run that is reopened and expires again stays out of Needs you although it needs you again (item 5)', async () => {
  const w = await parkedRun('episode');
  const askId = w.expireAt(new Date(Date.now() - 3_600_000).toISOString());
  assert.equal((await w.post('/api/needs-remove', { flow: 'job2', runId: 'run-1' })).status, 200);
  const re = await w.post('/api/reopen', { flow: 'job2', runId: 'run-1', askId });
  assert.equal(re.status, 200, re.text);
  assert.equal(w.row().needs, 'Answer', 'reopened: it needs your answer again');
  w.expireAt(new Date(Date.now() - 60_000).toISOString());   // it expires a second time: a new episode
  assert.equal(w.row().needs, 'Reopen', 'the old Remove does not cover the new episode');
});

test('Must fail: a 7-day-old expired card stays in Needs you; exactly 7 days is out and Audit says so (item 4)', async () => {
  const w = await parkedRun('age');
  const exp = Date.now() - 3_600_000;
  w.expireAt(new Date(exp).toISOString());
  const at = (ms) => ({ root: w.root, catalogue: CAT, now: () => ms });
  const find = (ms) => listRuns(at(ms)).find((x) => x.runId === 'run-1');
  assert.equal(find(exp + 7 * D - 1000).needs, 'Reopen', 'just under 7 days: in');
  assert.equal(find(exp + 7 * D).needs, null, 'exactly 7 days: out');
  assert.equal(getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT, now: () => exp + 7 * D }).needsLeft, 'removed from Needs you after 7 days');
  assert.equal(getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT, now: () => exp + D }).needsLeft, null);
  assert.deepEqual(w.markers(), [], 'computed at read time: nothing written');
});

test('Must fail: Remove on a stopped run changes its status or Resume; a changed stop time brings the card back (items 3, 5)', async () => {
  const w = await parkedRun('stopped');
  await stopIt(w);
  const before = w.row();
  assert.equal(before.glyph, '[■]');
  assert.equal(before.needs, 'Resume');
  assert.deepEqual((await w.get('/api/runs/job2/run-1')).json().needsYou, { tag: 'Resume', removable: true });
  assert.equal((await w.post('/api/needs-remove', { flow: 'job2', runId: 'run-1' })).status, 200);
  const after = w.row();
  assert.equal(after.needs, null);
  assert.equal(after.glyph, '[■]');
  assert.equal(after.controls.canResume, true, 'Resume stays');
  // a resume that stops again is a new stop time: the old marker is for the old one
  const hist = path.join(w.root, 'job2', 'history.jsonl');
  const rows = readFileSync(hist, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  rows[rows.length - 1].at = new Date(Date.parse(rows[rows.length - 1].at) + 1000).toISOString();
  writeFileSync(hist, `${rows.map((x) => JSON.stringify(x)).join('\n')}\n`);
  assert.equal(w.row().needs, 'Resume', 'it needs you again');
});

test('Remove on a stuck [II] run keeps it stuck and keeps Resume (item 3)', async () => {
  const w = await parkedRun('stuck');
  const ask = JSON.parse(readFileSync(w.askPath, 'utf8'));
  writeFileSync(path.join(w.runDir, 'answer.json'), JSON.stringify({ askId: ask.askId, decision: 'accept', answeredAt: new Date().toISOString() }));
  assert.equal(w.row().glyph, '[II]');
  assert.equal((await w.post('/api/needs-remove', { flow: 'job2', runId: 'run-1' })).status, 200);
  assert.equal(w.row().needs, null);
  assert.equal(w.row().glyph, '[II]');
  assert.equal(existsSync(path.join(w.runDir, 'answer.json')), true, 'the saved answer is untouched');
});

test('page: the Remove button is built from the server\'s `needsYou.removable` on the Ask tab (expired) and the Run tab, posts to /api/needs-remove, and Audit draws `needsLeft`', () => {
  const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
  assert.match(PAGE, /makeButton\("Remove from Needs you", "needs-remove"/);
  assert.equal((PAGE.match(/makeRemoveNeedsButton\(/g) || []).length, 3, 'one definition, the Ask tab, the Run tab');
  assert.match(PAGE, /detail\.needsYou && detail\.needsYou\.removable/);
  assert.match(PAGE, /ctx\.removable\) bar3\.appendChild/);
  assert.match(PAGE, /"\/api\/needs-remove"/);
  assert.match(PAGE, /audit-needs-left/);
});
