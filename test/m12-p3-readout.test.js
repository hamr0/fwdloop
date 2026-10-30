// M12 piece 3 (found in the rehearsal of the exit walk): the draft readout shows what is signed for MCP (the server and tools, the ticket filter, the watch, each step's tools).
// Lines appear only when the field exists; a job without them reads byte for byte as before (golden file made from the code before this change). $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildReadout } from '../src/authoring.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const build = (extra = {}, stepExtra = {}) => buildReadout({
  declaration: {
    steps: [{ fromLine: 1, goal: 'read it', primitives: ['read'], reads: ['a'], emits: 'x', close: { class: 'hitl' }, ...stepExtra }, { fromLine: 2, goal: 'check', primitives: [], reads: ['x'], emits: 'y', close: { class: 'hitl' } }],
    inputFacts: { a: ['Intro'] },
    ...extra,
  },
  arbiter: { capUsd: 0.5, sources: [{ role: 'a', path: '/x' }], asks: [{ line: 2, question: 'ok?', ttlMs: 3600000 }], sends: [{ line: 3, target: { kind: 'file', path: '/out' } }] },
  lines: [{ n: 1, text: 'read it,', guardrail: '3 sections' }, { n: 2, text: 'check with me', guardrail: null }],
  name: 'f', modelId: 'm', costUsd: 0.01, rounds: 1, spendComplete: true, root: '/r',
});

test('a job with no mcp, filter or watch reads byte for byte as before', () => {
  assert.equal(build(), readFileSync(path.join(HERE, 'fixtures', 'm12-readout-nonticket.txt'), 'utf8'));
});

test('a ticket job shows its server and tools, filter, watch and each step\'s tools, under INPUTS and the step', () => {
  const t = build({ mcp: { server: 'github', tools: ['issue_read'] }, ticketFilter: { priority: ['P1', 'P2'], labels: ['bug', 'docs'] }, ticketWatch: ['state', 'labels'] }, { mcpTools: ['issue_read'] }).split('\n');
  const i = t.indexOf('INPUTS');
  assert.deepEqual(t.slice(i, i + 7), [
    'INPUTS',
    '  a = /x  [headings: Intro]',
    '  mcp: github · tools: issue_read',
    '  ticket filter: priority P1, P2 · labels bug, docs',
    '  ticket watch: state, labels',
    '',
    'STEPS',
  ]);
  const s = t.indexOf('  1. (line 1) read it');
  assert.equal(t[s + 1], '     grants: read | reads: a | emits: x | check: hitl');
  assert.equal(t[s + 2], '     tools: issue_read');
  assert.equal(t[s + 3], '  2. (line 2) check', 'a step with no mcpTools gets no row');
});

test('each field shows only when it is there: a filter of one kind, no watch, tools only', () => {
  const only = build({ mcp: { server: 'github', tools: ['issue_read', 'list_issues'] }, ticketFilter: { priority: ['P1'] } });
  assert.match(only, /  mcp: github · tools: issue_read, list_issues\n  ticket filter: priority P1\n\nSTEPS/);
  assert.doesNotMatch(only, /ticket watch|labels/);
  const labels = build({ mcp: { server: 'github', tools: ['issue_read'] }, ticketFilter: { labels: ['bug'] } });
  assert.match(labels, /  ticket filter: labels bug\n/);
  assert.doesNotMatch(labels, /priority/);
});
