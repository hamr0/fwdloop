// M13 am8: the end of a job is added by code (ask + write it out), shown grey on the card, marked `added` in the plan; the replaced rules are gone. $0, no browser.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { fnSrc } from '../scripts/panel-fixtures/fn-src.mjs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { cardFields, cardToProse, checkCard, cardFromSigned } from '../src/panel/authorcard.js';
import { addEnd, addedLinesOf } from '../src/added-end.js';
import { parseSignedText } from '../src/signed-text.js';
import { buildReadout } from '../src/authoring.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));

const card = (job, over = {}) => cardFields({ flowName: 'f', job, inputs: '', destination: '/out', capUsd: '5', askWait: '2h', ...over });
const jobLines = (prose) => prose.split('\n\n')[0].split('\n');

test('am8 item 2: last line is work -> ask <wait>: check the result with me, then write it out; send at line N is the added write', () => {
  const prose = cardToProse(card('Read it\nWrite a summary\n~ under 80 words'));
  assert.deepEqual(jobLines(prose), ['1. Read it', '2. Write a summary', '   guardrail: under 80 words', '3. ask 2h: check the result with me', '4. write it out']);
  assert.match(prose, /guardrail: send at line 4 to file:\/out\n/);
  const p = parseSignedText(prose);
  assert.equal(p.ok, true);
  assert.deepEqual(p.arbiter.asks.map((a) => [a.line, a.ttlMs]), [[3, 7200000]]);
});

test('am8 item 2: last line is an Ask -> only write it out (no second ask)', () => {
  const prose = cardToProse(card('Read it\nAsk 30m: is this fine?'));
  assert.deepEqual(jobLines(prose), ['1. Read it', '2. ask 30m: is this fine?', '3. write it out']);
  assert.match(prose, /send at line 3 to /);
  const own = cardToProse(card('Read it\nAsk: fine?'));
  assert.deepEqual(jobLines(own), ['1. Read it', '2. ask 2h: fine?', '3. write it out'], 'an Ask with no wait of its own takes the card wait');
});

test('am8 item 2: no Destination -> nothing added, no send', () => {
  const prose = cardToProse(card('Read it\nWrite it', { destination: '' }));
  assert.deepEqual(jobLines(prose), ['1. Read it', '2. Write it']);
  assert.doesNotMatch(prose, /send at line/);
  assert.deepEqual(addEnd([], '/out'), { steps: [], added: [] });
});

test('am8: the user\'s own last line "Write it out" is ordinary work now (it runs like any other)', () => {
  const prose = cardToProse(card('Read it\nAsk: ok?\nWrite it out'));
  assert.deepEqual(jobLines(prose), ['1. Read it', '2. ask 2h: ok?', '3. Write it out', '4. ask 2h: check the result with me', '5. write it out']);
});

test('am8 item 4: addedLinesOf finds the added lines again; a signed old job finds none', () => {
  const p = parseSignedText(cardToProse(card('Read it\nWrite a summary')));
  assert.deepEqual([...addedLinesOf(p.lines, p.arbiter)].sort(), [3, 4]);
  const q = parseSignedText(cardToProse(card('Read it\nAsk: ok?')));
  assert.deepEqual([...addedLinesOf(q.lines, q.arbiter)], [3]);
  const old = parseSignedText('1. Read it\n2. ask 1h: check it with me\n3. Write it out\n\nArbiter guardrails\nguardrail: cap $5 per run\nguardrail: send at line 3 to file:/out\n');
  assert.equal(old.ok, true);
  assert.deepEqual([...addedLinesOf(old.lines, old.arbiter)], [], 'the old send line is the person\'s own words');
});

const readout = (lines, arbiter) => buildReadout({
  declaration: { steps: lines.map((l) => ({ fromLine: l.n, goal: l.text, primitives: [], reads: [], emits: `e${l.n}`, close: { class: 'hitl' } })), inputFacts: {} },
  arbiter, lines, name: 'f', modelId: 'm', costUsd: 0.01, rounds: 1, spendComplete: true, root: '/r',
});

