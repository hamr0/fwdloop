// M12 piece 2, the schedule door and the CLI (ladder "M12 scope (restart)" items 7, 8; PRD rulings 2026-10-29: the look's tool is signed with the schedule's two clicks;
// a by-hand Run on a ticket job uses a ticket picked by number). $0, no network, no model: the panel's spawned `fwdloop` is an argv echo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { readSchedule, ledgerOf } from '../src/schedule.js';
import { readSeen } from '../src/trigger-files.js';
import { readOutcomes } from '../src/panel/authortrigger.js';
import { scheduledWords } from '../src/summary-words.js';
import { LIST, ticketJob } from './m12-p2-world.mjs';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { seedGreen } from './m9-trigger-world.mjs';

killChildrenAfter();
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ARGV_ECHO = path.join(HERE, 'fixtures', 'm4d-argv-echo', 'fwdloop');
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();
const TICKET = { kind: 'new-ticket', role: 'jd' };

const newestFirst = (n) => Array.from({ length: n }, (_, i) => ({ number: n - i, state: 'OPEN', labels: [] }));

async function ticketWorld(o = {}) {
  const clock = { t: at(13, 8) };
  // the panel's scheduler looks through THIS config (a fake server over a list file we change), never the person's ~/.mcp.json
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p2-door-'));
  const listFile = path.join(dir, 'list.json');
  writeFileSync(listFile, JSON.stringify(newestFirst(5)));
  const mcpConfig = path.join(dir, 'mcp.json');
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [path.join(HERE, 'fixtures', 'fake-mcp-server.mjs')], env: { FAKE_MCP_SERVER: '1', FAKE_LIST: listFile } } } }));
  const w = await world({ limit: 5, bin: ARGV_ECHO, authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0, mcpConfig } });
  w.env.ARGV_FILE = path.join(w.work, 'argv.jsonl');
  ticketJob(w.root, 'tk', o);
  seedGreen(w, 'tk');
  return { w, clock, listFile, flowDir: path.join(w.root, 'tk'), argv: () => { try { return readFileSync(w.env.ARGV_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } } };
}
const prepare = (w, trigger, extra = {}) => w.post('/api/author/trigger-prepare', { flow: 'tk', trigger, ...extra });

test('the first click fills the look from the signed job: the list address, the job\'s server, and list_issues; the second click writes them into schedule.json', async () => {
  const f = await ticketWorld();
  const p = await prepare(f.w, TICKET);
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json().trigger.tool, 'list_issues');
  assert.equal(p.json().words, 'When a new ticket arrives in jd');
  const s = await f.w.post('/api/author/trigger', { flow: 'tk', trigger: TICKET, hash: p.json().hash });
  assert.equal(s.status, 200, s.text);
  assert.deepEqual(readSchedule(f.flowDir).trigger, { kind: 'new-ticket', role: 'jd', list: LIST, server: 'github', tool: 'list_issues' });
  assert.deepEqual(readSeen(ledgerOf(f.flowDir)).filter((r) => r.kind === 'baseline'), [], 'the starting point is the first LOOK, not the click');
  assert.equal(scheduledWords(readSchedule(f.flowDir).trigger), 'When a new ticket arrives in jd');
});

test('Must fail: the tool is signed with the click — a hash from a trigger with another tool does not sign this one', async () => {
  const f = await ticketWorld();
  const p = await prepare(f.w, TICKET);
  const s = await f.w.post('/api/author/trigger', { flow: 'tk', trigger: { ...TICKET, watch: ['state'] }, hash: p.json().hash });
  assert.equal(s.status, 409, s.text);
  assert.equal(s.json().refused, 'stale-hash');
});

