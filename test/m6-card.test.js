// M6 piece C (server side): a signed job turned back into the card (`cardFromSigned`), and the card's `editOf` ("this card edits the job
// named X as signed at hash H"). The fidelity rule is mechanical: the card is offered only if re-writing it gives back the SAME signed
// text (lines and arbiter), so an edit can never silently drop a setting the card has no box for.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import {
  cardFields, cardFromSigned, cardToProse, checkCard,
} from '../src/panel/authorcard.js';
import { parseSignedText } from '../src/signed-text.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readFileSync } from 'node:fs';
import { BOX_JOB, inputsText } from './m4e-box-fixture.mjs';

const CAT = loadCatalogue().primitives;
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m6c-${p}-`));

function scene() {
  const work = tmp('w');
  const root = path.join(work, 'flows');
  const outDir = path.join(work, 'out');
  const inDir = path.join(work, 'in');
  for (const d of [root, outDir, inDir]) mkdirSync(d);
  writeFileSync(path.join(inDir, 'resume.md'), '# R\n');
  writeFileSync(path.join(inDir, 'jd.md'), '# J\n');
  const card = (over = {}) => cardFields({
    flowName: 'job2', job: BOX_JOB, capUsd: '0.25', askWait: '1h', destination: outDir,
    inputs: inputsText([['resume', path.join(inDir, 'resume.md')], ['jd', path.join(inDir, 'jd.md')]]), ...over,
  });
  return {
    work, root, outDir, inDir, card,
  };
}
const proseOf = (card, root) => { const r = checkCard(card, { root }); assert.equal(r.ok, true, JSON.stringify(r)); return r.prose; };

test('cardFromSigned: a job the card wrote comes back as a card that writes the SAME prose, byte for byte', () => {
  const s = scene();
  const prose = proseOf(s.card(), s.root);
  const back = cardFromSigned(parseSignedText(prose));
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal(cardToProse(cardFields({ ...back.card, flowName: 'job2' })), prose);
  assert.equal(back.card.capUsd, '0.25');
  assert.equal(back.card.destination, s.outDir);
  assert.match(back.card.job, /^Ask 30m: check it with me,$/m, 'an ask comes back with its own wait');
  assert.match(back.card.job, /^~ 3 sections, all under 600 words$/m, 'one ~ line per guardrail');
  assert.match(back.card.inputs, /^resume: .*resume\.md$/m);
});

test('cardFromSigned: no destination, no inputs, a long wait in hours, a guardrail joined with "; " stays one ~ line', () => {
  const s = scene();
  const prose = proseOf(s.card({
    destination: '', inputs: '', job: 'Read it\n~a; b\nAsk 2h: ok?\nWrite it', capUsd: '0.5',
  }), s.root);
  const back = cardFromSigned(parseSignedText(prose));
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal(back.card.destination, '');
  assert.equal(back.card.inputs, '');
  assert.equal(back.card.job, 'Read it\n~ a; b\nAsk 2h: ok?\nWrite it');
  assert.equal(cardToProse(cardFields({ ...back.card, flowName: 'x' })), prose);
});

test('cardFromSigned: an old ask with the 30m default (ask:) comes back as an explicit "Ask 30m:"', () => {
  const prose = readFileSync(new URL('./fixtures/job2-with-sources.signed.txt', import.meta.url), 'utf8');
  const back = cardFromSigned(parseSignedText(prose));
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.match(back.card.job, /^Ask 30m: check it with me,$/m);
});

test('cardFromSigned: a job with something the card has no box for is refused in words, not edited with it dropped', () => {
  const s = scene();
  const base = proseOf(s.card(), s.root);
  const cases = {
    'a redo cap': `${base}guardrail: redo cap 2\n`,
    'a skills line': `${base}guardrail: skills core,files\n`,
    'a send that is not at the last line': proseOf(s.card({ job: 'Read it\nAsk 30m: ok?\nWrite it\nTidy it' }), s.root).replace('send at line 4', 'send at line 3'),
    'a wait in seconds': base.replace('ask 30m:', 'ask 90s:'),
  };
  for (const [what, prose] of Object.entries(cases)) {
    const parsed = parseSignedText(prose);
    assert.equal(parsed.ok, true, `${what} is a signed job the parser accepts: ${JSON.stringify(parsed.reds)}`);
    const back = cardFromSigned(parsed);
    assert.equal(back.ok, false, `${what} must be refused`);
    assert.match(back.say, /cannot be opened for editing/);
  }
});

test('cardFields: editOf is {flow, flowHash} or null, nothing else', () => {
  assert.deepEqual(cardFields({ editOf: { flow: 'a', flowHash: 'h', extra: 1 } }).editOf, { flow: 'a', flowHash: 'h' });
  for (const bad of [undefined, null, 'a', 3, {}, { flow: 'a' }, { flow: 1, flowHash: 'h' }, { flow: 'a', flowHash: '' }]) {
    assert.equal(cardFields({ editOf: bad }).editOf, null, JSON.stringify(bad));
  }
});

function signedFlow() {
  const s = scene();
  const prose = readFileSync(new URL('./fixtures/job1.m1.signed.txt', import.meta.url), 'utf8');
  const decl = JSON.parse(readFileSync(new URL('./fixtures/job1.m1.declaration.json', import.meta.url), 'utf8'));
  const w = writeFlow({ root: s.root, name: 'f', proseText: prose, declaration: decl, signedBy: 'h', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT });
  assert.equal(w.ok, true, JSON.stringify(w.reds));
  return { ...s, hash: w.signature.flow };
}

test('checkCard with editOf: the same name is allowed while the job is still at that hash; a taken name without editOf is still refused', () => {
  const s = signedFlow();
  const mk = (over) => s.card({ flowName: 'f', ...over });
  const taken = checkCard(mk({}), { root: s.root });
  assert.equal(taken.ok, false);
  assert.ok(taken.refusals.some((r) => r.field === 'flowName' && /already a flow named/.test(r.say)));
  const edit = checkCard(mk({ editOf: { flow: 'f', flowHash: s.hash } }), { root: s.root });
  assert.equal(edit.ok, true, JSON.stringify(edit));
});

test('checkCard with editOf: another name, a job signed again meanwhile, and a vanished job are each refused by name on flowName', () => {
  const s = signedFlow();
  const say = (editOf, flowName = 'f') => {
    const r = checkCard(s.card({ flowName, editOf }), { root: s.root });
    assert.equal(r.ok, false);
    const x = r.refusals.find((q) => q.field === 'flowName');
    assert.ok(x, JSON.stringify(r.refusals));
    return x.say;
  };
  assert.match(say({ flow: 'f', flowHash: s.hash }, 'g'), /name of a job being edited cannot change/);
  assert.match(say({ flow: 'f', flowHash: 'e'.repeat(64) }), /"f" was signed again since you opened it/);
  assert.match(say({ flow: 'zz', flowHash: s.hash }, 'zz'), /is no longer here/);
});
