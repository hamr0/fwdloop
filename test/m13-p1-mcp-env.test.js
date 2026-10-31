// M13 item 9.5: an MCP gets only its own settings plus what it needs to start, never your provider keys. Real bare-agent bridge, a fake stdio server that
// records its env NAMES (never values), a canary `*_KEY` name in the parent env. Both places fwdloop starts an MCP (ticket reader, ticket look) are checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readTicketMcp, MCP_PASS_ENV } from '../src/ticket-mcp.js';
import { lookTickets } from '../src/trigger-tickets.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'env-names-mcp-server.mjs');
const LIST = 'https://github.com/flutter/flutter/issues';
const CANARY = 'FWDLOOP_M13_CANARY_KEY';

/** runs `fn(configPath)` with the canary in the parent env; returns the env names the fake server saw */
async function namesSeen(t, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p1-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'names.json');
  const configPath = path.join(dir, 'mcp.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { ENV_NAMES_OUT: out, OWN_SETTING: 'x' } } } }));
  process.env[CANARY] = 'canary-not-a-key';
  try { await fn(configPath); } finally { delete process.env[CANARY]; }
  return JSON.parse(readFileSync(out, 'utf8'));
}

const check = (names) => {
  assert.equal(names.includes(CANARY), false, 'a parent *_KEY name reached the MCP');
  for (const n of ['PATH', 'HOME', 'OWN_SETTING']) assert.equal(names.includes(n), true, `${n} must reach the MCP`);
};

test('the one list is PATH and HOME', () => assert.deepEqual(MCP_PASS_ENV, ['PATH', 'HOME']));
test('ticket reader: no parent *_KEY reaches the MCP; PATH, HOME and its own env do', async (t) => {
  check(await namesSeen(t, (configPath) => readTicketMcp({ listUrl: LIST, number: 1, mcp: { server: 'github', tools: ['issue_read'] }, configPath })));
});
test('ticket look: no parent *_KEY reaches the MCP; PATH, HOME and its own env do', async (t) => {
  check(await namesSeen(t, (configPath) => lookTickets({ listUrl: LIST, mcp: { server: 'github', tool: 'list_issues' }, configPath, seen: null })));
});
