// M4e amendment 7 items 3 and 5 (negative (c)): the readout's headings and guardrail rows, and a Runs card's last line. $0.
// Page functions are cut out of index.html and run against a fake string/DOM; real rendering at 1280/390/320 px is a browser walk.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReadout, readoutHeadIndexes } from '../src/authoring.js';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const fn = (name) => {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};

const readout = () => buildReadout({
  declaration: { steps: [{ fromLine: 1, goal: 'read it', primitives: ['read'], reads: ['a'], emits: 'x', close: { class: 'hitl' } }], inputFacts: {} },
  arbiter: { capUsd: 0.5, sources: [{ role: 'a', path: '/x' }], asks: [{ line: 2, question: 'ok?', ttlMs: 3600000 }], sends: [] },
  lines: [{ n: 1, text: 'read it,', guardrail: '3 sections, under 600 words' }, { n: 2, text: 'check with me', guardrail: null }],
  name: 'f', modelId: 'm', costUsd: 0.01, rounds: 1, spendComplete: true,
});

test('(c) the readout: each guardrail sits as "  ~ <guardrail>" right under its job line; a line with none gets no row', () => {
  const t = readout().split('\n');
  const i = t.indexOf('  1. read it,');
  assert.ok(i > 0);
  assert.equal(t[i + 1], '  ~ 3 sections, under 600 words');
  assert.equal(t[t.indexOf('  2. check with me') + 1], '');
});

test('(c) the readout: the five headings are found by the one list, and only they', () => {
  const t = readout().split('\n');
  const heads = readoutHeadIndexes(readout()).map((k) => t[k]);
  assert.deepEqual(heads, ['INPUTS', 'STEPS', 'ASKS (human stops)', 'SEND TARGET (nothing leaves before an accepted ask)', 'JOB LINES']);
});

test('(c) the page renders exactly those lines bold, the rest escaped plain', () => {
  const at = PAGE.indexOf('    function readoutHtml(');
  assert.ok(at !== -1);
  const src = `${fn('escapeXml')}\n${PAGE.slice(at, PAGE.indexOf('\n    }\n', at) + 7)}`;
  const readoutHtml = new Function(`${src}\nreturn readoutHtml;`)();
  const text = readout();
  const html = readoutHtml({ readout: text, readoutHeads: readoutHeadIndexes(text) });
  assert.equal((html.match(/<b class="readout-head">/g) || []).length, 5);
  assert.match(html, /<b class="readout-head">JOB LINES<\/b>\n  1\. read it,\n  ~ 3 sections/);
  assert.match(html, /\n  line 2: &quot;ok\?&quot;|\n  line 2:/);
  assert.equal(readoutHtml({ readout: '<script>', readoutHeads: [] }), '&lt;script&gt;', 'no head list = plain text, escaped');
});

test('(c) a Runs card\'s last line: spend, time in plain units, date, "1 run" — real separator text on the job card and the sub-card', () => {
  const src = ['escapeXml', 'money', 'duration', 'readableDateTime', 'runSpendText', 'runWallText', 'runAtText', 'runMetaLineHtml'].map(fn).join('\n');
  const { runMetaLineHtml } = new Function(`${src}\nreturn { runMetaLineHtml };`)();
  const r = { spend: '$0.0616', wallMs: 383000, at: '2026-10-06T10:00:00Z' };
  const text = (h) => h.replace(/<[^>]+>/g, '');
  assert.equal(text(runMetaLineHtml(r, '1 run')), '$0.0616 · 6m23s · 2026-10-06 · 1 run');
  assert.equal(text(runMetaLineHtml(r, null)), '$0.0616 · 6m23s · 2026-10-06');
  assert.equal(text(runMetaLineHtml({ ...r, wallMs: null }, '2 runs')), '$0.0616 · 2026-10-06 · 2 runs', 'unrecorded time is left out, never invented');
  assert.doesNotMatch(PAGE, /\.wf-meta \+ \.wf-meta::before/, 'no CSS-only separator');
  assert.doesNotMatch(PAGE, /wf-meta">' \+ g\.runCount/, 'the job card builds its line through the one builder');
});

test('(c) data.js hands the page the history row\'s wallMs (null when unrecorded)', () => {
  assert.match(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'data.js'), 'utf8'), /wallMs: ctx\.historyRow && typeof ctx\.historyRow\.wallMs === 'number'/);
});
