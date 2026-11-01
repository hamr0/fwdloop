// M13 piece 5 (signed item 7): the New job card's Schedule row is signed with the job. The card is checked at $0; the sign writes `schedule.json` OFF (no `armed` row);
// By hand writes none. Real panel, real `fwdloop draft` children with the test provider, a stand-in bin that only records a run's argv. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { killChildrenAfter, until, useHome, world } from './m4e-world.mjs';
import { appendMcpCheck } from '../src/mcp-checks.js';
import { ledgerOf, readSchedule } from '../src/schedule.js';
import { readRows } from '../src/trigger-clock.js';
import { LIST } from './m12-p2-world.mjs';

killChildrenAfter();
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REAL_BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const echoBin = (dir) => {
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'fwdloop');
  writeFileSync(f, `import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const a = process.argv.slice(2);
if (a[0] === 'run') { appendFileSync(process.env.ARGV_FILE, JSON.stringify(a) + '\\n'); process.exit(0); }
process.exit(spawnSync(process.execPath, [${JSON.stringify(REAL_BIN)}, ...a], { stdio: 'inherit' }).status ?? 1);
`);
  return f;
};

/** a world with the github MCP checked once; the HOME the draft children see holds a harmless ~/.mcp.json */
async function tWorld() {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p5-'));
  const w = await world({ limit: 5, bin: echoBin(work), extraEnv: { FWDLOOP_TEST_DRAFT_TICKET: '1', ARGV_FILE: path.join(work, 'argv.jsonl') } });
  const fakeHome = path.join(w.work, 'home');
  mkdirSync(fakeHome);
  writeFileSync(path.join(fakeHome, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'true' } } }));
  useHome(w, fakeHome);
  appendMcpCheck(w.home, { server: 'github', path: '~/.mcp.json', at: '2026-10-31T10:00:00Z', ok: true, tools: ['issue_read', 'list_issues'].map((name) => ({ name, hint: null })) });
  return w;
}
const ticketCard = (w, over = {}) => w.card({ inputs: `resume: ${path.join(w.inDir, 'resume.md')}\njd: ${LIST}`, flowType: 'tickets', mcp: 'github', ...over });
async function greenDraft(w, card) {
  const id = (await w.post('/api/author/draft', card)).json().draftId;
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(g.phase, 'green', JSON.stringify(g));
  return { id, g };
}
const armedRows = (flowDir) => { const sc = readSchedule(flowDir); return sc === null ? null : readRows(ledgerOf(flowDir), sc.sig).filter((r) => r.kind === 'armed'); };

test('the card refuses a Schedule it cannot sign, at $0, naming the Schedule box: a new ticket on a plain job, a bad time, an unknown kind', async () => {
  const w = await tWorld();
  const bad = async (schedule, card = w.card()) => { const r = await w.post('/api/author/draft', { ...card, schedule }); assert.equal(r.status, 400, r.text); return r.json().refusals; };
  let rs = await bad({ kind: 'new-ticket' });
  assert.deepEqual(rs.map((x) => x.field), ['schedule']);
  assert.equal(rs[0].say, 'Only a Tickets MCP job can start on a new ticket.');
  rs = await bad({ kind: 'daily', hour: 25, minute: 0 });
  assert.equal(rs[0].say, 'The time must be an hour 0-23 and a minute 0-59, like 09:00.');
  rs = await bad({ kind: 'weekly', day: 'mon', hour: 9, minute: 0 });
  assert.equal(rs[0].say, 'Pick when it runs from the choices.');
  assert.equal(w.starts().length, 0);
});

test('sign with a new-ticket schedule writes schedule.json in the same sign, OFF: the trigger is filled from the signed job and no armed row exists', async () => {
  const w = await tWorld();
  const { id, g } = await greenDraft(w, ticketCard(w, { schedule: { kind: 'new-ticket' } }));
  const r = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(r.status, 202, r.text);
  const flowDir = path.join(w.root, 'job2');
  const sc = readSchedule(flowDir);
  assert.notEqual(sc, null, 'schedule.json is there and checks out (its hashes hold)');
  assert.deepEqual(sc.trigger, { kind: 'new-ticket', role: 'jd', list: LIST, server: 'github', tool: 'list_issues' });
  assert.equal(sc.from, r.json().runId, 'it is the schedule of the run the sign started');
  assert.deepEqual(armedRows(flowDir), [], 'off: no armed row');
  assert.equal(existsSync(path.join(flowDir, 'signature.json')), true);
});

test('sign with Every day at 09:30 writes a daily schedule, off; By hand writes no schedule.json at all', async () => {
  const w = await tWorld();
  const a = await greenDraft(w, ticketCard(w, { flowName: 'daily-job', schedule: { kind: 'daily', hour: 9, minute: 30 } }));
  assert.equal((await w.post(`/api/author/${a.id}/sign`, { hash: a.g.hash })).status, 202);
  const sc = readSchedule(path.join(w.root, 'daily-job'));
  assert.deepEqual(sc.trigger, { kind: 'daily', hour: 9, minute: 30 });
  assert.deepEqual(armedRows(path.join(w.root, 'daily-job')), []);
  const b = await greenDraft(w, ticketCard(w, { flowName: 'hand-job' }));
  assert.equal((await w.post(`/api/author/${b.id}/sign`, { hash: b.g.hash })).status, 202);
  assert.equal(existsSync(path.join(w.root, 'hand-job', 'schedule.json')), false);
});

test('the draft keeps the schedule on its card, so a page reload shows what will be signed', async () => {
  const w = await tWorld();
  const { id } = await greenDraft(w, ticketCard(w, { schedule: { kind: 'daily', hour: 7, minute: 5 } }));
  const j = (await w.get(`/api/author/${id}`)).json();
  assert.deepEqual(j.card.schedule, { kind: 'daily', hour: 7, minute: 5 });
  assert.equal(readFileSync(path.join(w.dir(id), 'card.json'), 'utf8').includes('"daily"'), true);
});
