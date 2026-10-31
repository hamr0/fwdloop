// M13 design point 11 (F118): every MCP starts in the home folder, not the run's folder. Real bare-agent bridge, a fake stdio server that records its working
// folder. The test process runs from a DIFFERENT folder; HOME is a scratch dir, so os.homedir() is that dir. All three places fwdloop starts an MCP are checked
// (ticket reader, ticket look, the runner's step bridge), and a bad home folder is a named refusal, not a crash.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readTicketMcp } from '../src/ticket-mcp.js';
import { lookTickets } from '../src/trigger-tickets.js';
import { runStepRalph } from '../src/runner.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cwd-mcp-server.mjs');
const LIST = 'https://github.com/flutter/flutter/issues';

/** HOME = a scratch dir holding .mcp.json; the process runs from another scratch dir; returns where the server started */
async function startedIn(t, fn) {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p2-home-'));
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p2-cwd-'));
  const oldHome = process.env.HOME;
  const oldCwd = process.cwd();
  t.after(() => { process.chdir(oldCwd); process.env.HOME = oldHome; rmSync(home, { recursive: true, force: true }); rmSync(elsewhere, { recursive: true, force: true }); });
  const out = path.join(elsewhere, 'cwd.txt');
  const configPath = path.join(home, '.mcp.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { CWD_OUT: out } } } }));
  process.env.HOME = home;
  process.chdir(elsewhere);
  await fn(configPath);
  const seen = realpathSync(readFileSync(out, 'utf8'));
  assert.notEqual(seen, realpathSync(elsewhere), 'the server started in the process folder');
  assert.equal(seen, realpathSync(home));
}

test('ticket reader starts the MCP in the home folder', (t) => startedIn(t, (configPath) => readTicketMcp({ listUrl: LIST, number: 1, mcp: { server: 'github', tools: ['issue_read'] }, configPath })));
test('ticket look starts the MCP in the home folder', (t) => startedIn(t, (configPath) => lookTickets({ listUrl: LIST, mcp: { server: 'github', tool: 'list_issues' }, configPath, seen: null })));
test('the runner step bridge starts the MCP in the home folder', (t) => startedIn(t, async () => {
  // the step has no gate, so the run refuses right after the bridge started; the start is what is checked
  const r = await runStepRalph({ mcpServer: 'github', step: { mcpTools: ['issue_read'] }, primitivesMap: {} });
  assert.equal(r.outcome, 'preflight-red');
}));

test('a bad home folder is a named refusal at the reader and the look, no crash and no server start', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p2-bad-'));
  const oldHome = process.env.HOME;
  t.after(() => { process.env.HOME = oldHome; rmSync(dir, { recursive: true, force: true }); });
  const out = path.join(dir, 'cwd.txt');
  const configPath = path.join(dir, 'mcp.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { CWD_OUT: out } } } }));
  process.env.HOME = path.join(dir, 'gone');
  const a = await readTicketMcp({ listUrl: LIST, number: 1, mcp: { server: 'github', tools: ['issue_read'] }, configPath });
  const b = await lookTickets({ listUrl: LIST, mcp: { server: 'github', tool: 'list_issues' }, configPath, seen: null });
  for (const r of [a, b]) {
    assert.equal(r.ok, false);
    assert.match(r.error, /^github did not start: the home folder could not be used \(/);
  }
  assert.throws(() => readFileSync(out), 'the server must not have started');
});
