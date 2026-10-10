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
  const want = (st, _unused, text, action, disabled) => assert.deepEqual(mb(st), { text, action, disabled }, JSON.stringify(st));
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
  // green: Sign & run, then (after the first click) the hash and the cap, no typed name
  want({ ...base, session: true, phase: 'green' }, true, 'Sign & run', 'sign-prepare', false);
  want({ ...base, session: true, phase: 'green', busy: true }, true, 'Sign & run', 'sign-prepare', true);
  const signed = {
    ...base, session: true, phase: 'green', signClicked: true, hash: '7cc0122f0f3058b12a57', capUsd: 0.25,
  };
  want(signed, true, 'Sign 7cc0122f & run \u00b7 $0.25', 'sign', false); // no typed name: enabled at once
  want({ ...signed, busy: true }, false, 'Sign 7cc0122f & run \u00b7 $0.25', 'sign', true);
  want({ ...signed, capUsd: undefined }, false, 'Sign 7cc0122f & run', 'sign', false);
  // any other phase: nothing to click
  want({ ...base, session: true, phase: 'signed' }, true, 'Draft', 'none', true);
});

test('(a)(h) the gutter: plain `N` per step line, `~` per guardrail line, nothing on an empty line; inputs get a number per non-empty line', () => {
  const marks = load('gutterMarks');
  assert.deepEqual(marks('job', 'Read\n~rule\n~rule 2\n\nAsk: ok?\n  ~indented\nlast'), ['1', '~', '~', '', '2', '~', '3']);
  assert.deepEqual(marks('inputs', 'resume: /a\n\njd: /b\n'), ['1', '', '2', '']);
  assert.deepEqual(marks('job', ''), ['']);
  // the page's gutter and the server's parser agree on which line is a step (the server parser is the one that decides)
  assert.match(fnSrc('paintGutter'), /gutterMarks\(kind, ta\.value\)/);
  // amendment 3: no `>` anywhere in the marks, and the numbers start at the box's left edge (left-aligned, no wide right-aligned column)
  assert.doesNotMatch(fnSrc('gutterMarks'), />/);
  const gutCss = PAGE.match(/\.jf-gut\{[^}]*\}/)[0];
  assert.match(gutCss, /text-align:left/);
  assert.doesNotMatch(gutCss, /text-align:right/);
});

test('amendment 3 item 2: the Run id box is prefilled with the server\'s next name and an untouched box sends "" (the server claims)', () => {
  assert.match(fnSrc('paintRunFlow'), /autoRunId = f && f\.nextRunId \? f\.nextRunId : ""/);
  assert.match(fnSrc('currentRun'), /value\.trim\(\) === autoRunId \? ""/);
  assert.doesNotMatch(PAGE, /newRunIdText|toString\(36\)/);
});

test('(f) there is no typed name anywhere on the page: Sign is two clicks (no note box: amendment 14, test/m4e-revise-page.test.js)', () => {
  assert.doesNotMatch(PAGE, /typedName|Type the flow name/);
  assert.match(fnSrc('doSign'), /click 1[\s\S]*sign-prepare[\s\S]*click 2/);
});

