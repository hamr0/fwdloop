// M4e piece 3 (docs/wiki/the-module-ladder.md, "M4e", scope 1-3, 10, 14): the Chat tab in src/panel/index.html. Source-level, like
// the M4c/M4d page tests: the page's own pure functions are cut out of index.html and run, and the markup/script are read for
// what must (not) be there. Real rendering is walked in a browser by the orchestrator.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));
const SECTION = PAGE.slice(PAGE.indexOf('<section id="panel-chat"'), PAGE.indexOf('</section>', PAGE.indexOf('<section id="panel-chat"')));

/** Cut `function name(` .. its closing "\n    }" (the Chat IIFE's indent) out of the Chat block. */
function fnSrc(name) {
  const start = CHAT.indexOf(`    function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in the Chat block`);
  return CHAT.slice(start, CHAT.indexOf('\n    }\n', start) + 7);
}
const load = (name, prelude = '') => new Function(`${prelude}\n${fnSrc(name)}\nreturn ${name};`)();

const base = { mode: 'new', session: false, startOk: true, busy: false };

test('mainButtonFor: every state gives its label, action and enabled state', () => {
  const mb = load('mainButtonFor');
  const want = (st, textEmpty, text, action, disabled) => assert.deepEqual(mb(st, textEmpty), { text, action, disabled }, JSON.stringify(st));
  // nothing live: Draft, enabled only when the card is fillable and nothing is in flight
  want(base, true, 'Draft', 'draft', false);
  want({ ...base, startOk: false }, true, 'Draft', 'draft', true);
  want({ ...base, busy: true }, true, 'Draft', 'draft', true);
  // Run a signed flow: the cap is on the label
  want({ ...base, mode: 'run', capUsd: 0.25 }, true, 'Run \u2014 spends up to $0.25', 'run', false);
  want({ ...base, mode: 'run', capUsd: 0.25, startOk: false }, true, 'Run \u2014 spends up to $0.25', 'run', true);
  want({ ...base, mode: 'run', capUsd: 0.25, busy: true }, true, 'Run \u2014 spends up to $0.25', 'run', true);
  want({ ...base, mode: 'run' }, true, 'Run', 'run', false);
  // drafting: disabled
  want({ ...base, session: true, phase: 'drafting' }, true, 'Draft', 'none', true);
  // red / stopped: draft again
  want({ ...base, session: true, phase: 'red' }, true, 'Fix and draft again', 'draft', false);
  want({ ...base, session: true, phase: 'red', startOk: false }, true, 'Fix and draft again', 'draft', true);
  want({ ...base, session: true, phase: 'stopped' }, true, 'Draft again', 'draft', false);
  // green: Sign & run, then (after the first click) the hash and the cap, enabled only once a name is typed
  want({ ...base, session: true, phase: 'green' }, true, 'Sign & run', 'sign-prepare', false);
  want({ ...base, session: true, phase: 'green', busy: true }, true, 'Sign & run', 'sign-prepare', true);
  const signed = {
    ...base, session: true, phase: 'green', signClicked: true, hash: '7cc0122f0f3058b12a57', capUsd: 0.25,
  };
  want(signed, true, 'Sign 7cc0122f & run \u2014 spends up to $0.25', 'sign', true);
  want(signed, false, 'Sign 7cc0122f & run \u2014 spends up to $0.25', 'sign', false);
  want({ ...signed, busy: true }, false, 'Sign 7cc0122f & run \u2014 spends up to $0.25', 'sign', true);
  // any other phase: nothing to click
  want({ ...base, session: true, phase: 'signed' }, true, 'Draft', 'none', true);
});

