// Shared by the M12 piece 2 tests: a signed job in a panel root whose `jd` input is a ticket list (or a file), with a model record.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';
import { writeModelRecord } from '../src/flowmodel.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
export const LIST = 'https://github.com/flutter/flutter/issues';
const cat = loadCatalogue();
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');

/** a signed job whose `jd` input is a ticket list; `mcp` = false: a job that names no MCP server; `fileJd`: jd stays a file (no ticket list) */
export function ticketJob(root, name, { mcp = true, fileJd = false } = {}) {
  const declaration = JSON.parse(fixture('job2.m1.declaration.json'));
  if (mcp) { declaration.mcp = { server: 'github', tools: ['issue_read'] }; declaration.steps[0].mcpTools = ['issue_read']; }
  let prose = sandboxSend(fixture('job2-with-sources.signed.txt'));
  if (!fileJd) prose = prose.replace(/guardrail: source jd = file:.*/, `guardrail: source jd = page:${LIST}`);
  const r = writeFlow({ root, name, proseText: prose, declaration, signedBy: 'hamr', signedAt: '2026-10-29T12:00:00Z', catalogue: cat.primitives });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  writeModelRecord(path.join(root, name), { slot: 'DEEPSEEK_API_KEY', model: 'fake-ticked' });
}

