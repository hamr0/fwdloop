// M4b piece 4: the page's answer-door logic, run for real. The page is one
// inline script, so each pure function is cut out of src/panel/index.html by
// name and executed (same technique as the auditTimeCellHtml test in
// panel.test.js). Source tests cannot see rendering; the visual walk is a
// separate step (scripts/panel-fixtures/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');

/** Cut `function name(` .. its closing "\n  }" out of the page. */
function fnSrc(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in index.html`);
  const end = source.indexOf('\n  }', start);
  return source.slice(start, end + 4);
}
const load = (names, ret) => new Function(`${names.map(fnSrc).join('\n')}\nreturn ${ret};`)();

const answerControls = load(['answerControls'], 'answerControls');
const liveOutcome = load(['liveOutcome'], 'liveOutcome');
const refusalText = load(['refusalText'], 'refusalText');

const openAsk = { askId: 'a1', open: true, status: 'unanswered' };

test('doors: an open ask with no saved answer gets the three doors', () => {
  assert.deepEqual(answerControls(openAsk, null), { kind: 'doors' });
  // a resume record for a DIFFERENT (older) ask does not hide the new ask's doors.
  assert.deepEqual(answerControls(openAsk, { askId: 'a0', state: 'took-over', label: 'resume took over the answer' }), { kind: 'doors' });
});

test('doors: a saved answer for this ask (resume starting) shows NO doors and says why', () => {
  const r = answerControls(openAsk, { askId: 'a1', state: 'starting', label: 'answer saved, resume starting' });
  assert.equal(r.kind, 'starting');
  assert.match(r.why, /already has a saved answer/);
});

test('doors: resume not-started shows the stuck state with the reason verbatim (try-again only, no doors)', () => {
  const reason = 'resume: run "run-1" is locked by another resumer';
  const r = answerControls(openAsk, { askId: 'a1', state: 'not-started', label: 'answer saved, resume not started', reason });
  assert.equal(r.kind, 'stuck');
  assert.equal(r.reason, reason);
  assert.equal(r.label, 'answer saved, resume not started');
});

test('doors: no ask / a closed ask -> no controls, with the reason stated', () => {
  const none = answerControls(null, null);
  assert.equal(none.kind, 'none');
  assert.match(none.why, /nothing left to answer/);
  const closed = answerControls({ askId: 'a1', open: false, status: 'accepted' }, null);
  assert.equal(closed.kind, 'none');
  assert.match(closed.why, /this ask is accepted/);
  const expired = answerControls({ askId: 'a1', open: false, status: 'expired' }, null);
  assert.match(expired.why, /this ask is expired/);
});

test('doors: try-again is offered ONLY for not-started (never for doors/starting/none)', () => {
  const kinds = [
    answerControls(openAsk, null),
    answerControls(openAsk, { askId: 'a1', state: 'starting', label: 'x' }),
    answerControls(openAsk, { askId: 'a1', state: 'took-over', label: 'x' }),
    answerControls({ askId: 'a1', open: false, status: 'redo' }, null),
  ].map((r) => r.kind);
  assert.ok(!kinds.includes('stuck'), `stuck must be only for not-started, got ${kinds}`);
});

test('refusals: shown by name with the HTTP status; a library red is verbatim; a plain-text 405 body is shown too', () => {
  assert.equal(refusalText({ status: 409, body: { ok: false, refused: 'library', red: 'answerAsk: askId "x" is unknown for run /r' }, text: '' }),
    'HTTP 409 — answerAsk: askId "x" is unknown for run /r');
  assert.equal(refusalText({ status: 403, body: { red: 'token-missing-or-wrong' }, text: '' }), 'HTTP 403 — token-missing-or-wrong');
  assert.equal(refusalText({ status: 405, body: null, text: 'method not allowed' }), 'HTTP 405 — method not allowed');
});

test('live: outcomes are read from the books — stuck stops quietly, a new open ask / ✓ / ✗ / rerun end the watch, anything else keeps waiting', () => {
  const asks = (list, resume) => ({ asks: list, resume });
  // stuck: stop, say nothing (the stuck block shows the reason)
  assert.deepEqual(liveOutcome('a1', { glyph: '[·]' }, asks([openAsk], { state: 'not-started' })), { done: true, cls: null, text: null });
  // re-parked: a DIFFERENT open ask
  const reparked = liveOutcome('a1', { glyph: '[·]', label: 'waiting on you' }, asks([{ askId: 'a1', open: false }, { askId: 'a2', open: true, waiting: true }], null));
  assert.equal(reparked.done, true);
  assert.match(reparked.text, /new ask/);
  // the message renders BELOW the doors, so it must not say they are below
  assert.match(reparked.text, /doors above are for it/);
  assert.doesNotMatch(reparked.text, /below/);
  // the SAME ask still open is not "re-parked"
  assert.equal(liveOutcome('a1', { glyph: '[·]', label: 'l' }, asks([openAsk], { state: 'starting', label: 'answer saved, resume starting' })).done, false);
  assert.match(liveOutcome('a1', { glyph: '[✓]' }, asks([], null)).text, /finished \[✓\]/);
  assert.match(liveOutcome('a1', { glyph: '[✗]', label: 'failed (red)' }, asks([], null)).text, /ended \[✗\] failed \(red\)/);
  assert.match(liveOutcome('a1', { glyph: '[✗]', label: 'stopped by you', outcome: 'rerun' }, asks([], null)).text, /fresh run was started/);
  const waiting = liveOutcome('a1', { glyph: '[?]', label: 'running or died: unknown' }, asks([{ askId: 'a1', open: false }], { state: 'took-over', label: 'resume took over the answer' }));
  assert.equal(waiting.done, false);
  assert.match(waiting.text, /resume took over the answer/);
});

test('inbox row: a saved-unconsumed answer says its resume label in words, never a "time left" countdown', () => {
  const stopStatusLine = new Function('duration', 'readableDateTime', `${fnSrc('stopStatusLine')}\nreturn stopStatusLine;`)(
    (ms) => `${ms}ms`, (x) => x,
  );
  const waiting = { open: true, waiting: true, timeLeftMs: 1500, status: 'unanswered', resume: null };
  assert.equal(stopStatusLine(waiting), 'time left: 1500ms');
  const saved = {
    open: true, waiting: false, timeLeftMs: null, status: 'unanswered', resume: { label: 'answer saved, resume not started' },
  };
  assert.equal(stopStatusLine(saved), 'answer saved, resume not started');
});

test('liveOutcome: the watch-stop for a rerun-ended run reads the typed outcome, never the label text', () => {
  const asks = (list, resume) => ({ asks: list, resume });
  const rerun = liveOutcome('a1', { glyph: '[✗]', label: 'anything at all', outcome: 'rerun' }, asks([], null));
  assert.equal(rerun.done, true);
  assert.match(rerun.text, /fresh run was started/);
  // a label that says "(rerun)" but whose typed outcome is not rerun is not a rerun
  assert.doesNotMatch(liveOutcome('a1', { glyph: '[✗]', label: 'failed (rerun)', outcome: 'red' }, asks([], null)).text, /fresh run was started/);
  const parked = liveOutcome('a1', { glyph: '[·]', label: 'waiting', outcome: null }, asks([openAsk], null));
  assert.equal(parked.done, false);
  const passed = liveOutcome('a1', { glyph: '[✓]', label: 'passed', outcome: 'complete' }, asks([], null));
  assert.doesNotMatch(passed.text, /fresh run was started/);
  const red = liveOutcome('a1', { glyph: '[✗]', label: 'failed (red)', outcome: 'red' }, asks([], null));
  assert.doesNotMatch(red.text, /fresh run was started/);
});
