// M13 am11 P1: the code-added end is gone. The card writes the typed lines only; the send is tentative at the last typed line; no grey lines, no `added` marks, the new hint. $0, no browser.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cardFields, cardToProse, cardFromSigned } from '../src/panel/authorcard.js';
import { parseSignedText } from '../src/signed-text.js';
import { buildReadout } from '../src/authoring.js';
import { jobKeyOfCard, jobKeyOfSigned } from '../src/jobkey.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const card = (job, over = {}) => cardFields({ flowName: 'f', job, inputs: '', destination: '/out', capUsd: '5', askWait: '2h', ...over });
const jobLines = (prose) => prose.split('\n\n')[0].split('\n');

test('am11 item 1/4: the card adds no line; the tentative send sits on the last typed line', () => {
  const prose = cardToProse(card('Read it\nWrite a summary\n~ under 80 words'));
  assert.deepEqual(jobLines(prose), ['1. Read it', '2. Write a summary', '   guardrail: under 80 words']);
  assert.match(prose, /guardrail: send at line 2 to file:\/out\n/);
  const none = cardToProse(card('Read it\nWrite it', { destination: '' }));
  assert.doesNotMatch(none, /send at line/);
});

test('am11 item 4: the code that added the end is gone', () => {
  assert.equal(existsSync(path.join(HERE, '..', 'src', 'added-end.js')), false);
});

test('am11 item 4: the plan readout marks nothing `added`', () => {
  const p = parseSignedText(cardToProse(card('Read it\nWrite a summary')));
  const out = buildReadout({
    declaration: { steps: p.lines.map((l) => ({ fromLine: l.n, goal: l.text, primitives: [], reads: [], emits: `e${l.n}`, close: { class: 'hitl' } })), inputFacts: {} },
    arbiter: p.arbiter, lines: p.lines, name: 'f', modelId: 'm', costUsd: 0.01, rounds: 1, spendComplete: true, root: '/r',
  });
  assert.doesNotMatch(out, /\[added\]/);
});

test('am11 item 4: the hint is the new one; no grey added lines on the card', () => {
  // M19 am14 item 3 replaced the hint's words; the signed sentence is pinned in test/m19-am14-refusal.test.js
  assert.match(PAGE, /The last line writes the result to the Destination\.<\/div>/);
  assert.doesNotMatch(PAGE, /Leave it out and fwdloop suggests one/);
  assert.doesNotMatch(PAGE, /fwdloop adds the last check and the write/);
  assert.doesNotMatch(PAGE, /jf-added/);
  assert.doesNotMatch(PAGE, /paintAddedEnd/);
});

test('am11: a signed job opens as a card with every line it has, and its identity is the card\'s', () => {
  const job = 'Read it\nWrite a summary\nWrite it out';
  const s = parseSignedText(cardToProse(card(job)));
  const r = cardFromSigned({ lines: s.lines, arbiter: s.arbiter });
  assert.equal(r.ok, true);
  assert.equal(r.card.job, job);
  assert.equal(jobKeyOfSigned(s), jobKeyOfCard(job));
});

test('am11 (ruling): a send with no Ask before it parses; the action needs no Ask', () => {
  const p = parseSignedText('1. Read it\n2. Write it out\n\nArbiter guardrails\nguardrail: cap $5 per run\nguardrail: send at line 2 to file:/out\n');
  assert.equal(p.ok, true, p.ok ? '' : p.reds.join('; '));
});
