// M13 piece 4: `fwdloop draft --flow-type X --mcp S` end to end through the real CLI with the fake draft provider ($0, no server started). The signed declaration carries the flow type
// and EVERY tool of the MCP's newest OK check, set by code (R1); never checked = a refusal at $0 and no draft folder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { appendMcpCheck } from '../src/mcp-checks.js';
import { job2Fixture } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE_DRAFT = path.join(HERE, 'fixtures', 'cli-fake-draft-provider.mjs');
const TOOLS = ['issue_read', 'list_issues', 'create_issue'];

function world(t, { checked = true } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p4-cli-'));
  const cfg = path.join(work, 'cfg');
  const home = path.join(work, 'home');
  mkdirSync(cfg, { recursive: true, mode: 0o700 });
  mkdirSync(home);
  t.after(() => rmSync(work, { recursive: true, force: true }));
  writeFileSync(path.join(cfg, 'config.json'), JSON.stringify({ monthlyLimitUsd: 5 }));
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: '/nonexistent/never-started' } } }));
  if (checked) appendMcpCheck(cfg, { server: 'github', path: '~/.mcp.json', at: '2026-10-31T10:00:00Z', ok: true, tools: TOOLS.map((name) => ({ name, hint: null })) });
  writeFileSync(path.join(work, 'prose.txt'), job2Fixture().prose);
  const draft = (extraArgs, extraEnv = {}) => spawnSync(process.execPath, [BIN, 'draft', path.join(work, 'prose.txt'), '--out', path.join(work, 'out'), '--root', path.join(work, 'flows'), '--name', 'x', ...extraArgs], {
    env: { PATH: process.env.PATH ?? '', HOME: home, NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: cfg, FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT, ...extraEnv }, encoding: 'utf8', timeout: 60000,
  });
  const declaration = () => JSON.parse(readFileSync(path.join(work, 'out', 'declaration.json'), 'utf8'));
  return { work, draft, declaration };
}

test('--flow-type mcp --mcp github: the declaration says mcp and carries every tool of the newest OK check, in order', (t) => {
  const w = world(t);
  const r = w.draft(['--flow-type', 'mcp', '--mcp', 'github'], { FWDLOOP_TEST_DRAFT_MCP: '1' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const d = w.declaration();
  assert.equal(d.flowType, 'mcp');
  assert.deepEqual(d.mcp, { server: 'github', tools: TOOLS });
  assert.deepEqual(d.steps[0].mcpTools, ['issue_read']);
});

test('no flow type: the declaration says plain and has no mcp block', (t) => {
  const w = world(t);
  const r = w.draft([]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(w.declaration().flowType, 'plain');
  assert.equal(w.declaration().mcp, undefined);
});

test('never checked: refused at $0 with the one sentence, and no draft folder is left', (t) => {
  const w = world(t, { checked: false });
  const r = w.draft(['--flow-type', 'mcp', '--mcp', 'github'], { FWDLOOP_TEST_DRAFT_MCP: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /press check tools in Settings > MCP first/);
  assert.equal(existsSync(path.join(w.work, 'out')), false);
});

test('bad flags are refused by name: an unknown flow type, --mcp without a flow type, a flow type without --mcp', (t) => {
  const w = world(t);
  assert.match(w.draft(['--flow-type', 'chat', '--mcp', 'github']).stderr, /--flow-type takes plain, mcp or tickets/);
  assert.match(w.draft(['--mcp', 'github']).stderr, /--mcp goes with --flow-type mcp or tickets/);
  assert.match(w.draft(['--flow-type', 'mcp']).stderr, /needs --mcp <server>/);
});