test('am8 item 4: the plan readout marks the added steps `added` and no other', () => {
  const p = parseSignedText(cardToProse(card('Read it\nWrite a summary')));
  const rows = readout(p.lines, p.arbiter).split('\n').filter((l) => /^ {2}\d+\. \(line /.test(l));
  assert.deepEqual(rows, ['  1. (line 1) Read it', '  2. (line 2) Write a summary', '  3. (line 3) check the result with me  [added]', '  4. (line 4) write it out  [added]']);
  const old = parseSignedText('1. Read it\n2. ask 1h: check it with me\n3. Write it out\n\nArbiter guardrails\nguardrail: cap $5 per run\nguardrail: send at line 3 to file:/out\n');
  assert.doesNotMatch(readout(old.lines, old.arbiter), /\[added\]/);
});

test('am8 item 5: a guardrail under the last line is no longer refused by the card; no Ask is needed before the last line', (t) => {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13am8-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const root = path.join(work, 'flows'); const out = path.join(work, 'out');
  mkdirSync(root); mkdirSync(out);
  const ok = (job) => checkCard(card(job, { destination: out }), { root, home: work, keys: [] });
  assert.equal(ok('Write 3 lines\n~ exactly 3 bullets').ok, true, 'a guardrail on the last line (it is work now)');
  assert.equal(ok('Write 3 lines').ok, true, 'no Ask typed anywhere');
});

test('am8: a signed old job opens as a card without its old send line, and the card gives back the same plan shape', () => {
  const text = '1. Read it\n2. ask 1h: check it with me\n3. Write it out\n\nArbiter guardrails\nguardrail: cap $5 per run\nguardrail: send at line 3 to file:/out\n';
  const s = parseSignedText(text);
  const r = cardFromSigned({ lines: s.lines, arbiter: s.arbiter });
  assert.equal(r.ok, true);
  assert.equal(r.card.job, 'Read it\nAsk 1h: check it with me');
  const again = parseSignedText(cardToProse(cardFields({ ...r.card, flowName: 'x' })));
  assert.equal(again.lines.length, 3);
  // an am8-signed job (added ask + write) opens as just the typed lines
  const n = parseSignedText(cardToProse(card('Read it\nWrite a summary')));
  const rn = cardFromSigned({ lines: n.lines, arbiter: n.arbiter });
  assert.equal(rn.ok, true);
  assert.equal(rn.card.job, 'Read it\nWrite a summary');
});

test('am8 item 3: the hint text is replaced', () => {
  assert.match(PAGE, /fwdloop adds the last check and the write to your Destination\.<\/div>/);
  assert.doesNotMatch(PAGE, /The last line writes the result to the Destination\./);
});

/** The page's real paintAddedEnd over stub boxes. */
function paint({ job, dest = '/out', wait = '1h' }) {
  const els = {};
  const el = (id) => (els[id] ??= { textContent: '', hidden: true, value: '' });
  const src = fnSrc(CHAT, 'paintAddedEnd', '    ');
  const f = new Function('byId', 'jobEl', 'destEl', 'askWaitEl', `${src}\nreturn paintAddedEnd;`)(el, { value: job }, { value: dest }, { value: wait });
  f();
  return els;
}

test('am8 item 3: the card shows the added lines in grey, the Ask only when it is added; markup is hidden grey hints under the Job box', () => {
  const work = paint({ job: 'Read it\nWrite it', wait: '30m' });
  assert.equal(work['jf-added-ask'].hidden, false);
  assert.equal(work['jf-added-ask'].textContent, '+ Ask 30m: check the result');
  assert.equal(work['jf-added-write'].hidden, false);
  assert.equal(work['jf-added-write'].textContent, '+ Write to Destination');
  const ask = paint({ job: 'Read it\n~ short\nAsk: fine?\n~ rule', wait: '1h' });
  assert.equal(ask['jf-added-ask'].hidden, true, 'last step is an Ask (a ~ line is not a step)');
  assert.equal(ask['jf-added-write'].hidden, false);
  const none = paint({ job: 'Read it', dest: ' ' });
  assert.equal(none['jf-added-ask'].hidden, true);
  assert.equal(none['jf-added-write'].hidden, true);
  assert.match(PAGE, /<div class="hint jf-added" id="jf-added-ask"[^>]*hidden><\/div>\s*<div class="hint jf-added" id="jf-added-write"[^>]*hidden><\/div>\s*<div class="hint">One step per line\./);
});
