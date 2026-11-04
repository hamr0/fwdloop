// M13 am6: Destination is required on the New job card (mark, button, server refusal at $0). $0, no browser, no server.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { fnSrc } from '../scripts/panel-fixtures/fn-src.mjs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { cardFields, checkCard } from '../src/panel/authorcard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));

/** The page's real startReady/currentCard/paintRequired over stub boxes. */
function page({ flow = 'plain', dest = '/out', inputs = 'a: /x.md', mode = 'new' } = {}) {
  const els = {};
  const el = (id) => (els[id] ??= { textContent: '', hidden: false, value: '' });
  el('jf-name').value = 'tick'; el('jf-cap-money').value = '5';
  const flowTypeEl = { value: flow };
  const src = ['currentCard', 'startReady', 'paintRequired'].map((n) => fnSrc(CHAT, n, '    ')).join('\n');
  const fns = new Function('byId', 'jobEl', 'destEl', 'inputsBox', 'askWaitEl', 'modelPick', 'thinkingEl', 'thinkingNone', 'flowTypeEl', 'mcpEl', 'scheduleOfCard', 'reuseOf', 'moneyRed', 'mode', 'runInputsEl',
    `${src}\nreturn { startReady, paintRequired };`)(
    el, { value: 'Read it' }, { value: dest }, { value: inputs }, { value: '1h' }, () => ({ provider: 'x', model: 'y' }), { checked: false }, false, flowTypeEl, { value: 'github' }, () => null, null, false, mode, { children: [] });
  return { ...fns, els };
}

test('am6: the Destination mark reads required for plain, Tickets MCP and MCP', () => {
  for (const flow of ['plain', 'tickets', 'mcp']) {
    const p = page({ flow }); p.paintRequired();
    assert.equal(p.els['jf-req-destination'].textContent, 'required', flow);
  }
});

test('am6: the mark is in the markup after the Destination caption', () => {
  assert.match(PAGE, /for="jf-dest-folder">Destination <span class="req" id="jf-req-destination" data-testid="jf-req-destination">/);
});

test('am6: the main button is off with an empty or blank Destination for every flow type, on once filled', () => {
  for (const flow of ['plain', 'tickets', 'mcp']) {
    assert.equal(page({ flow, dest: '' }).startReady(), false, `${flow} empty`);
    assert.equal(page({ flow, dest: '  ' }).startReady(), false, `${flow} blank`);
    assert.equal(page({ flow, dest: '/out' }).startReady(), true, `${flow} filled`);
  }
});

test('am6: the Run a signed flow card is unchanged (its gate and markup do not use the Destination box)', () => {
  const ready = fnSrc(CHAT, 'startReady', '    ');
  const runBranch = ready.slice(ready.indexOf('if(mode === "run")'), ready.indexOf('if(mode === "resume")'));
  assert.doesNotMatch(runBranch, /dest/i);
  assert.doesNotMatch(PAGE.slice(PAGE.indexOf('<div id="jf-run"'), PAGE.indexOf('<div id="jf-resume"')), /jf-req-destination/);
});

test('am6: the hint no longer says "Leave empty for no send."', () => {
  assert.doesNotMatch(PAGE, /Leave empty for no send/);
});

test('am6: the server refuses an empty Destination at $0, naming Destination, with no other refusal', (t) => {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13am6-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const root = path.join(work, 'flows'); const inDir = path.join(work, 'in'); const out = path.join(work, 'out');
  for (const d of [root, inDir, out]) mkdirSync(d);
  writeFileSync(path.join(inDir, 'a.md'), '# A\n');
  const mk = (destination) => checkCard(cardFields({ flowName: 'tick', job: 'Read it\nAsk 1h: ok?\nWrite it', inputs: `a: ${path.join(inDir, 'a.md')}`, destination, capUsd: '5', askWait: '1h', provider: 'x', model: 'y' }), { root });
  for (const d of ['', '   ']) {
    const r = mk(d);
    assert.equal(r.ok, false);
    assert.deepEqual(r.refusals.map((x) => x.field), ['destination']);
    assert.match(r.refusals[0].say, /^Destination is empty\./);
  }
  assert.equal(mk(out).ok, true);
});
