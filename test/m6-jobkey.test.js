// M6 am5/am6 piece 1: the JOB's identity (borrowed idea: bareloop's workflowKey). A job is its lines, guardrails and asks (words + positions);
// the cap, destination, input paths, ask waits and trigger are run fields and never change it. The two producers (signed flow, card) must agree.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { cardFields, checkCard } from '../src/panel/authorcard.js';
import { parseSignedText } from '../src/signed-text.js';
import { jobKeyOfCard, jobKeyOfSigned } from '../src/jobkey.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-jobkey-'));
function scene() {
  const work = tmp();
  const root = path.join(work, 'flows'); const out = path.join(work, 'out'); const inn = path.join(work, 'in');
  for (const d of [root, out, inn]) mkdirSync(d);
  writeFileSync(path.join(inn, 'a.md'), '# A\n'); writeFileSync(path.join(inn, 'b.md'), '# B\n');
  const card = (over = {}) => cardFields({
    flowName: 'jk', job: 'Read it\n~ short\n~ plain\nAsk 1h: ok?\nWrite it', capUsd: '0.5', askWait: '1h', destination: out, inputs: `a: ${path.join(inn, 'a.md')}`, ...over,
  });
  const signedKey = (c) => { const r = checkCard(c, { root }); assert.equal(r.ok, true, JSON.stringify(r)); const p = parseSignedText(r.prose); assert.equal(p.ok, true); return jobKeyOfSigned(p); };
  return { card, signedKey, out, inn };
}

test('jobkey: a card and the signed text it writes have the SAME key (round trip, two ~ lines, case of Ask, spacing)', () => {
  const s = scene();
  const c = s.card();
  assert.equal(jobKeyOfCard(c.job), s.signedKey(c));
  const c2 = s.card({ job: '  Read it  \n~short\n~ plain\nask 1h:   ok?\n\nWrite it\n' });
  assert.equal(jobKeyOfCard(c2.job), s.signedKey(c2), 'spacing, blank lines and Ask case are not the job');
  assert.equal(jobKeyOfCard(c2.job), jobKeyOfCard(c.job));
});

test('jobkey: every JOB field changes the key', () => {
  const s = scene();
  const base = jobKeyOfCard(s.card().job);
  for (const job of [
    'Read it now\n~ short\n~ plain\nAsk 1h: ok?\nWrite it', // line text
    'Read it\n~ short\n~ other\nAsk 1h: ok?\nWrite it', // guardrail
    'Read it\n~ short\n~ plain\nAsk 1h: fine?\nWrite it', // ask question
    'Read it\n~ short\n~ plain\nOk?\nWrite it', // ask removed
    'Read it\n~ short\n~ plain\nAsk 1h: ok?\nWrite it\nAsk 1h: again?', // ask added
    'Ask 1h: ok?\nRead it\n~ short\n~ plain\nWrite it', // ask position
    'Read it\n~ short\n~ plain\nAsk 1h: ok?\nWrite it\nExtra', // step added
  ]) assert.notEqual(jobKeyOfCard(job), base, job);
});

test('jobkey: no RUN field changes the key (cap, destination, input path, ask wait)', () => {
  const s = scene();
  const base = s.signedKey(s.card());
  assert.equal(s.signedKey(s.card({ capUsd: '0.9' })), base, 'cap');
  assert.equal(s.signedKey(s.card({ destination: '' })), base, 'destination');
  assert.equal(s.signedKey(s.card({ inputs: `b: ${path.join(s.inn, 'b.md')}` })), base, 'input');
  assert.equal(s.signedKey(s.card({ job: 'Read it\n~ short\n~ plain\nAsk 2h: ok?\nWrite it' })), base, 'ask wait');
  assert.equal(jobKeyOfCard('Read it\n~ short\n~ plain\nAsk 2h: ok?\nWrite it'), base);
});
