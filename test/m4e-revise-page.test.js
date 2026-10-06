// M4e amendment 3 item 3 (docs/wiki/the-module-ladder.md, "M4e", "Amendment 3", "Revise the plan (bareloop's way)"): the page side.
// Source-level, like test/m4e-chat-ui.test.js: the Chat block's own pure functions are cut out of index.html and run, and the markup
// and CSS are read for what must be there. Real rendering at 1280/390/320 px is a browser walk the orchestrator still owes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));
const SECTION = PAGE.slice(PAGE.indexOf('<section id="panel-chat"'), PAGE.indexOf('</section>', PAGE.indexOf('<section id="panel-chat"')));

function fnSrc(name) {
  const start = CHAT.indexOf(`    function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in the Chat block`);
  return CHAT.slice(start, CHAT.indexOf('\n    }\n', start) + 7);
}
const load = (name, prelude = '') => new Function(`${prelude}\n${fnSrc(name)}\nreturn ${name};`)();
const green = { mode: 'new', session: true, startOk: true, busy: false, phase: 'green', left: 2, textEmpty: true };

test('the ask box opens only on a green plan with changes left, in New job mode; at 0 left it closes', () => {
  const open = load('askBoxOpenFor');
  assert.equal(open(green), true);
  assert.equal(open({ ...green, left: 1 }), true);
  assert.equal(open({ ...green, left: 0 }), false, 'at 0 the box closes');
  assert.equal(open({ ...green, left: undefined }), false);
  for (const phase of ['drafting', 'revising', 'red', 'stopped', undefined]) assert.equal(open({ ...green, phase }), false, `closed while ${phase}`);
  assert.equal(open({ ...green, mode: 'run' }), false);
  assert.equal(open({ ...green, session: false }), false);
});

test('the hint reads "2 changes left" / "1 change left"', () => {
  const t = load('changesLeftText');
  assert.equal(t(2), '2 changes left');
  assert.equal(t(1), '1 change left');
  assert.equal(t(0), '0 changes left');
});

test('the main button reads Send while the box has text and Sign & run while it is empty; Send is a revise', () => {
  const mb = load('mainButtonFor');
  assert.deepEqual(mb({ ...green, boxOpen: true, textEmpty: false }), { text: 'Send', action: 'revise', disabled: false });
  assert.deepEqual(mb({ ...green, boxOpen: true, textEmpty: false, busy: true }), { text: 'Send', action: 'revise', disabled: true });
  assert.deepEqual(mb({ ...green, boxOpen: true, textEmpty: true }), { text: 'Sign & run', action: 'sign-prepare', disabled: false });
  // after the first Sign click the second-click label stays while the box is empty
  assert.deepEqual(mb({ ...green, boxOpen: true, textEmpty: true, signClicked: true, hash: '7cc0122f0f3058b12a57', capUsd: 0.25 }).action, 'sign');
  // a change being drafted: nothing to click
  assert.deepEqual(mb({ ...green, phase: 'revising', boxOpen: false }), { text: 'Sign & run', action: 'none', disabled: true });
  // the box closed (0 left): typed text cannot turn the button into Send
  assert.equal(mb({ ...green, left: 0, boxOpen: false, textEmpty: false }).action, 'sign-prepare');
});