test('(h) the main button label for a 0.25 cap and an 8-char hash is short enough for one line at 320px, and the CSS forbids wrapping', () => {
  const mb = load('mainButtonFor');
  const label = mb({ ...base, session: true, phase: 'green', signClicked: true, hash: '7cc0122f0f3058b12a57', capUsd: 0.25 }).text;
  assert.equal(label, 'Sign 7cc0122f & run \u00b7 $0.25');
  // measured in a browser at 320px (orchestrator walk): the button's content box is >= 250px, 13px monospace is ~8px a character
  assert.ok(label.length <= 31, `label is ${label.length} characters`);
  assert.match(PAGE, /#chat-main-btn\{white-space:nowrap;/);
});

test('field set: the New job card has exactly the signed boxes; bareloop-only boxes are gone; the card box is captioned Destination', () => {
  for (const id of ['jf-name', 'jf-job', 'jf-job-gut', 'jf-cap-money', 'jf-ask-wait', 'jf-dest-folder', 'jf-inputs', 'jf-inputs-gut', 'jf-run-flow', 'jf-run-cap', 'jf-run-left', 'jf-run-inputs', 'jf-run-id', 'chat-main-btn', 'chat-action-error', 'chat-card-error', 'chat-clear-btn']) {
    assert.ok(SECTION.includes(`id="${id}"`), `#${id} missing`);
  }
  const labels = [...SECTION.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
  for (const cap of ['Flow name', 'The job', 'Cap $', 'Ask wait', 'Destination', 'Inputs', 'New job', 'Run a signed flow']) assert.ok(labels.includes(cap), `caption "${cap}" missing`);
  assert.doesNotMatch(SECTION, />\s*Send to\s*</);
  for (const gone of ['jf-goal', 'jf-source', 'jf-success', 'jf-guardrails', 'jf-judge', 'jf-model', 'jf-verdict', 'jf-cap-time', 'startfrom', 'Check type', 'Time cap', 'Judge examples', 'Reuse']) {
    assert.ok(!SECTION.includes(gone), `${gone} must not be on the card`);
    assert.ok(!CHAT.replace(/^\s*\/\/.*$/gm, '').includes(gone), `${gone} must not be in the Chat script`);
  }
  assert.match(SECTION, /name="jf-mode" value="new" checked/);
  assert.match(SECTION, /Where the accepted result is placed/);
  assert.match(SECTION, /Only your click signs\./);
  // amendment 2 item 4: Flow name, The job, Destination, Inputs, then Cap $ with Ask wait (default 1h) in one row
  const at = (needle) => SECTION.indexOf(needle);
  assert.ok(at('id="jf-name"') < at('id="jf-job"') && at('id="jf-job"') < at('id="jf-dest-folder"') && at('id="jf-dest-folder"') < at('id="jf-inputs"') && at('id="jf-inputs"') < at('id="jf-cap-money"') && at('id="jf-cap-money"') < at('id="jf-ask-wait"'));
  assert.match(SECTION, /id="jf-ask-wait" type="text" value="1h"/);
  assert.doesNotMatch(SECTION, /jf-dest-line|jf-add-input/);
  assert.match(CHAT, /borrowed-from: bareloop src\/panel\/index\.html@ca7195e/);
  assert.match(PAGE, /--field-bg:#ffffff; --field-soft-bg:#f7f7f9;[\s\S]*--field-bg:#ffffff; --field-soft-bg:#f7f7f9;/, 'field tokens in both light blocks');
  assert.match(PAGE, /--field-bg:var\(--bg\); --field-soft-bg:var\(--bg\); --field-border:var\(--text-dim\);/, 'and the dark default');
});

test('#chat-action-error is written only by the click handlers: the poll path never touches it', () => {
  const writers = [...CHAT.matchAll(/actionErrEl\.textContent\s*=/g)].length;
  // chatActionFailed, chatActionOk, openNewCard (a click's reset), the Resume form's Cancel click,
  // dropFixBoxesBanner (the human's own edit clearing the last marked box)
  assert.equal(writers, 5, 'only five places may write the action line (the last two: Cancel of the Resume form, an edit that clears the last marked box)');
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
  const steps = new Function(`${fnSrc('plainPlanCheck')}\n${fnSrc('failedDetails')}\n${fnSrc('stepsFor')}\nreturn stepsFor;`)();
  const waiting = steps({ phase: 'green', card: { capUsd: 0.25 } }, { model: 'm', starting: false, signClicked: false });
  assert.deepEqual(waiting.map((s) => [s.id, s.status]), [['drafted', 'done'], ['sign', 'waiting']]);
  const drafting = steps({ phase: 'drafting', card: { capUsd: '0.25' } }, { model: 'deepseek-flash', starting: false });
  assert.deepEqual(drafting, [{ id: 'drafting', label: 'drafting with deepseek-flash, run cap $0.25', status: 'running', details: [] }]);
  const red = steps({ phase: 'red', reds: ['a', 'b'] }, { model: 'm', starting: false });
  assert.deepEqual(red[1].raw, ['a', 'b'], 'am41 item 7: the raw texts ride along; details are the plain sentences');
  assert.equal(red[1].details.length, 2);
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

test('the Chat tab keeps the page rules: no token on the page, every POST goes through postJSON, the only POSTs are the author doors', () => {
  const code = CHAT.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bTOKEN\b|x-fwdloop-token/);
  assert.doesNotMatch(code, /\bfetch\([^)]*POST/);
  const paths = [...code.matchAll(/authorPost\(\s*"([^"]+)"/g)].map((m) => m[1]).filter((x) => !x.endsWith('/')).sort();
  assert.deepEqual(paths, ['/api/author/draft', '/api/author/resume', '/api/author/resume-prepare', '/api/author/run', '/api/author/run', '/api/author/run-prepare']);
  assert.match(code, /authorPost\("\/api\/author\/" \+ id \+ "\/sign-prepare"/);
  assert.match(code, /authorPost\("\/api\/author\/" \+ id \+ "\/sign", \{hash: signInfo\.hash\}/);
  assert.match(code, /authorPost\("\/api\/author\/" \+ id \+ "\/abandon"/);
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

test('re-attach restores every new field (job, destination, inputs, cap, ask wait) and the POST body carries exactly the new shape', () => {
  const at = fnSrc('attachSession');
  for (const id of ['jf-name', 'jf-job', 'jf-cap-money', 'jf-dest-folder', 'jf-inputs', 'jf-ask-wait']) assert.match(at, new RegExp(`setVal\\("${id}"`), id);
  assert.match(fnSrc('currentCard'), /flowName:[\s\S]*job: jobEl\.value,[\s\S]*destination: destEl\.value\.trim\(\),[\s\S]*inputs: inputsBox\.value,[\s\S]*capUsd:[\s\S]*askWait: askWaitEl\.value\.trim\(\)/);
  assert.match(fnSrc('resetCard'), /askWaitEl\.value = "1h"/, 'a cleared card goes back to the default wait');
});

test('hamr 2026-10-06: a load or refresh opens the LEFT side on the Chat tab — the load-time /api/runs handler never clicks the Runs tab', () => {
  const start = PAGE.indexOf('getJSON("/api/runs").then(function(result){');
  assert.ok(start !== -1, 'the load-time handler is there');
  const handler = PAGE.slice(start, PAGE.indexOf('}).catch(function(e){', start));
  assert.doesNotMatch(handler.replace(/^\s*\/\/.*$/gm, ''), /getElementById\("tab-runs"\)\.click\(\)/);
  assert.match(handler, /selectRun\(first\.flow, first\.runId/, 'the right side still opens the newest run');
  assert.match(PAGE, /<button role="tab" id="tab-chat"[^>]*aria-selected="true"/, 'Chat is the tab selected in the markup');
  assert.match(PAGE, /id="panel-chat" class="tabpanel active"/);
});

test('walk fix 2: the "Fix the marked boxes" banner goes when the last marked box clears; any other refusal sentence stays', () => {
  const SAY = 'Not started. Fix the marked boxes. Nothing spent.';
  const mk = (banner, boxes) => {
    const actionErrEl = { textContent: banner };
    const card = { querySelectorAll: () => boxes };
    const fn = new Function('actionErrEl', 'card', 'FIX_BOXES_SAY', `${fnSrc('dropFixBoxesBanner')}\nreturn dropFixBoxesBanner;`)(actionErrEl, card, SAY);
    return { actionErrEl, fn };
  };
  const still = mk(SAY, [{ textContent: '' }, { textContent: 'Cap is too low.' }]);
  still.fn();
  assert.equal(still.actionErrEl.textContent, SAY, 'a marked box still has its refusal: the banner stays');
  const cleared = mk(SAY, [{ textContent: '' }, { textContent: '' }]);
  cleared.fn();
  assert.equal(cleared.actionErrEl.textContent, '', 'no marked box left: the banner is gone');
  const other = mk('A run is already live.', [{ textContent: '' }]);
  other.fn();
  assert.equal(other.actionErrEl.textContent, 'A run is already live.', 'a refusal with no box is not this banner');
  assert.match(CHAT, /x\.textContent = ""; \}\);\n\s+dropFixBoxesBanner\(\);/, 'the per-box clear on input calls it');
});
