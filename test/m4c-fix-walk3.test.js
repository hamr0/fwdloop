// hamr's 2026-10-03/04 panel walk, issue by issue. $0: the CLI's fake model step, the real data readers, and the
// page's own functions cut out by name. Each test names its issue and was run red with that issue's src change taken out.

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { getRunAsks, listStops } from '../src/panel/data.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const LOADED = loadCatalogue();
const CAT = LOADED.primitives;
const page = readFileSync(path.join(REPO, 'src', 'panel', 'index.html'), 'utf8');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE, DEEPSEEK_API_KEY: 'test-key-not-real' };
const WAIT = 1_800_000;
const ROOTS = [];
after(() => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });
const cliRaw = (args) => spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 30_000 });

function fnSrc(name) {
  const start = page.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return page.slice(start, page.indexOf('\n  }', start) + 4);
}

/** job2 with the given run ids parked at the ask. */
function parked(tag, runIds) {
  const root = mkdtempSync(path.join(tmpdir(), `fwdloop-walk3-${tag}-`));
  ROOTS.push(root);
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CAT,
  });
  assert.equal(w.ok, true);
  const src = mkdtempSync(path.join(tmpdir(), `fwdloop-walk3-${tag}-src-`));
  ROOTS.push(src);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const askIds = {};
  for (const runId of runIds) {
    const r = cliRaw(['run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', runId]);
    assert.equal(r.status, 0, r.stderr);
    askIds[runId] = /askId=(\S+)/.exec(r.stdout)[1];
  }
  return { root, askIds, runDir: (id) => path.join(root, 'job2', 'runs', id) };
}
function expire(world, runId) {
  const runDir = world.runDir(runId);
  const t0 = Date.now() - 2 * 3600_000;
  const askedAt = new Date(t0).toISOString();
  const expiresAt = new Date(t0 + WAIT).toISOString();
  for (const f of [path.join(runDir, 'ask.json'), path.join(runDir, 'asks', `${world.askIds[runId]}.json`), path.join(runDir, 'state.json')]) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.expiresAt = expiresAt;
    if ('askedAt' in j) j.askedAt = askedAt;
    writeFileSync(f, JSON.stringify(j));
  }
}

// ---- issue 1: a run ended by expiry --------------------------------------------------------------------
test('issue 1: a run ended because its ask expired reads expired in the Ask tab and the Inbox — never "accepted" — and offers no door', () => {
  const w = parked('i1', ['run-ended-expired', 'run-done']);
  // control: a run that really completed on an accepted answer keeps the word "accepted"
  assert.equal(cliRaw(['answer', w.askIds['run-done'], 'accept', '--root', w.root]).status, 0);
  assert.equal(cliRaw(['resume', 'run-done', '--flow', 'job2', '--root', w.root]).status, 0);
  // the late answer: saved after the deadline, then the terminal resume ends the run `ask-expired`
  expire(w, 'run-ended-expired');
  writeFileSync(path.join(w.runDir('run-ended-expired'), 'answer.json'), JSON.stringify({ askId: w.askIds['run-ended-expired'], decision: 'accept', answeredAt: new Date().toISOString() }));
  assert.match(cliRaw(['resume', 'run-ended-expired', '--flow', 'job2', '--root', w.root]).stderr, /ask-expired/);

  const asks = getRunAsks({ root: w.root, flow: 'job2', runId: 'run-ended-expired', catalogue: CAT });
  const a = asks.asks[0];
  assert.equal(a.status, 'expired');
  assert.equal(a.why, 'Your answer came after the deadline.');
  assert.equal(a.open, false);
  assert.equal(a.reopen, null, 'an ended run is never offered a reopen');
  assert.equal(asks.blocks[0].answers[0].decision, 'expired', 'the answers-so-far line does not say accept for a refused answer');
  const stop = listStops({ root: w.root }).find((r) => r.runId === 'run-ended-expired');
  assert.equal(stop.status, 'expired');
  assert.equal(stop.section, 3);
  assert.equal(stop.waiting, false);
  assert.equal(listStops({ root: w.root }).find((r) => r.runId === 'run-done').status, 'accepted');
});

test('issue 1: every Ask block names its flow and run; an ended ask gets no answer door from the page', () => {
  const meta = new Function(`${fnSrc('blockMetaText')} return blockMetaText;`)();
  const text = meta({
    stepName: 'resume-summary-approved', stepLine: 4, draftNo: 1, current: { askedAt: null, waiting: false, open: false, status: 'expired' },
  }, { flow: 'job2', runId: 'run-ended-expired' });
  assert.match(text, /^job2 \(run-ended-expired\) · /);
  const controls = new Function('pending', `${fnSrc('answerControls')} return answerControls;`)()(
    { askId: 'a1', open: false, reopen: null, status: 'expired' }, null, null);
  assert.equal(controls.kind, 'none');
});

