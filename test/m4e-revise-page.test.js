// M4e amendment 14 (docs/wiki/the-module-ladder.md, "Amendment 14 — SIGNED"): the page side. Revise reopens the card; no note box, no Send, no bubbles.
// Source-level, like test/m4e-chat-ui.test.js: the Chat block's own pure functions are cut out of index.html and run, and the markup
// and CSS are read for what must (not) be there. Real rendering at 1280/390/320 px is a browser walk the orchestrator still owes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));
const SECTION = PAGE.slice(PAGE.indexOf('<section id="panel-chat"'), PAGE.indexOf('</section>', PAGE.indexOf('<section id="panel-chat"')));
const CODE = CHAT.replace(/^\s*\/\/.*$/gm, '');

function fnSrc(name) {
  const start = CHAT.indexOf(`    function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in the Chat block`);
  return CHAT.slice(start, CHAT.indexOf('\n    }\n', start) + 7);
}
const load = (name, prelude = '') => new Function(`${prelude}\n${fnSrc(name)}\nreturn ${name};`)();
const green = { mode: 'new', session: true, startOk: true, busy: false, phase: 'green', revisable: true, left: 2 };

test('item 1: after a green plan there is no note box, no Send, no bubbles; the buttons are Sign & run and Revise', () => {
  assert.doesNotMatch(PAGE, /chat-msg|Ask for a change|bubblesFor|\bSend\b/);
  assert.doesNotMatch(CODE, /msgEl|msgRow|textEmpty|boxOpen|changesLeft|\.notes\b/);
  assert.doesNotMatch(PAGE, /\.msg\.you|class="msg you|role: "you"/);
  const mb = load('mainButtonFor');
  assert.deepEqual(mb(green), { text: 'Sign & run', action: 'sign-prepare', disabled: false });
  assert.match(SECTION, /<button[^>]*id="chat-revise-btn"[^>]*hidden>Revise<\/button>/);
  assert.equal(load('reviseShownFor')(green), true);
});

test('item 2: Revise opens the card; the main button reads Draft and posts the card to the revise route; Revise itself sends nothing', () => {
  const mb = load('mainButtonFor');
  assert.deepEqual(mb({ ...green, reviseOpen: true }), { text: 'Draft', action: 'revise', disabled: false });
  assert.deepEqual(mb({ ...green, reviseOpen: true, startOk: false }), { text: 'Draft', action: 'revise', disabled: true }, 'an unfillable card cannot be drafted');
  assert.equal(load('reviseShownFor')({ ...green, reviseOpen: true }), false, 'the Revise button goes once the card is open');
  const greenOpen = load('greenFieldsOpenFor');
  assert.equal(greenOpen(green), false, 'a green plan locks the card until Revise');
  assert.equal(greenOpen({ ...green, reviseOpen: true }), true);
  // the card is locked only while it must be: cardLocked asks greenFieldsOpenFor on a green plan
  assert.match(fnSrc('cardLocked'), /greenFieldsOpenFor\(\{revisable: Array\.isArray\(lastState\.revises\), reviseOpen: reviseOpen, left: lastState\.revisesLeft\}\)/);
  // wiring: the click only opens; the revise action posts currentCard() to the revise route
  assert.match(CODE, /reviseBtn\.addEventListener\("click", function\(\)\{ if\(reviseBtn\.disabled\) return; reviseOpen = true; refreshStartEnabled\(\); \}\);/);
  const doRevise = fnSrc('doRevise');
  assert.match(doRevise, /var body = currentCard\(\);/);
  assert.match(doRevise, /authorPost\("\/api\/author\/" \+ id \+ "\/revise", body\)/);
  assert.doesNotMatch(doRevise, /\{text:|\.note\b/);
  assert.match(CODE, /mainAction === "revise"\) doRevise\(\)/);
  // a refusal keeps every field as typed: the fields are written only by attachSession / resetCard, never by doRevise or the poll
  assert.doesNotMatch(doRevise, /setVal|\.value =/);
  assert.match(doRevise, /if\(!o\.ok\)\{ failFrom\(r\); refreshStartEnabled\(\); return; \}[\s\S]*reviseOpen = false;/, 'closes only after the call was accepted');
});

test('item 3: "2 revises left" / "1 revise left"; at 0 the button reads Start over, fields stay open, and it posts to the draft route', () => {
  const t = load('revisesLeftText');
  assert.equal(t(2), '2 revises left');
  assert.equal(t(1), '1 revise left');
  const mb = load('mainButtonFor');
  const so = load('startOverShownFor');
  // green with none left: Sign & run stays the main button; Start over sits beside it; the fields are open
  assert.deepEqual(mb({ ...green, left: 0 }), { text: 'Sign & run', action: 'sign-prepare', disabled: false });
  assert.equal(so({ ...green, left: 0 }), true);
  assert.equal(load('reviseShownFor')({ ...green, left: 0 }), false);
  assert.equal(load('greenFieldsOpenFor')({ ...green, left: 0 }), true, 'all fields stay open');
  for (const left of [1, 2, undefined]) assert.equal(so({ ...green, left }), false);
  assert.equal(so({ ...green, left: 0, revisable: false }), false);
  assert.equal(so({ ...green, left: 0, mode: 'run' }), false);
  // red/stopped with none left: Start over IS the main button, and its action is the draft call
  for (const phase of ['red', 'stopped']) {
    assert.deepEqual(mb({ ...green, phase, left: 0 }), { text: 'Start over', action: 'draft', startOver: true, disabled: false });
    assert.deepEqual(mb({ ...green, phase, left: 1 }), { text: 'Draft', action: 'revise', disabled: false }, 'revises left: another revise, not a new draft');
  }
  assert.match(CODE, /startOverBtn\.addEventListener\("click", function\(\)\{ if\(!startOverBtn\.disabled\) doDraft\(sessionId\); \}\);/, 'Start over names the draft it starts over from (amendment 14 item 6)');
  assert.match(fnSrc('doDraft'), /authorPost\("\/api\/author\/draft", body\)/);
  assert.match(fnSrc('doDraft'), /reviseOpen = false/, 'a new draft starts with the fields locked behind its own Revise');
  // the hint line says how many are left, and what the way on is at 0
  assert.match(fnSrc('renderMain'), /revisesLeftText\(st\.left\)/);
});

test('item 4: a red revise lists its reds, keeps the edits, and has no Sign & run', () => {
  const steps = load('stepsFor');
  const view = {
    phase: 'red', card: { capUsd: '0.25' }, reds: ['declaration: ask at line 4 is a stop only'], say: 'The revised plan did not pass the checks.', revisesLeft: 1,
    revises: [{ n: 1, phase: 'red', reds: ['declaration: ask at line 4 is a stop only'], say: 'x' }],
  };
  const s = steps(view, { model: 'm', starting: false, signClicked: false });
  assert.deepEqual(s.map((x) => `${x.id}:${x.status}`), ['drafted:done', 'revise-1:failed'], 'no sign line: nothing is signable');
  assert.deepEqual(s[1].details, ['declaration: ask at line 4 is a stop only'], 'the reds once; the sentence is on the card error line');
  const mb = load('mainButtonFor');
  const red = { ...green, phase: 'red', left: 1 };
  assert.notEqual(mb(red).action, 'sign-prepare');
  assert.notEqual(mb(red).action, 'sign');
  assert.equal(load('reviseShownFor')(red), false);
  assert.equal(so0(red), false);
  // the card stays unlocked on red (the edits are in the boxes and nothing rewrites them)
  const lock = fnSrc('cardLocked');
  assert.doesNotMatch(lock, /"red"|"stopped"/);
  // a green revise: one done line per revise, then the signature wait; a running one shows no signature line
  const g = steps({ phase: 'green', card: {}, revises: [{ n: 1, phase: 'green' }, { n: 2, phase: 'green' }] }, { model: 'm', starting: false, signClicked: false });
  assert.deepEqual(g.map((x) => `${x.id}:${x.status}`), ['drafted:done', 'revise-1:done', 'revise-2:done', 'sign:waiting']);
  const run = steps({ phase: 'revising', card: {}, revises: [{ n: 1, phase: 'running' }] }, { model: 'm', starting: false });
  assert.deepEqual(run.map((x) => `${x.id}:${x.status}`), ['drafted:done', 'revise-1:running']);
  function so0(st) { return load('startOverShownFor')(st); }
});

test('(g) a refresh brings back the newest plan or reds, the count, and the last submitted card; the poll never writes the fields', () => {
  const at = fnSrc('attachSession');
  for (const id of ['jf-name', 'jf-job', 'jf-cap-money', 'jf-dest-folder', 'jf-inputs', 'jf-ask-wait']) assert.match(at, new RegExp(`setVal\\("${id}"`), id);
  assert.match(at, /renderThread\(d\);\s*renderActions\(d\);/);
  // only these functions assign a card box's value; none is on the poll path
  for (const name of ['poll', 'renderThread', 'renderActions', 'renderProgress', 'renderMain', 'doRevise']) {
    assert.doesNotMatch(fnSrc(name), /setVal\(|jobEl\.value =|inputsBox\.value =|destEl\.value =|askWaitEl\.value =/, `${name} must not write the card boxes`);
  }
  // a revise being drafted leaves the shown plan alone; a green view replaces it; a red one shows no plan
  const prelude = `var threadKey = ""; var thread = { innerHTML: "" };
    var escapeXml = function(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); };
    ${fnSrc('readoutHtml')}`;
  const render = new Function(`${prelude}\n${fnSrc('renderThread')}\nreturn function(s){ renderThread(s); return thread.innerHTML; };`)();
  const h1 = render({ phase: 'green', readout: 'PLAN ONE', hash: 'aaa' });
  assert.match(h1, /PLAN ONE/);
  assert.equal(render({ phase: 'revising' }), h1, 'a revise in flight keeps the plan on show');
  const h2 = render({ phase: 'green', readout: 'PLAN TWO', hash: 'bbb' });
  assert.match(h2, /PLAN TWO/);
  assert.doesNotMatch(h2, /PLAN ONE/);
  assert.equal(render({ phase: 'red', reds: ['x'] }), '', 'a red newest revise shows no plan to sign');
});

test('am14 item 6 (page): layout order is card fields, progress, plan, then the buttons; every id on the page is unique; fluid at 320px', () => {
  const pos = (id) => SECTION.indexOf(`id="${id}"`);
  assert.ok(pos('chat-card-error') < pos('chat-progress-row') && pos('chat-progress-row') < pos('chat-thread'), 'card fields, progress, then the plan');
  assert.ok(pos('chat-thread') < pos('chat-main-btn') && pos('chat-main-btn') < pos('chat-revise-btn') && pos('chat-revise-btn') < pos('chat-startover-btn'));
  const ids = [...PAGE.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, [], `duplicate ids: ${dup.join(', ')}`);
  for (const id of ['chat-revise-btn', 'chat-startover-btn', 'chat-main-btn']) assert.equal(ids.filter((x) => x === id).length, 1, id);
  // no fixed widths: the wide buttons are 100% of the column, the plan wraps
  assert.match(PAGE, /\.btn\.wide\{width:100%;margin-top:10px;white-space:normal;\}/);
  assert.match(PAGE, /\.msg\{[^}]*max-width:100%[^}]*word-break:break-word[^}]*white-space:pre-wrap/);
  assert.match(PAGE, /\.chat-steps \.step-label\{[^}]*overflow-wrap:anywhere/);
});
