// M13 piece 4: the card's Flow type and MCP (checkCard, cardFields), $0, no server started. The job gets every tool of the MCP's newest OK check (R1);
// never checked = the card refuses before drafting with one sentence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { cardFields, checkCard } from '../src/panel/authorcard.js';
import { appendMcpCheck } from '../src/mcp-checks.js';

const LIST = 'https://github.com/flutter/flutter/issues';
function world(t, { checked = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p4-card-'));
  const cfg = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p4-cfg-'));
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p4-home-'));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = oldHome; for (const d of [root, cfg, home]) rmSync(d, { recursive: true, force: true }); });
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: '/nonexistent/never-started' }, hosted: { url: 'https://x.test/mcp' } } }));
  if (checked) appendMcpCheck(cfg, { server: 'github', path: '~/.mcp.json', at: '2026-10-31T10:00:00Z', ok: true, tools: [{ name: 'issue_read', hint: 'read-only' }, { name: 'list_issues', hint: null }] });
  const card = (over = {}) => cardFields({ flowName: 'tick', job: 'Read the ticket\nWrite it out', inputs: '', destination: '', capUsd: '5', askWait: '1h', provider: 'x', model: 'y', ...over });
  const check = (over) => checkCard(card(over), { root, home: cfg, keys: [] });
  return { check, card };
}
const fields = (r) => (r.ok ? [] : r.refusals.map((x) => x.field));
const says = (r) => (r.ok ? [] : r.refusals.map((x) => x.say));

test('cardFields: plain carries no flow fields; MCP (generic) and Tickets carry flowType and mcp', (t) => {
  const w = world(t);
  assert.equal('flowType' in w.card(), false);
  assert.equal('flowType' in w.card({ flowType: 'plain' }), false);
  assert.deepEqual([w.card({ flowType: 'mcp', mcp: ' github ' }).flowType, w.card({ flowType: 'mcp', mcp: ' github ' }).mcp], ['mcp', 'github']);
});

test('MCP (generic) with a checked MCP and empty Inputs passes; plain passes with no MCP at all', (t) => {
  const w = world(t);
  assert.equal(w.check({ flowType: 'mcp', mcp: 'github' }).ok, true, JSON.stringify(w.check({ flowType: 'mcp', mcp: 'github' })));
  assert.equal(w.check({}).ok, true);
});

test('never checked: refused at $0 with the one sentence, on the MCP field', (t) => {
  const w = world(t, { checked: false });
  const r = w.check({ flowType: 'mcp', mcp: 'github' });
  assert.deepEqual(fields(r), ['mcp']);
  assert.deepEqual(says(r), ['press check tools in Settings > MCP first']);
});

test('no MCP picked, an unknown one, a remote one: each refused by name', (t) => {
  const w = world(t);
  assert.deepEqual(says(w.check({ flowType: 'mcp', mcp: '' })), ['Pick an MCP.']);
  assert.match(says(w.check({ flowType: 'mcp', mcp: 'nope' }))[0], /nope is not an MCP fwdloop can start/);
  assert.equal(says(w.check({ flowType: 'mcp', mcp: 'hosted' }))[0], 'hosted is a remote server, not supported yet');
});

test('an unknown flow type is refused', (t) => {
  const w = world(t);
  assert.deepEqual(fields(w.check({ flowType: 'chat', mcp: 'github' })), ['flowType']);
});

test('Tickets needs the ticket list address as an Inputs line; with it, it passes', (t) => {
  const w = world(t);
  const bad = w.check({ flowType: 'tickets', mcp: 'github', inputs: '' });
  assert.deepEqual(fields(bad), ['inputs']);
  assert.match(says(bad)[0], /Tickets needs the ticket list address as an Inputs line/);
  assert.equal(w.check({ flowType: 'tickets', mcp: 'github', inputs: `issues: ${LIST}` }).ok, true);
});