test('the progress list shows each note, its result, and a red change\'s reds; the plan on show is still waiting for the signature', () => {
  const steps = load('stepsFor');
  const ids = (st) => st.map((x) => `${x.id}:${x.status}`);
  const state = (phase, notes) => ({ phase, card: { capUsd: '0.25' }, notes });
  const notes = [
    { n: 1, text: 'use grep instead\n', phase: 'green' },
    { n: 2, text: 'drop the check', phase: 'red', reds: ['declaration: ask at line 4 is a stop only'], say: 'The change did not pass the checks.' },
  ];
  const s = steps(state('green', notes), { model: 'deepseek-flash', starting: false, signClicked: false });
  assert.deepEqual(ids(s), ['drafted:done', 'change-1:done', 'change-2:failed', 'sign:waiting']);
  assert.equal(s[1].label, 'change 1: use grep instead');
  assert.deepEqual(s[2].details, ['declaration: ask at line 4 is a stop only', 'The change did not pass the checks.']);
  const running = steps(state('revising', [{ n: 1, text: 'slow one', phase: 'running' }]), { model: 'm', starting: false, signClicked: false });
  assert.deepEqual(ids(running), ['drafted:done', 'change-1:running'], 'no signature line while a change is coming');
  assert.deepEqual(ids(steps(state('green', []), { model: 'm', starting: false })), ['drafted:done', 'sign:waiting'], 'no notes: as before');
  // the note is escaped where the list is painted (escapeXml on every label and detail)
  assert.match(CHAT, /escapeXml\(st\.label\)/);
});