test('refused at $0, nothing changed: an input that is not a ticket list; a job that names no MCP server; a watched field that is not typed', async () => {
  const f = await ticketWorld();
  const a = await prepare(f.w, { kind: 'new-ticket', role: 'resume' });
  assert.equal(a.status, 400, a.text);
  assert.match(a.json().say, /The input "resume" is not a ticket list/);
  const c = await prepare(f.w, { ...TICKET, watch: ['title'] });
  assert.equal(c.status, 400, c.text);
  assert.match(c.json().say, /can watch only state and labels/);
  const g = await ticketWorld({ mcp: false });
  const b = await prepare(g.w, TICKET);
  assert.equal(b.status, 400, b.text);
  assert.match(b.json().say, /names no MCP server/);
  assert.equal(readSchedule(f.flowDir), null);
});

test('end to end through the panel\'s own tick: first look = starting point, then a new ticket starts the run with `--ticket N` beside the signed list; the row and the run\'s record name it', async () => {
  const f = await ticketWorld();
  const p = await prepare(f.w, TICKET);
  assert.equal((await f.w.post('/api/author/trigger', { flow: 'tk', trigger: TICKET, hash: p.json().hash })).status, 200);
  const ledger = ledgerOf(f.flowDir);
  const rows = (kind) => readSeen(ledger).filter((r) => r.kind === kind);
  f.w.h.tick();   // the first look
  await until(() => rows('baseline').length === 5);
  assert.equal(f.argv().length, 0, 'the starting point runs nothing');
  writeFileSync(f.listFile, JSON.stringify(newestFirst(6)));
  f.clock.t += 15 * 60_000;
  await until(() => { f.w.h.tick(); return f.argv().length > 0; });
  const argv = f.argv()[0];
  assert.equal(argv[argv.indexOf('--ticket') + 1], '6', JSON.stringify(argv));
  assert.ok(argv.includes(`jd=${LIST}`));
  assert.deepEqual(rows('ran').map((r) => r.sha), ['ticket:6']);
  const row = readOutcomes(f.flowDir).find((r) => r.outcome === 'started');
  assert.equal(row.ticket, 6);
  const rec = JSON.parse(readFileSync(path.join(f.flowDir, 'runs', row.runId, 'trigger.json'), 'utf8'));
  assert.equal(rec.kind, 'ticket');
  assert.equal(rec.ticket, 6);
  assert.equal(rec.triggerKind, 'new-ticket');
});

// ---- the CLI: a ticket job reads ONE ticket per run, picked by number -------------------------------------------------------------------------------------------

function cli(root, name, extra = []) {
  const r = spawnSync(process.execPath, [BIN, 'run', name, '--root', root, '--source', `resume=${path.join(root, 'r.md')}`, ...extra], {
    encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: root, NODE_ENV: 'test' },
  });
  return { code: r.status, err: `${r.stderr}${r.stdout}` };
}
async function cliWorld(o) {
  const w = await world();
  ticketJob(w.root, 'tk', o);
  writeFileSync(path.join(w.root, 'r.md'), '# R\n');
  mkdirSync(path.join(w.root, 'tk', 'runs'), { recursive: true });
  return w;
}

test('Must fail: a ticket job run with no ticket number is refused at $0, naming the input and its list', async () => {
  const w = await cliWorld();
  const r = cli(w.root, 'tk');
  assert.notEqual(r.code, 0);
  assert.match(r.err, /reads tickets from "jd" \(https:\/\/github\.com\/flutter\/flutter\/issues\); pick the ticket with --ticket <number>\. Nothing started\./);
});

test('Must fail: a ticket number that is not a whole number from 1 is refused at $0', async () => {
  const w = await cliWorld();
  for (const bad of ['0', '1.5', 'abc', '', '-3']) {
    const r = cli(w.root, 'tk', [`--ticket=${bad}`]);
    assert.notEqual(r.code, 0, bad);
    assert.match(r.err, /is not a ticket number/, `${bad}: ${r.err}`);
  }
});

test('--ticket on a job with no ticket list is refused at $0, naming the flow', async () => {
  const w = await cliWorld({ fileJd: true });
  const r = cli(w.root, 'tk', ['--ticket', '5', '--source', `jd=${path.join(w.root, 'r.md')}`]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /--ticket 5, but flow "tk" has no ticket-list input\. Nothing started\./);
});
