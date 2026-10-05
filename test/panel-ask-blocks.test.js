// M4c piece 3 (docs/wiki/the-module-ladder.md, "M4c — the answers read clearly", scope 5-7,
// negatives vi, vii, viii): the Ask tab shows ONE block per signed ask line, "draft N", the
// earlier answers as lines; a click hides the doors and says what is happening; a periodic
// refresh never redraws over a typed reason or a refusal. $0: the CLI's fake model step.
// The page is one inline script, so its functions are cut out by name and executed (same
// technique as panel-doors.test.js); the rendered look is a separate real-browser walk.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, readdirSync, statSync, renameSync, rmSync, existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { getRunAsks, getRunDetail, groupAskBlocks } from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const page = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');

const loaded = loadCatalogue();
assert.equal(loaded.ok, true);
const CATALOGUE = loaded.primitives;

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-askblocks-${p}-`));
const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE };
function cli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, `fwdloop ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** job2 via the real CLI, parked once at its ask. */
function parkedJob2(tag) {
  const root = tmp(tag);
  const w = writeFlow({
    root, name: 'job2', proseText: fixture('job2-with-sources.signed.txt'), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true);
  const src = tmp(`${tag}-src`);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const out = cli(['run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'run-1']);
  return { root, runDir: path.join(root, 'job2', 'runs', 'run-1'), askId: /askId=(\S+)/.exec(out)[1] };
}
const redo = (root, askId, reason) => {
  cli(['answer', askId, 'redo', reason, '--root', root]);
  return /askId=(\S+)/.exec(cli(['resume', 'run-1', '--flow', 'job2', '--root', root]))[1];
};
const asksOf = (root) => getRunAsks({ root, flow: 'job2', runId: 'run-1', catalogue: CATALOGUE });

// ---- (vi) three redos, parked a 4th time ----------------------------------------------------
test('(vi) after three redos: ONE block, "draft 4", three answer lines (redo + each reason); the page never says "Ask 1 of"', () => {
  const { root, askId } = parkedJob2('vi');
  let id = askId;
  for (const reason of ['too long', 'wrong tone', 'missing skills']) id = redo(root, id, reason);
  const res = asksOf(root);
  assert.equal(res.blocks.length, 1, JSON.stringify(res.blocks.map((b) => b.key)));
  const [b] = res.blocks;
  assert.equal(b.draftNo, 4);
  assert.equal(b.current.askId, id);
  assert.equal(b.current.waiting, true);
  assert.deepEqual(b.answers.map((a) => [a.draft, a.decision, a.reason]), [[1, 'redo', 'too long'], [2, 'redo', 'wrong tone'], [3, 'redo', 'missing skills']]);
  assert.ok(b.answers.every((a) => typeof a.answeredAt === 'string'));
  assert.equal(b.question, 'check it with me,');
  assert.equal(b.stepName, 'resume-summary-approved');
  // the page itself: the words are gone everywhere (markup, script, comments)
  assert.doesNotMatch(page, /Ask \d+ of|Ask i of|of 2\b/);
});

test('(vi) the grouping key is the archive\'s recorded emits: with the audit rows gone (no positional pairing possible) the block is still one', () => {
  const { root, runDir, askId } = parkedJob2('vi-emits');
  redo(root, askId, 'again');
  rmSync(path.join(runDir, 'audit.jsonl'));
  const res = asksOf(root);
  assert.equal(res.blocks.length, 1);
  assert.equal(res.blocks[0].draftNo, 2);
  assert.equal(res.blocks[0].stepName, 'resume-summary-approved');
});

// ---- two ask lines -> two blocks -----------------------------------------------------------------
test('a flow with two ask lines shows two blocks, each titled with its own question', async () => {
  const TWO = fixture('job2-with-sources.signed.txt')
    .replace('5. and once I accept, write it out.', '5. ask: one more look before it goes,\n6. and once I accept, write it out.')
    .replace('send at line 5', 'send at line 6');
  assert.ok(TWO.includes('5. ask: one more look'));
  const declaration = JSON.parse(fixture('job2.m1.declaration.json'));
  const send = declaration.steps.pop();
  send.fromLine = 6;
  send.reads = ['resume-summary-approved'];
  declaration.steps.push({
    goal: 'Show the summary again and pause until the human accepts it a second time; nothing is written out before that.',
    primitives: [],
    reads: ['resume-summary-approved'],
    emits: 'resume-summary-final',
    fromLine: 5,
    close: { class: 'hitl' },
  }, send);
  const root = tmp('two');
  assert.equal(writeFlow({
    root, name: 'job2', proseText: TWO, declaration, signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
  }).ok, true);
  const src = tmp('two-src');
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const summary = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
  const modelStep = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    return { ok: true, costUsd: 0.001, artifact: { text: summary, done: true } };
  };
  const args = {
    root, name: 'job2', runId: 'run-1', catalogue: CATALOGUE, modelStep, primitives: {}, businessDate: '2026-06-01',
  };
  const p1 = await runFlow({
    ...args, askStep: makeParkingAskStep(), sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }],
  });
  assert.equal(p1.outcome, 'paused', p1.red);
  assert.equal(answerAsk({ runDir: p1.runDir, askId: p1.askId, decision: 'accept' }).ok, true);
  const p2 = await resumeRun(args);
  assert.equal(p2.outcome, 'paused', p2.red);
  const res = asksOf(root);
  assert.equal(res.blocks.length, 2);
  assert.deepEqual(res.blocks.map((b) => b.question), ['check it with me,', 'one more look before it goes,']);
  assert.deepEqual(res.blocks.map((b) => b.draftNo), [1, 1]);
  assert.deepEqual(res.blocks.map((b) => b.answers.map((a) => a.decision)), [['accept'], []]);
});

