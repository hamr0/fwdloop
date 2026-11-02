// M13 am5 (required marks + Inputs in the New-card readiness), the Chat card captions (hamr ruling 2026-11-01, variant A) and the tab-number removal (same day).
// $0, no browser: the page's REAL functions are cut out of src/panel/index.html and run against stub boxes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { fnSrc } from '../scripts/panel-fixtures/fn-src.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));

/** The page's real startReady/currentCard/paintRequired over stub boxes. */
function card({ flow = 'plain', inputs = 'resume: /a.md', name = 'tick', job = 'Read it', cap = '5', rows = 0 } = {}) {
  const els = {};
  const el = (id) => (els[id] ??= { textContent: '', hidden: false, value: '' });
  el('jf-name').value = name; el('jf-cap-money').value = cap;
  const flowTypeEl = { value: flow };
  const runInputsEl = { children: Array.from({ length: rows }) };
  const src = ['currentCard', 'startReady', 'paintRequired'].map((n) => fnSrc(CHAT, n, '    ')).join('\n');
  const fns = new Function('byId', 'jobEl', 'destEl', 'inputsBox', 'askWaitEl', 'modelPick', 'thinkingEl', 'thinkingNone', 'flowTypeEl', 'mcpEl', 'scheduleOfCard', 'reuseOf', 'moneyRed', 'mode', 'runInputsEl',
    `${src}\nreturn { startReady, paintRequired };`)(
    el, { value: job }, { value: '/out' }, { value: inputs }, { value: '1h' }, () => ({ provider: 'x', model: 'y' }), { checked: false }, false, flowTypeEl, { value: 'github' }, () => null, null, false, 'new', runInputsEl);
  return { ...fns, els, flowTypeEl };
}

test('am5: the main button is off for a plain and a Tickets MCP card with empty or blank Inputs, on once filled', () => {
  for (const flow of ['plain', 'tickets']) {
    assert.equal(card({ flow, inputs: '' }).startReady(), false, `${flow} empty`);
    assert.equal(card({ flow, inputs: '  \n ' }).startReady(), false, `${flow} blank`);
    assert.equal(card({ flow, inputs: 'a: /x.md' }).startReady(), true, `${flow} filled`);
  }
});

test('am5: an MCP card may leave Inputs empty and the button is on', () => {
  assert.equal(card({ flow: 'mcp', inputs: '' }).startReady(), true);
  assert.equal(card({ flow: 'mcp', inputs: ' ' }).startReady(), true);
});

test('am5: Flow name, The job and Cap $ still each switch the button off when empty (and a bad cap)', () => {
  assert.equal(card({ name: '' }).startReady(), false);
  assert.equal(card({ job: '  ' }).startReady(), false);
  assert.equal(card({ cap: '' }).startReady(), false);
  assert.equal(card({ cap: '0' }).startReady(), false);
  assert.equal(card({ cap: 'abc' }).startReady(), false);
});

test('am5: the Inputs mark follows the Flow type pick; the Run card mark shows only when the flow has input rows', () => {
  const c = card({ flow: 'plain', rows: 2 });
  c.paintRequired();
  assert.equal(c.els['jf-req-inputs'].textContent, 'required');
  assert.equal(c.els['jf-run-req-inputs'].hidden, false);
  c.flowTypeEl.value = 'mcp'; c.paintRequired();
  assert.equal(c.els['jf-req-inputs'].textContent, 'optional for MCP');
  c.flowTypeEl.value = 'tickets'; c.paintRequired();
  assert.equal(c.els['jf-req-inputs'].textContent, 'required');
  const none = card({ rows: 0 }); none.paintRequired();
  assert.equal(none.els['jf-run-req-inputs'].hidden, true);
});

test('am5: the marks are in the markup, after the caption, on the four New card fields and on Run a signed flow (inputs, Cap $)', () => {
  const body = (id, to) => PAGE.slice(PAGE.indexOf(`<div id="${id}"`), PAGE.indexOf(`<div id="${to}"`));
  const nu = body('jf-new', 'jf-run');
  for (const l of ['jf-name">Flow name', 'jf-job">The job', 'jf-inputs">Inputs', 'jf-cap-money">Cap $']) {
    assert.match(nu, new RegExp(`for="${l.replace('$', '\\$')} <span class="req"`), l);
  }
  const run = body('jf-run', 'jf-resume');
  assert.match(run, /<label>Inputs <span class="req" id="jf-run-req-inputs"/);
  assert.match(run, /for="jf-run-cap">Cap \$ <span class="req"/);
  assert.equal((nu.match(/class="req"/g) ?? []).length, 5); // M13 am6 added Destination
  assert.doesNotMatch(body('jf-resume', 'zz-none-zz'), /class="req"/, 'the Resume card is not changed');
});
