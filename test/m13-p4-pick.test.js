// M13 piece 4 (hamr ruling R1, 2026-10-31): a job with an MCP gets ALL the tools of that MCP's newest OK check, set by code. Never a started server; never the drafter's pick.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { appendMcpCheck } from '../src/mcp-checks.js';
import { mcpPickFor, NEVER_CHECKED_SAY } from '../src/mcp-pick.js';

function world(t) {
  const cfgHome = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p4-cfg-'));
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p4-home-'));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = oldHome; rmSync(cfgHome, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: '/nonexistent/never-started' }, remoteone: { url: 'https://x.test/mcp' } } }));
  return { cfgHome, home };
}
const check = (over) => ({ server: 'github', path: '~/.mcp.json', at: '2026-10-31T10:00:00Z', ok: true, tools: [{ name: 'issue_read', hint: 'read-only' }, { name: 'list_issues', hint: null }, { name: 'create_issue', hint: null }], ...over });

test('the full tool list of the newest OK check, in the server\'s order; the server is never started (its command does not exist)', (t) => {
  const w = world(t);
  appendMcpCheck(w.cfgHome, check({ at: '2026-10-30T10:00:00Z', tools: [{ name: 'old_tool', hint: null }] }));
  appendMcpCheck(w.cfgHome, check());
  assert.deepEqual(mcpPickFor('github', w.cfgHome), { ok: true, server: 'github', tools: ['issue_read', 'list_issues', 'create_issue'] });
});

test('a failed check after an OK one does not hide the OK one: the newest OK line is used', (t) => {
  const w = world(t);
  appendMcpCheck(w.cfgHome, check());
  appendMcpCheck(w.cfgHome, { server: 'github', path: '~/.mcp.json', at: '2026-10-31T11:00:00Z', ok: false, error: 'did not start' });
  assert.equal(mcpPickFor('github', w.cfgHome).ok, true);
});

test('never checked, only a failed check, or an empty tool list: refused with the one sentence', (t) => {
  const w = world(t);
  assert.deepEqual(mcpPickFor('github', w.cfgHome), { ok: false, say: NEVER_CHECKED_SAY });
  assert.equal(NEVER_CHECKED_SAY, 'press check tools in Settings > MCP first');
  appendMcpCheck(w.cfgHome, { server: 'github', path: '~/.mcp.json', at: '2026-10-31T11:00:00Z', ok: false, error: 'x' });
  assert.equal(mcpPickFor('github', w.cfgHome).ok, false);
  appendMcpCheck(w.cfgHome, check({ tools: [] }));
  assert.equal(mcpPickFor('github', w.cfgHome).ok, false);
});

test('a check of the same name at ANOTHER path does not count; a remote or unknown server is refused by name', (t) => {
  const w = world(t);
  appendMcpCheck(w.cfgHome, check({ path: '/somewhere/else.json' }));
  assert.equal(mcpPickFor('github', w.cfgHome).ok, false);
  assert.match(mcpPickFor('remoteone', w.cfgHome).say, /remoteone is a remote server, not supported yet/);
  assert.match(mcpPickFor('nope', w.cfgHome).say, /nope is not in any MCP config/);
});

test('no config home (a test process with none): refused, and nothing is created', () => {
  assert.equal(mcpPickFor('github', undefined).ok, false);
  assert.equal(existsSync(path.join(tmpdir(), 'mcp-checks.jsonl')), false);
});