// ---- a tiny fake DOM, enough to render the answer block and read what the human would read ----------------
function fakeDoc() {
  const mk = () => ({
    className: '', children: [], attrs: {}, textContent: '', hidden: false, disabled: false, listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { this.listeners[t] = f; },
    createTextNode: undefined,
  });
  return { createElement: mk, createTextNode: (t) => ({ textContent: t, children: [] }) };
}
const flat = (e) => [e, ...(e.children ?? []).flatMap(flat)];
function renderBlock(ask, resume, extra = '') {
  const scope = new Function('document', 'setTimeout', `
    var pendingAnswer = null, reasonDrafts = {}; function paintAnswerMsg(){} function sendAnswer(){} function sendResumeAgain(){} function sendReopen(){}
    function duration(ms){ return ms + "ms"; }
    ${['textDiv', 'waitText', 'pendingText', 'answerControls', 'makeButton', 'renderAnswerBlock'].map(fnSrc).join('\n')}
    ${extra}
    return renderAnswerBlock;
  `)(fakeDoc(), () => {});
  const root = scope(ask, { flow: 'job2', runId: 'r1', resume, draftNo: 1 });
  const nodes = flat(root);
  return {
    buttons: nodes.filter((n) => n.attrs['data-testid'] && /^btn-/.test(n.attrs['data-testid'])).map((n) => n.textContent),
    lines: nodes.filter((n) => n.className === 'hint' || /answer-msg/.test(n.className)).map((n) => n.textContent).filter(Boolean),
  };
}

// ---- issue 2: plain words for expired and stuck ----------------------------------------------------------
test('issue 2: an expired ask is one button and one short line — nobody answered / the answer came late', () => {
  const none = renderBlock({ askId: 'a', open: false, status: 'expired', reopen: { waitMs: WAIT, late: false, why: 'Nobody answered in time.' } }, null);
  assert.deepEqual(none.buttons, ['Reopen for another 30 min']);
  assert.deepEqual(none.lines, ['Nobody answered in time.']);
  const late = renderBlock({ askId: 'a', open: false, status: 'expired', reopen: { waitMs: WAIT, late: true, why: 'Your answer came after the deadline.' } }, null);
  assert.deepEqual(late.buttons, ['Reopen for another 30 min']);
  assert.deepEqual(late.lines, ['Your answer came after the deadline.']);
});

test('issue 2: a stuck run is one button "Continue the run" and one line saying why; a lock with no holder offers Remove the old lock, never a path', () => {
  const open = { askId: 'a', open: true, status: 'unanswered' };
  const stuck = renderBlock(open, { askId: 'a', state: 'not-started', label: 'x', reason: 'reason unknown: the panel restarted, so it has no record of the resume attempt' });
  assert.deepEqual(stuck.buttons, ['Continue the run']);
  assert.deepEqual(stuck.lines, ['Your answer is saved; the run stopped before using it.']);
  const lock = renderBlock(open, { askId: 'a', state: 'not-started', label: 'x', lockPath: '/r/job2/runs/r1/resume.lock' });
  assert.deepEqual(lock.buttons, ['Remove the old lock']);
  assert.deepEqual(lock.lines, ['An old resume lock is in the way.']);
  const all = JSON.stringify([stuck, lock]);
  assert.doesNotMatch(all, /Try the resume again|reason unknown|panel restarted|no answer doors/i);
});

test('issue 2: the data says whether the expired ask had a late answer saved (late), and the stuck labels are plain', async () => {
  const w = parked('i2', ['r-late', 'r-none']);
  expire(w, 'r-late');
  expire(w, 'r-none');
  writeFileSync(path.join(w.runDir('r-late'), 'answer.json'), JSON.stringify({ askId: w.askIds['r-late'], decision: 'accept', answeredAt: new Date().toISOString() }));
  const reopenOf = (id) => getRunAsks({ root: w.root, flow: 'job2', runId: id, catalogue: CAT }).asks[0].reopen;
  assert.deepEqual(reopenOf('r-late'), { waitMs: WAIT, late: true, why: 'Your answer came after the deadline.' });
  assert.deepEqual(reopenOf('r-none'), { waitMs: WAIT, late: false, why: 'Nobody answered in time.' });
  const d = await import('../src/panel/data.js');
  assert.equal(d.STUCK_LABEL, 'stuck — your answer is saved; the run stopped before using it');
  assert.equal(d.STUCK_LOCK_LABEL, 'stuck — an old resume lock is in the way');
});

// ---- issue 3: a blank reason is caught on the page; every refusal reads as a plain sentence -----------------
function clickScope(post) {
  const calls = { posts: 0, said: [] };
  const scope = new Function('post', 'calls', `
    var answerMsg = null, reasonDrafts = {}, pendingAnswer = null;
    function paintAnswerMsg(){}
    function say(f, r, cls, text){ calls.said.push(cls + ":" + text); }
    function postJSON(){ calls.posts++; return post(); }
    function startLive(){} function reloadRun(){ return Promise.resolve(); } function setBusy(){}
    ${['refusalText', 'reasonMissing', 'blankReasonText', 'networkText', 'sendAnswer'].map(fnSrc).join('\n')}
    return sendAnswer;
  `)(post, calls);
  return { send: scope, calls };
}
const boxRoot = (value, hint) => ({ querySelector: (sel) => (/reason-hint/.test(sel) ? hint : { value }), isConnected: false });
const flush = () => new Promise((r) => { setTimeout(r, 0); });
const ASK = { askId: 'a1' };
const CTX = { flow: 'job2', runId: 'r1', draftNo: 1, resume: null };

