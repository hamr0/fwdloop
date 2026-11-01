// M13 am2 item 2: the Result tab's ONE decider is the run detail (`resultTab`, `hasGrid`, `hasResult`). A Tickets MCP job gets the grid; a plain or MCP job keeps
// what it had before M13 (the tab only for a job that has M10's Result page). Real getRunDetail over real signed jobs, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';
import { getRunDetail } from '../src/panel/data.js';
import { skippedWorld, DECL } from './m12-p3-world.mjs';
import { sandboxSend } from './send-sandbox.js';
import { readFileSync } from 'node:fs';

const cat = loadCatalogue();

function sign(root, name, declaration, prose) {
  const w = writeFlow({ root, name, proseText: sandboxSend(prose), declaration, signedBy: 'hamr', signedAt: '2026-10-29T12:00:00Z', catalogue: cat.primitives });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  mkdirSync(path.join(root, name, 'runs', 'run-1'), { recursive: true });
}
const detailOf = (root, flow) => getRunDetail({ root, flow, runId: 'run-1', catalogue: cat.primitives });

test('a Tickets MCP job: the tab shows and the grid is drawn; an MCP job and a plain job with no M10 page: no tab, no grid', async (t) => {
  const { root } = await skippedWorld(t);
  const tick = detailOf(root, 'tick');
  assert.equal(tick.hasGrid, true);
  assert.equal(tick.resultTab, true);
  // the same job signed as flow type MCP (no ticket filter): the pre-M13 decision, no M10 page here
  const prose = readFileSync(path.join(root, 'tick', 'prose.txt'), 'utf8');
  const { ticketFilter, ...rest } = DECL;
  sign(root, 'mcpjob', { ...rest, flowType: 'mcp' }, prose);
  const withPage = detailOf(root, 'mcpjob');
  assert.equal(withPage.hasGrid, false, 'no grid for an MCP job');
  assert.equal(withPage.hasResult, true, 'it reads a page, so it has M10\'s Result page');
  assert.equal(withPage.resultTab, true, 'the tab it had before M13');
  // and with a plain text file as its input there is no M10 page at all: no tab
  sign(root, 'mcpjob2', { ...rest, flowType: 'mcp', steps: rest.steps.map((st, i) => (i === 0 ? { ...st, reads: [] } : st)) }, prose.replace(/source issues = page:\S+/, 'source issues = file:/home/hamr/Documents/resumes/jd-anthropic-applied-ai-architect.md'));
  const bare = detailOf(root, 'mcpjob2');
  assert.equal(bare.hasGrid, false);
  assert.equal(bare.hasResult, false);
  assert.equal(bare.resultTab, false, 'an MCP job without an M10 page has no Result tab');
});