test('markup: the ask box is one textarea inside the Chat tab, closed until a plan asks for it, placed above the one main button, wide and wrapping', () => {
  assert.equal((PAGE.match(/\sid="chat-msg"/g) ?? []).length, 1);
  assert.match(SECTION, /<div class="chat-input-row" id="chat-msg-row"[^>]*\bhidden>/);
  assert.match(SECTION, /<textarea id="chat-msg"[^>]*placeholder="Ask for a change to the plan"/);
  assert.ok(SECTION.indexOf('id="chat-msg"') < SECTION.indexOf('id="chat-main-btn"'), 'the box sits above the main button, as in bareloop');
  assert.ok(SECTION.indexOf('id="chat-action-error"') < SECTION.indexOf('id="chat-msg"'));
  assert.match(PAGE, /textarea\[data-testid="chat-msg"\]\{width:100%;box-sizing:border-box;/, 'no spill: full width of its column, border-box');
  assert.match(PAGE, /#chat-msg\{min-height:64px;padding:8px 12px;border:2px solid var\(--field-border\)/);
  assert.match(PAGE, /\.chat-input-row\[hidden\]\{display:none;\}/, 'the hidden attribute wins over any display rule');
  assert.match(PAGE, /\.chat-steps \.step-label\{[^}]*overflow-wrap:anywhere/, 'a long note wraps inside the list at 320px');
  assert.match(PAGE, /#panel-chat textarea:not\(:disabled\):not\(\[readonly\]\):not\(#chat-msg\)\{/, 'the card\'s soft-white rule does not repaint the ask box');
});

test('wiring: Send posts the note to /revise; a refused note stays in the box; a sent one clears the box and voids the first Sign click; Enter sends, Shift+Enter does not', () => {
  const doRevise = fnSrc('doRevise');
  assert.match(doRevise, /authorPost\("\/api\/author\/" \+ id \+ "\/revise", \{text: text\}\)/);
  const failIdx = doRevise.indexOf('if(!o.ok)');
  const clearIdx = doRevise.indexOf('msgEl.value = ""');
  assert.ok(failIdx !== -1 && clearIdx > failIdx, 'the box is cleared only after the refusal branch returned');
  assert.match(doRevise, /signInfo = null; signClickedOnce = false;/);
  assert.match(CHAT, /mainAction === "revise"\) doRevise\(\)/);
  assert.match(CHAT, /e\.key === "Enter" && !e\.shiftKey && mainAction === "revise"/);
  // the page never overwrites the box on a poll tick: the only writes to its value are the clear after a sent note and a new card
  const writes = [...CHAT.matchAll(/msgEl\.value = /g)].length;
  assert.equal(writes, 2, 'two writes only: doRevise (after success) and openNewCard');
  // the card stays locked while a change is drafted, and a plan newer than the Sign click shown voids that click
  assert.match(fnSrc('cardLocked'), /ph === "revising"/);
  assert.match(fnSrc('renderActions'), /state\.hash !== signInfo\.hash/);
  assert.match(CHAT, /borrowed-from|ask box/, 'the block still says where it came from');
  assert.match(PAGE, /borrowed-from: bareloop src\/panel\/index\.html@d151ec7/);
});

// M4e amendment 4 item 3 negative (c), page side: bubbles, Start over, ids. Real rendering at 1280/390/320 is the browser walk still owed.
const twoNotes = {
  phase: 'green', hash: 'bbbbbbbbbbbbbbbb', readout: 'plan', changesLeft: 0,
  notes: [
    { n: 1, text: 'use grep\n', phase: 'green', hash: 'aaaaaaaa11112222', left: 1 },
    { n: 2, text: 'shorter', phase: 'green', hash: 'bbbbbbbb33334444', left: 0 },
  ],
};
test('am4 item 3 (c): two notes are two you bubbles and two fwdloop bubbles, in order, with the hash and changes left', () => {
  const b = load('bubblesFor', fnSrc('changesLeftText'))(twoNotes);
  assert.deepEqual(b, [
    { role: 'you', who: 'you', text: 'use grep' },
    { role: 'bot', who: 'fwdloop', text: 'New plan, hash aaaaaaaa. 1 change left.' },
    { role: 'you', who: 'you', text: 'shorter' },
    { role: 'bot', who: 'fwdloop', text: 'New plan, hash bbbbbbbb. 0 changes left.' },
  ]);
});
test('am4 item 3: a red or running change shows only the you bubble (its reds stay in the progress list, never echoed)', () => {
  const f = load('bubblesFor', fnSrc('changesLeftText'));
  const b = f({ phase: 'green', notes: [{ n: 1, text: 'x', phase: 'red', reds: ['r'], say: 's' }, { n: 2, text: 'y', phase: 'running' }] });
  assert.deepEqual(b.map((m) => m.role), ['you', 'you']);
  assert.ok(!JSON.stringify(b).includes('"r"'));
  assert.deepEqual(f({ phase: 'red', notes: twoNotes.notes }), [], 'no bubbles unless there is a plan');
  assert.deepEqual(f(null), []);
});
test('am4 item 3 (c): Start over shows only after the second change (box closed); never while changes are left, drafting or in Run mode', () => {
  const f = load('startOverShownFor');
  const st = { mode: 'new', session: true, phase: 'green', left: 0 };
  assert.equal(f(st), true);
  assert.equal(f({ ...st, left: 1 }), false);
  assert.equal(f({ ...st, left: 2 }), false);
  assert.equal(f({ ...st, left: undefined }), false);
  for (const phase of ['drafting', 'revising', 'red', 'stopped']) assert.equal(f({ ...st, phase }), false);
  assert.equal(f({ ...st, mode: 'run' }), false);
  assert.equal(f({ ...st, session: false }), false);
});
test('am4 item 3: Start over is wired to the one Draft call (no abandon, no second path), the thread draws the bubbles, and the ids are unique', () => {
  assert.match(CHAT, /startOverBtn\.addEventListener\("click", function\(\)\{ if\(!startOverBtn\.disabled\) doDraft\(\); \}\);/);
  assert.match(CHAT, /startOverBtn\.hidden = !startOverShownFor\(st\)/);
  assert.match(fnSrc('renderThread'), /bubblesFor\(state\)/);
  assert.equal((PAGE.match(/id="chat-startover-btn"/g) || []).length, 1);
  assert.match(SECTION, /<button[^>]*id="chat-startover-btn"[^>]*hidden>Start over<\/button>/);
  // no spill: bubbles wrap and never exceed the column; the you bubble's indent is small
  assert.match(PAGE, /\.msg\{[^}]*max-width:100%[^}]*word-break:break-word[^}]*white-space:pre-wrap/);
  assert.match(PAGE, /\.msg\.you\{[^}]*margin-left:20px/);
});