test('issue 3: redo or rerun with an empty reason shows "Please write a reason for the redo." next to the box and sends nothing', async () => {
  for (const [decision, word] of [['redo', 'redo'], ['rerun', 'rerun']]) {
    for (const blank of ['', '   \n']) {
      const { send, calls } = clickScope(async () => ({ status: 202, body: { ok: true }, text: '' }));
      const hint = { hidden: true, textContent: '' };
      send(boxRoot(blank, hint), ASK, CTX, decision);
      await flush();
      assert.equal(calls.posts, 0, `${decision} with a blank reason must not be sent`);
      assert.equal(hint.textContent, `Please write a reason for the ${word}.`);
      assert.equal(hint.hidden, false);
    }
  }
  // controls: accept needs no reason; a reason sends
  const ok = clickScope(async () => ({ status: 202, body: { ok: true }, text: '' }));
  ok.send(boxRoot('', { hidden: true, textContent: '' }), ASK, CTX, 'accept');
  ok.send(boxRoot('shorter', { hidden: true, textContent: '' }), ASK, CTX, 'redo');
  await flush();
  assert.equal(ok.calls.posts, 2);
  // the page renders the hint element next to the box
  assert.match(page, /reasonHint\.setAttribute\("data-testid", "reason-hint"\)/);
});

test('issue 3: no refusal the page can show contains an HTTP status, a refusal code, an askId or a path', async () => {
  const id = '2a73404e-8e11-4e19-a6ce-afce20bcab3a';
  const run = '/home/x/flows/job2/runs/r1';
  const library = [
    `answerAsk: askId "${id}" needs a non-blank reason to redo`, `answerAsk: askId "${id}" expired at 2026-10-04T07:14:07.572Z for run ${run}`,
    `answerAsk: askId "${id}" already answered for run ${run}`, `answerAsk: askId "${id}" is unknown for run ${run}`, `answerAsk: no open ask for run ${run}`,
    'answerAsk: unrecognised decision "x"', `answerAsk: askId "${id}" cannot be accepted — ask.json carries no readable artifact (evidence.artifact) to hash for run ${run}`,
    `answerAsk: could not write ${run}/answer.json — EACCES`, `answerAsk: askId "${id}" — a broken saved answer (x) is in the way — answer.json could not be set aside — y`,
    `reopenAsk: askId "${id}" has not expired (it runs until 2026-10-04T08:00:00Z)`, `reopenAsk: askId "${id}" has an answer saved in time — resume it, it is not expired`,
    `reopenAsk: askId "${id}" was already reopened (record 1 exists)`, `reopenAsk: no open ask for run ${run}`, `reopenAsk: askId "${id}" is unknown for run ${run}`,
    `reopenAsk: askId "${id}" already answered for run ${run}`, `reopenAsk: could not write the reopen record — EACCES`, 'something nobody planned for',
  ];
  const named = ['already-resuming', 'no-saved-answer', 'run-ended', 'flow-outside-root', 'bad-flow', 'bad-runId', 'askid-required', 'body-not-json', 'body-too-large',
    'origin-not-own', 'host-not-own-address', 'internal'];
  const refusalText = new Function(`${['refusalText', 'blankReasonText'].map(fnSrc).join('\n')} return refusalText;`)();
  const bodies = [
    ...library.map((red) => ({ status: 409, body: { ok: false, refused: 'library', red } })),
    ...named.map((refused) => ({ status: 409, body: { ok: false, refused, red: `${refused}: ${id} at ${run}` } })),
    { status: 500, body: null, text: 'Internal Server Error' }, { status: 405, body: null, text: 'method not allowed' }, { status: 0, body: undefined },
  ];
  for (const r of bodies) {
    const t = refusalText(r, 'redo');
    assert.doesNotMatch(t, /HTTP|\b[1-5]\d\d\b|askId|[0-9a-f]{8}-[0-9a-f]{4}|\/home|answerAsk|reopenAsk|[a-z]+-[a-z]+: /, `${JSON.stringify(r.body)} -> ${t}`);
    assert.match(t, /^[A-Z].*[.]$/, `a sentence: ${t}`);
  }
  assert.equal(refusalText({ status: 409, body: { refused: 'library', red: `answerAsk: askId "${id}" needs a non-blank reason to redo` } }, 'redo'), 'Please write a reason for the redo.');
  // the fetch itself failing (network) is plain too
  const { send, calls } = clickScope(async () => { throw new Error('fetch failed'); });
  send(boxRoot('x', { hidden: true, textContent: '' }), ASK, CTX, 'redo');
  await flush();
  assert.ok(calls.said.every((l) => !/fetch failed|network failure/.test(l)), calls.said.join('|'));
  assert.match(calls.said.at(-1), /^refused:Could not reach the panel/);
});