test('askBoxOpenFor: open only at the sign step; dimmed and emptied at every other time', () => {
  const open = load('askBoxOpenFor');
  assert.equal(open({ ...base, session: true, phase: 'green', signClicked: true }), true);
  assert.equal(open({ ...base, session: true, phase: 'green', signClicked: false }), false);
  for (const phase of ['drafting', 'red', 'stopped', 'signed', 'abandoned']) assert.equal(open({ ...base, session: true, phase, signClicked: true }), false, phase);
  assert.equal(open({ ...base, session: false, phase: 'green', signClicked: true }), false);
  assert.equal(open({ ...base, mode: 'run', session: true, phase: 'green', signClicked: true }), false);
  // the page empties and disables the box whenever it is not open
  assert.match(fnSrc('renderMain'), /msgInput\.disabled = !open;[\s\S]*?if\(!open\) msgInput\.value = "";/);
});

test('field set: the New job card has exactly the signed boxes; bareloop-only boxes are gone; the card box is captioned Destination', () => {
  for (const id of ['jf-name', 'jf-job', 'jf-cap-money', 'jf-dest-line', 'jf-dest-folder', 'jf-inputs', 'jf-add-input', 'jf-run-flow', 'jf-run-cap', 'jf-run-left', 'jf-run-inputs', 'jf-run-id', 'chat-msg', 'chat-main-btn', 'chat-action-error', 'chat-card-error', 'chat-clear-btn']) {
    assert.ok(SECTION.includes(`id="${id}"`), `#${id} missing`);
  }
  const labels = [...SECTION.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
  for (const cap of ['Flow name', 'The job', 'Cap $', 'Destination', 'Inputs', 'New job', 'Run a signed flow']) assert.ok(labels.includes(cap), `caption "${cap}" missing`);
  assert.doesNotMatch(SECTION, />\s*Send to\s*</);
  for (const gone of ['jf-goal', 'jf-source', 'jf-success', 'jf-guardrails', 'jf-judge', 'jf-model', 'jf-verdict', 'jf-cap-time', 'startfrom', 'Check type', 'Time cap', 'Judge examples', 'Reuse']) {
    assert.ok(!SECTION.includes(gone), `${gone} must not be on the card`);
    assert.ok(!CHAT.replace(/^\s*\/\/.*$/gm, '').includes(gone), `${gone} must not be in the Chat script`);
  }
  assert.match(SECTION, /name="jf-mode" value="new" checked/);
  assert.match(SECTION, /Where the accepted result is placed/);
  assert.match(SECTION, /Only your click signs\./);
  assert.doesNotMatch(SECTION, /id="chat-msg"[^>]*placeholder=/, 'the placeholder is set by renderMain only while the box is open');
  assert.match(CHAT, /borrowed-from: bareloop src\/panel\/index\.html@ca7195e/);
  assert.match(PAGE, /--field-bg:#ffffff; --field-soft-bg:#f7f7f9;[\s\S]*--field-bg:#ffffff; --field-soft-bg:#f7f7f9;/, 'field tokens in both light blocks');
  assert.match(PAGE, /--field-bg:var\(--bg\); --field-soft-bg:var\(--bg\); --field-border:var\(--text-dim\);/, 'and the dark default');
});

test('#chat-action-error is written only by the click handlers: the poll path never touches it', () => {
  const writers = [...CHAT.matchAll(/actionErrEl\.textContent\s*=/g)].length;
  // chatActionFailed, chatActionOk, openNewCard (a click's reset) and staleTokenHook
  assert.equal(writers, 4, 'only four places may write the action line');
  for (const name of ['poll', 'renderActions', 'renderProgress', 'renderThread', 'renderMain', 'endSession']) {
    assert.doesNotMatch(fnSrc(name).replace(/^\s*\/\/.*$/gm, ''), /actionErrEl|chatActionOk|chatActionFailed|chat-action-error|resetCard|openNewCard/, `${name} is on the poll path and must not touch #chat-action-error`);
  }
  // the start poll may SET the refusal (once, via chatActionFailed) but never clears it
  const ps = fnSrc('pollStart');
  assert.match(ps, /chatActionFailed\(/);
  assert.doesNotMatch(ps, /chatActionOk|actionErrEl/);
  // and #chat-card-error is the poll's: only renderActions writes it among the render path
  assert.match(fnSrc('renderActions'), /errEl\.textContent = /);
  assert.doesNotMatch(fnSrc('chatActionFailed'), /errEl\.textContent = [^;]*\n.*errEl/);
  assert.doesNotMatch(fnSrc('chatActionFailed'), /\berrEl\b/);
});

test('progress list rules: waiting has no check, detail on its own lines, no repeated lines; scroll on change only, never focus', () => {
  const steps = load('stepsFor');
  const waiting = steps({ phase: 'green', card: { capUsd: 0.25 } }, { model: 'm', starting: false, signClicked: false });
  assert.deepEqual(waiting.map((s) => [s.id, s.status]), [['drafted', 'done'], ['sign', 'waiting']]);
  const drafting = steps({ phase: 'drafting', card: { capUsd: '0.25' } }, { model: 'deepseek-flash', starting: false });
  assert.deepEqual(drafting, [{ id: 'drafting', label: 'drafting with deepseek-flash, run cap $0.25', status: 'running', details: [] }]);
  const red = steps({ phase: 'red', reds: ['a', 'b'] }, { model: 'm', starting: false });
  assert.deepEqual(red[1].details, ['a', 'b']);
  const dup = steps({ phase: 'drafting' }, { model: '', starting: true });
  assert.equal(new Set(dup.map((s) => JSON.stringify(s))).size, dup.length);
  // rendering: a waiting step is class wait with no check sign; the detail is a "> " line of its own
  const rp = fnSrc('renderProgress');
  assert.match(rp, /st\.status === "waiting" \? "wait"/);
  assert.match(rp, /cls === "ok" \? "(\\u2713|\u2713)"/);
  assert.match(rp, /escapeXml\("> " \+ d\)/);
  assert.match(fnSrc('renderActions'), /if\(progressChanged && sessionLive && progressRow\.lastElementChild\)[\s\S]*scrollIntoView\(\{block: "nearest"\}\)/);
  assert.doesNotMatch(CHAT.replace(/^\s*\/\/.*$/gm, ''), /\.focus\(\)/);
});

test('stale page: a 403 cookie refusal becomes one plain sentence and stops the poll', () => {
  const prelude = 'var STALE_REFUSAL = "cookie-missing-or-wrong"; var STALE_LINE = "The panel restarted. Reload this page."; var hits = 0; var staleTokenHook = function(){ hits++; };';
  const f = new Function(`${prelude}\n${fnSrc('staleTokenCheck')}\nreturn { staleTokenCheck, hits: function(){ return hits; } };`)();
  const j = { ok: false, refused: 'cookie-missing-or-wrong', red: 'x' };
  assert.equal(f.staleTokenCheck(j, 403).say, 'The panel restarted. Reload this page.');
  assert.equal(f.hits(), 1);
  assert.equal(f.staleTokenCheck({ ok: false, refused: 'name-mismatch', say: 'no' }, 400).say, 'no');
  assert.equal(f.hits(), 1, 'another refusal is not a stale page');
  assert.match(CHAT, /staleTokenHook = function\(\)\{[\s\S]*?stopPoll\(\);/);
});

test('the Chat tab keeps the page rules: no token on the page, every POST goes through postJSON, the only POSTs are the author doors', () => {
  const code = CHAT.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bTOKEN\b|x-fwdloop-token/);
  assert.doesNotMatch(code, /\bfetch\([^)]*POST/);
  const paths = [...code.matchAll(/authorPost\(\s*"([^"]+)"/g)].map((m) => m[1]).filter((x) => !x.endsWith('/')).sort();
  assert.deepEqual(paths, ['/api/author/draft', '/api/author/run']);
  assert.match(code, /authorPost\("\/api\/author\/" \+ id \+ "\/sign-prepare"/);
  assert.match(code, /authorPost\("\/api\/author\/" \+ id \+ "\/sign", \{hash: signInfo\.hash, typedName: msgInput\.value, runId: signInfo\.runId\}/);
  assert.match(code, /authorPost\("\/api\/author\/" \+ id \+ "\/abandon"/);
});

test('F4 the ask box shows "Type the flow name to sign" only while it is open at the sign step; empty otherwise', () => {
  // renderMain runs in one scope with the page's own functions and stand-ins for its state and boxes ('STALE' = what the box held before)
  const run = (state) => new Function(`
    var mode = ${JSON.stringify(state.mode)}, startOk = true, busy = false, startId = null, signClickedOnce = ${!!state.signClicked}, sessionLive = ${!!state.session}, lastState = ${JSON.stringify(state.lastState ?? null)}, signInfo = null, mainAction = 'none';
    var msgInput = { disabled: false, value: '', placeholder: 'STALE' };
    var mainBtn = { textContent: '', disabled: false }, mainHint = { textContent: '' };
    function selectedFlow(){ return null; } function fitBox(){} function fitCardBoxes(){}
    ${fnSrc('askBoxOpenFor')}
    ${fnSrc('mainButtonFor')}
    ${fnSrc('renderMain')}
    renderMain();
    return msgInput;
  `)();
  assert.equal(run({ mode: 'new' }).placeholder, '', 'empty card: closed');
  assert.equal(run({ mode: 'new', session: true, lastState: { phase: 'green' } }).placeholder, '', 'green, sign not clicked yet: closed');
  assert.equal(run({ mode: 'run' }).placeholder, '', 'run mode: closed');
  const open = run({ mode: 'new', session: true, signClicked: true, lastState: { phase: 'green' } });
  assert.equal(open.disabled, false);
  assert.equal(open.placeholder, 'Type the flow name to sign', 'open at the sign step');
});

test('F2 page: after a reload a refused start shows its sentence and a starting one is re-attached; Clear dismisses it on the server', () => {
  const re = fnSrc('reattachLive');
  assert.match(re, /j\.start/);
  assert.match(re, /st\.phase === "starting"[^\n]*beginStart\(st\.startId\)/);
  assert.match(re, /st\.phase === "refused"[\s\S]*chatActionFailed\(/);
  assert.match(re, /The flow is signed; start it from/, 'a refused SIGN start keeps its second sentence');
  assert.match(fnSrc('pollStart'), /refusedStartId = j\.startId/);
  assert.match(fnSrc('beginStart'), /refusedStartId = null/, 'a new start supersedes the old refusal');
  assert.match(CHAT, /authorPost\("\/api\/author\/start\/" \+ rid \+ "\/clear"/);
});

test('F3 audit: every author POST in the page shows a refusal (any non-2xx, any network error) in #chat-action-error', () => {
  for (const [name, posts] of [['doDraft', 1], ['doRun', 1], ['doSign', 2], ['doAbandon', 1]]) {
    const src = fnSrc(name);
    assert.equal([...src.matchAll(/authorPost\(/g)].length, posts, `${name}: POST count`);
    // every reply is judged by the one outcome function, a refusal goes to failFrom (-> chatActionFailed), a dead network to the catch
    assert.equal([...src.matchAll(/chatPostOutcome\(r\)/g)].length, posts, `${name}: every reply is judged`);
    assert.ok([...src.matchAll(/failFrom\(r\)/g)].length >= posts, `${name}: a refusal reaches failFrom`);
    assert.equal([...src.matchAll(/\.catch\(function\(\)\{[^}]*chatActionFailed\(NETWORK_SAY\)/g)].length, posts, `${name}: a network error reaches the action line`);
  }
  // failFrom always ends in chatActionFailed with a sentence (the server's say, else the fixed fallback) — never a silent return
  assert.match(fnSrc('failFrom'), /chatActionFailed\(text\);/);
  assert.match(fnSrc('refusalText'), /The request failed\. Nothing was sent\./);
});
