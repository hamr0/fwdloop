// M13 piece 4 live bug: on the REAL panel (not a test process) the config home is undefined, and "undefined" must mean the default config home
// (~/.config/fwdloop), not "never checked". Run in a CHILD node process with NODE_ENV and NODE_TEST_CONTEXT removed and HOME a scratch dir.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const CHILD = `
import { mcpPickFor, mcpPickHere } from ${JSON.stringify(path.join(SRC, 'mcp-pick.js'))};
import { checkCard, cardFields } from ${JSON.stringify(path.join(SRC, 'panel', 'authorcard.js'))};
const root = process.argv[1];
const card = cardFields({ flowName: 'tick', job: 'Read the ticket\\nWrite it out', inputs: '', destination: '', capUsd: '5', askWait: '1h', provider: 'x', model: 'y', flowType: 'mcp', mcp: 'github' });
const r = checkCard(card, { root, keys: [] });
console.log(JSON.stringify({ pick: mcpPickFor('github', undefined), here: mcpPickHere('github'), card: r.ok ? [] : r.refusals.filter((x) => x.field === 'mcp') }));
`;

function run(t, { checked }) {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13door-home-'));
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13door-root-'));
  t.after(() => { rmSync(home, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: '/nonexistent/never-started' } } }));
  mkdirSync(path.join(home, '.config', 'fwdloop'), { recursive: true });
  if (checked) writeFileSync(path.join(home, '.config', 'fwdloop', 'mcp-checks.jsonl'), `${JSON.stringify({ server: 'github', path: '~/.mcp.json', at: '2026-10-31T10:00:00Z', ok: true, tools: [{ name: 'issue_read', hint: 'read-only' }] })}\n`);
  const env = { ...process.env, HOME: home };
  delete env.NODE_ENV; delete env.NODE_TEST_CONTEXT; delete env.FWDLOOP_CONFIG_HOME;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, root], { env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('real process, config home undefined: a checked MCP is found at the default config home (card passes)', (t) => {
  const o = run(t, { checked: true });
  assert.deepEqual(o.pick, { ok: true, server: 'github', tools: ['issue_read'] });
  assert.deepEqual(o.here, o.pick);
  assert.deepEqual(o.card, []);
});

test('real process, config home undefined: an unchecked MCP still says press check tools', (t) => {
  const o = run(t, { checked: false });
  assert.equal(o.pick.ok, false);
  assert.match(o.pick.say, /press check tools/);
  assert.equal(o.card.length, 1);
});

test('a test process with no FWDLOOP_CONFIG_HOME reads no config at all (the door)', async () => {
  const { mcpPickFor } = await import('../src/mcp-pick.js');
  const r = mcpPickFor('github', undefined);
  assert.equal(r.ok, false);
});
