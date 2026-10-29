// M12 piece 1, through runFlow: the run's own preflight (1a) and the reader (1b/1c) refuse at $0, in the run's existing record (log.json red + history row).
// No network, no model, no MCP server (a fake bridge stands in). Scratch dirs are removed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';
import { runFlow } from '../src/runner.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const cat = loadCatalogue();

/** job2 signed with a typed MCP field: the job lists `tools`, and the first step grants `granted`. */
function mcpFlow(root, name, tools, granted) {
  const declaration = JSON.parse(fixture('job2.m1.declaration.json'));
  declaration.mcp = { server: 'github', tools };
  declaration.steps[0].mcpTools = granted;
  const w = writeFlow({
    root, name, proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration, signedBy: 'hamr', signedAt: '2026-10-29T12:00:00Z', catalogue: cat.primitives,
  });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
}
const lastHistory = (root, name) => readFileSync(path.join(root, name, 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);

test('1a: a run of a job that lists a tool no step grants is refused at $0 by name; no step ran', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p1-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mcpFlow(root, 'tick', ['issue_read', 'list_issues'], ['issue_read']);
  const r = await runFlow({
    root, name: 'tick', runId: 'run-1', catalogue: cat.primitives, primitives: {}, businessDate: '2026-06-01', sources: [],
    modelStep: async () => { throw new Error('a model step ran'); }, askStep: async () => { throw new Error('ask'); }, sendStep: async () => { throw new Error('send'); },
  });
  assert.equal(r.outcome, 'preflight-red');
  assert.match(r.red, /job tool "list_issues" \(server "github"\) is granted to no step/);
  const h = lastHistory(root, 'tick');
  assert.equal(h.outcome, 'preflight-red');
  assert.equal(h.spentUsd, 0);
  assert.equal(existsSync(path.join(root, 'tick', 'runs', 'run-1', 'spend.jsonl')), false);
});
