// M13 piece 4 (ruling R2): a by-hand Run on a Tickets job reads the newest ticket that has not run yet; nothing new = one plain line at $0 and no run. Real lookTickets over a
// fake stdio MCP server (FAKE_LIST, a list file changed between looks); the CLI test runs the real `fwdloop run`. $0, no model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { newestUnrunTicket, ranTicketNumbers } from '../src/ticket-next.js';
import { ticketJob, LIST } from './m12-p2-world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const newestFirst = (n) => Array.from({ length: n }, (_, i) => ({ number: n - i, state: 'OPEN', labels: [] }));

function world(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p4-next-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const listFile = path.join(dir, 'list.json');
  writeFileSync(listFile, JSON.stringify(newestFirst(5)));
  const home = path.join(dir, 'home');
  mkdirSync(home);
  const configPath = path.join(home, '.mcp.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [path.join(HERE, 'fixtures', 'fake-mcp-server.mjs')], env: { FAKE_MCP_SERVER: '1', FAKE_LIST: listFile } } } }));
  const flowDir = path.join(dir, 'root', 'tk');
  mkdirSync(path.join(flowDir, 'runs'), { recursive: true });
  const ran = (runId, number) => {
    mkdirSync(path.join(flowDir, 'runs', runId), { recursive: true });
    writeFileSync(path.join(flowDir, 'runs', runId, 'run.json'), JSON.stringify({ inputs: [{ id: 'jd', ticket: { number } }] }));
  };
  const next = () => newestUnrunTicket({ flowDir, listUrl: LIST, mcp: { server: 'github', tool: 'list_issues' }, configPath });
  return { dir, home, listFile, flowDir, ran, next };
}

test('no ticket has run: the newest open ticket of the first page', async (t) => {
  const w = world(t);
  assert.deepEqual(await w.next(), { ok: true, number: 5 });
});

test('the newest ticket already ran: one plain line naming it, no ticket', async (t) => {
  const w = world(t);
  w.ran('run-1', 5);
  assert.deepEqual(await w.next(), { ok: false, say: 'Nothing new: no ticket newer than #5 has come in.' });
});

test('a ticket arrives after the last run: it is the one; and an older unrun ticket never is', async (t) => {
  const w = world(t);
  w.ran('run-1', 3);   // 4 and 5 were never run, but they were there before: the walk stops at the seen 3
  writeFileSync(w.listFile, JSON.stringify(newestFirst(7)));
  assert.deepEqual(await w.next(), { ok: true, number: 7 });
  w.ran('run-2', 7);
  assert.equal((await w.next()).ok, false);
  assert.deepEqual([...ranTicketNumbers(w.flowDir)].sort(), [3, 7]);
});

test('an unreadable look says its cause, never "nothing new"', async (t) => {
  const w = world(t);
  writeFileSync(w.listFile, JSON.stringify([]));
  const r = await w.next();
  assert.equal(r.ok, false);
  assert.match(r.say, /came back empty/);
});

test('the real CLI: a by-hand run with no --ticket and nothing new refuses at $0 and leaves no run folder', async (t) => {
  const w = world(t);
  const root = path.join(w.dir, 'root');
  ticketJob(root, 'tk', {});
  w.ran('run-1', 5);
  const r = spawnSync(process.execPath, [BIN, 'run', 'tk', '--root', root, '--source', `jd=${LIST}`, '--source', `resume=${path.join(w.dir, 'resume.md')}`], {
    env: { PATH: process.env.PATH ?? '', HOME: w.home, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 60000,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /run: Nothing new: no ticket newer than #5 has come in\. Nothing started\./);
  assert.equal(existsSync(path.join(root, 'tk', 'runs', 'run-2')), false);
  assert.equal(readFileSync(path.join(w.flowDir, 'runs', 'run-1', 'run.json'), 'utf8').includes('"number":5'), true);
});