// ---- old `reject` file reads as redo ------------------------------------------------------------
test('an old "reject" consumed file renders as redo in the answers list', () => {
  const { root, runDir, askId } = parkedJob2('reject');
  const nextId = redo(root, askId, 'old-style');
  const f = path.join(runDir, `answer.${askId}.consumed.json`);
  const j = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(j.decision, 'redo');
  writeFileSync(f, JSON.stringify({ ...j, decision: 'reject' }));
  const [b] = asksOf(root).blocks;
  assert.equal(b.current.askId, nextId);
  assert.deepEqual(b.answers.map((a) => [a.decision, a.reason]), [['redo', 'old-style']]);
});

// ---- (viii) a pre-M4c run renders, nothing rewritten ---------------------------------------------
function hashTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[path.relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

test('(viii) a pre-M4c run (no pids.jsonl, and a pre-M4a-1 one with no asks/ archive) still renders, and none of its files is rewritten', () => {
  const { root, runDir, askId } = parkedJob2('viii');
  redo(root, askId, 'before m4c');
  rmSync(path.join(runDir, 'pids.jsonl'), { force: true });
  assert.equal(existsSync(path.join(runDir, 'pids.jsonl')), false);
  const before = hashTree(root);
  const res = asksOf(root);
  assert.equal(res.blocks.length, 1);
  assert.equal(res.blocks[0].draftNo, 2);
  assert.ok(getRunDetail({ root, flow: 'job2', runId: 'run-1', catalogue: CATALOGUE }));
  assert.deepEqual(hashTree(root), before);
  // pre-M4a-1: no asks/ archive at all — the consumed answers still make blocks, nothing crashes
  renameSync(path.join(runDir, 'asks'), path.join(runDir, 'asks-gone'));
  const before2 = hashTree(root);
  const legacy = asksOf(root);
  assert.ok(legacy.blocks.length >= 1);
  assert.ok(legacy.blocks.every((b) => typeof b.draftNo === 'number' && Array.isArray(b.answers)));
  assert.deepEqual(hashTree(root), before2);
});

test('groupAskBlocks: an expired earlier draft is a line too; the open newest draft is not', () => {
  const mk = (askId, status, extra = {}) => ({
    askId, emits: 's', status, open: status === 'unanswered', question: 'q?', reason: null, answeredAt: null, ...extra,
  });
  const [b] = groupAskBlocks([mk('a', 'expired'), mk('b', 'redo', { reason: 'r', answeredAt: '2026-09-30T10:00:00Z' }), mk('c', 'unanswered')]);
  assert.equal(b.draftNo, 3);
  assert.deepEqual(b.answers.map((a) => [a.draft, a.decision]), [[1, 'expired'], [2, 'redo']]);
});

// ---- page functions, cut out by name and run ---------------------------------------------------
function fnSrc(name) {
  const start = page.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return page.slice(start, page.indexOf('\n  }', start) + 4);
}
/** The click path (sendAnswer) with its collaborators stubbed; `post` decides the HTTP answer. */
function clickHarness(post) {
  const calls = { live: [], said: [], reload: 0 };
  const scope = new Function('post', 'calls', `
    var answerMsg = null, reasonDrafts = {}, pendingAnswer = null;
    function paintAnswerMsg(){}
    function say(f, r, cls, text){ answerMsg = { flow: f, runId: r, cls: cls, text: text }; calls.said.push(cls + ":" + text); }
    function postJSON(){ return post(); }
    function startLive(f, r, a){ calls.live.push(a); }
    function reloadRun(){ calls.reload++; return Promise.resolve(); }
    function setBusy(){}
    ${['pendingText', 'answerControls', 'refusalText', 'reasonMissing', 'blankReasonText', 'networkText', 'sendAnswer', 'sayLive', 'holdAskRender'].map(fnSrc).join('\n')}
    return { sendAnswer: sendAnswer, answerControls: answerControls, sayLive: sayLive, holdAskRender: holdAskRender,
      get pending(){ return pendingAnswer; }, get msg(){ return answerMsg; }, say: say };
  `)(post, calls);
  return { scope, calls };
}
const fakeRoot = { querySelector: () => ({ value: 'make it shorter' }), isConnected: false };
const flush = () => new Promise((r) => { setTimeout(r, 0); });
const ask = { askId: 'a1', open: true, waiting: true, status: 'unanswered' };
const ctx = { flow: 'job2', runId: 'run-1', draftNo: 1, resume: null };

test('item 6: a 202 hides the doors and names what is happening, per decision; the watch is started', async () => {
  for (const [decision, text] of [['redo', 'working on your redo… draft 2 is coming'], ['accept', 'shipping draft 1…'], ['rerun', 'ending this run, starting a fresh one…']]) {
    const { scope, calls } = clickHarness(async () => ({ status: 202, body: { ok: true }, text: '' }));
    scope.sendAnswer(fakeRoot, ask, ctx, decision);
    await flush();
    const model = scope.answerControls(ask, null, scope.pending);
    assert.equal(model.kind, 'working', decision);
    assert.equal(model.text, text);
    assert.deepEqual(calls.live, ['a1']);
  }
});

test('item 6: a 409 keeps the doors and shows the refusal; nothing is pending', async () => {
  const { scope, calls } = clickHarness(async () => ({ status: 409, body: { ok: false, red: 'answerAsk: already answered' }, text: '' }));
  scope.sendAnswer(fakeRoot, ask, ctx, 'redo');
  await flush();
  assert.equal(scope.pending, null);
  assert.equal(scope.answerControls(ask, null, scope.pending).kind, 'doors');
  assert.equal(scope.msg.cls, 'refused');
  assert.equal(scope.msg.text, 'This ask was already answered.');
  assert.deepEqual(calls.live, []);
});

test('item 6: the working line uses the pulse class the page already keys pulses to', () => {
  assert.match(page, /wsign\.className = "dot amber pulse"/);
  assert.match(page, /\.dot\.pulse::before\{animation:signPulse/);
});

test('(vii) text in the reason box survives three refresh ticks (the render is skipped); an empty, unfocused box does not hold', () => {
  const { scope } = clickHarness(async () => ({ status: 202, body: { ok: true } }));
  const fresh = { asks: [{ askId: 'a1', waiting: true }] };
  const typed = { askId: 'a1', value: 'half a sentence', focused: false };
  for (let tick = 0; tick < 3; tick++) assert.equal(scope.holdAskRender(typed, fresh), true, `tick ${tick}`);
  assert.equal(scope.holdAskRender({ askId: 'a1', value: '', focused: true }, fresh), true, 'focused but empty still holds');
  assert.equal(scope.holdAskRender({ askId: 'a1', value: '', focused: false }, fresh), false);
  assert.equal(scope.holdAskRender(null, fresh), false);
  // the ask the text was typed for is no longer waiting (answered elsewhere / a new draft): the page may redraw
  assert.equal(scope.holdAskRender(typed, { asks: [{ askId: 'a2', waiting: true }] }), false);
  assert.equal(scope.holdAskRender(typed, { asks: [{ askId: 'a1', waiting: false }] }), false);
});

test('(vii) a refusal shown stays until the next click: the live watch cannot overwrite it, a click replaces it', async () => {
  const { scope } = clickHarness(async () => ({ status: 409, body: { red: 'nope' }, text: '' }));
  scope.sendAnswer(fakeRoot, ask, ctx, 'redo');
  await flush();
  const shown = scope.msg.text;
  for (let tick = 0; tick < 3; tick++) {
    scope.sayLive('job2', 'run-1', { done: false, cls: 'info', text: 'answer applied — run: waiting' });
    scope.sayLive('job2', 'run-1', { done: true, cls: null, text: null });
  }
  assert.equal(scope.msg.cls, 'refused');
  assert.equal(scope.msg.text, shown);
  // the next click clears it ("sending…") — the refusal is not sticky forever
  scope.sendAnswer(fakeRoot, ask, ctx, 'redo');
  assert.equal(scope.msg.cls, 'info');
  await flush();
});

test('(vii) the page wires the hold into the one renderer every refresh goes through', () => {
  const body = fnSrc('renderAsk');
  assert.match(body, /holdAskRender\(readReasonBox\(\), result\)/);
  assert.match(body, /!focusAskId && holdAskRender/);
});
