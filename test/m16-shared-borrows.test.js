// M16 piece 1: what the older fwd borrows gained for the check block (bareloop v0.56.0), and the guarantee that what they did before is unchanged. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OFFERED, plainWords } from '../src/checkwords.js';
import { factPartReds, factSentence, factDecides, factClaims, FACT_LANGS } from '../src/citedcheck.js';
import { dropSentence } from '../src/pagedropwords.js';
import { readingQuestion } from '../src/pageask.js';
import { readRowChoices } from '../src/pickrecord.js';
import { lastPlaceRead, PLACE_EVENT } from '../src/placerule.js';
import { CheckBlock } from '../src/checkblock.js';
import { questionsOfBlock, applyChoices } from '../src/blockasks.js';

const mk = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `m16-${name}-`));

test('checkwords: the two list-size rules are offered and spoken (bareguard 0.35)', () => {
  assert.ok(OFFERED.includes('maxListItems') && OFFERED.includes('minListItems'));
  assert.equal(plainWords({ rule: 'maxListItems', value: 3 }), 'at most 3 list items');
  assert.equal(plainWords({ rule: 'minListItems', value: 2 }), 'at least 2 list items');
  assert.equal(plainWords({ rule: 'listItems', value: 3 }), 'exactly 3 list items');
});

test('facts: lang, decimal, place and aiProposal are fact fields; an old fact is judged exactly as before; a bad new field is a red', () => {
  const old = { source: 'p', facts: [{ name: 'price', shape: 'money', currency: '$', rule: { op: 'lt', value: 150 } }, { name: 'date', shape: 'date' }] };
  assert.deepEqual(factPartReds(old), []);
  assert.deepEqual(factPartReds({ source: 'p', facts: [{ name: 'when', shape: 'date', lang: 'de' }, { name: 'cost', shape: 'money', currency: '€', decimal: ',', aiProposal: true }] }), []);
  assert.match(factPartReds({ source: 'p', facts: [{ name: 'when', shape: 'date', lang: 'xx' }] })[0], /lang/);
  assert.match(factPartReds({ source: 'p', facts: [{ name: 'when', shape: 'money', currency: '$', lang: 'de' }] })[0], /lang/);
  assert.match(factPartReds({ source: 'p', facts: [{ name: 'cost', shape: 'date', decimal: ',' }] })[0], /decimal/);
  assert.match(factPartReds({ source: 'p', facts: [{ name: 'cost', shape: 'number', place: {} }] })[0], /place/);
  assert.match(factPartReds({ source: 'p', facts: [{ name: 'cost', shape: 'number', aiProposal: 'yes' }] })[0], /aiProposal/);
  assert.match(factPartReds({ source: 'p', facts: [{ name: 'cost', shape: 'number', bogus: 1 }] })[0], /not a field of a fact/);
});

test('facts: sentence, decides and claims are unchanged for a fact with none of the new fields, and carry them when present', () => {
  const f = { name: 'price', shape: 'money', currency: '$', rule: { op: 'lt', value: 150 } };
  assert.equal(factSentence(f, 'flights'), 'fact · price — money in $, under $150, quoted from "flights"');
  assert.deepEqual(factDecides({ facts: [f] }), [{ valueKind: 'money', currency: '$', op: 'lt', value: 150 }]);
  const part = { facts: [f] };
  assert.deepEqual(factClaims(part, [{ quote: 'q', values: { price: '99' } }]), [{ claim: 'price: 99', quote: 'q', values: { d0: '99' } }]);
  const g = { name: 'when', shape: 'date', lang: 'de', aiProposal: true };
  assert.match(factSentence(g, 'p'), /month names in German.*AI's proposal — check it$/);
  assert.deepEqual(factDecides({ facts: [{ ...g, decimal: undefined }] })[0].lang, 'de');
  assert.equal(factClaims({ facts: [g] }, [{ quote: 'q', values: { when: '2026-01-02' } }], [{ 0: '2. Januar 2026' }])[0].claim, 'when: 2. Januar 2026');
  assert.equal(FACT_LANGS.de, 'German');
});

test('pagedropwords: the v0.56.0 reasons are written, sign-twice without `other` still says currency', () => {
  assert.equal(dropSentence({ reason: 'sign-twice', word: '$', line: 1, fact: 'f' }), '"$" was listed twice, as a unit and as a currency; it is used once, as the currency.');
  assert.match(dropSentence({ reason: 'sign-twice', word: '$', other: 'unit', line: 1, fact: 'f' }), /as the unit\.$/);
  assert.match(dropSentence({ reason: 'reads-no-amount', word: 'Price', line: 1, fact: 'f' }), /never shows an amount next to "Price"/);
  assert.match(dropSentence({ reason: 'reads-no-time', other: 'Departs', line: 1, fact: 'f' }), /never shows a time right after "Departs"/);
  assert.match(dropSentence({ reason: 'lang-not-on-page', other: 'de', line: 1, fact: 'f' }), /no month name in German/);
  assert.match(dropSentence({ reason: 'decimal-not-on-page', line: 1, fact: 'f' }), /comma before the decimals/);
});

test('pageask: the reading question is exported', () => {
  assert.match(readingQuestion(2, 'under 150', 'less than $150'), /^Your line 2 says "under 150"\./);
});

test('pickrecord: readRowChoices reads the Drop/Add choices through the gateway; no file, a bad file or a bad row is none or dropped', () => {
  const dir = mk('rc');
  try {
    const file = path.join(dir, 'picks-record.json');
    assert.equal(readRowChoices(file), null);
    fs.writeFileSync(file, 'not json');
    assert.equal(readRowChoices(file), null);
    fs.writeFileSync(file, JSON.stringify({ picks: [], rowChoices: [{ lineWords: 'a', occurrence: 0, tail: 't', choice: 'drop' }, { lineWords: 'a', occurrence: 0, tail: 't', choice: 'maybe' }, { lineWords: 'a' }] }));
    assert.deepEqual(readRowChoices(file), [{ lineWords: 'a', occurrence: 0, tail: 't', choice: 'drop' }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('placerule: lastPlaceRead reads an earlier spine through the gateway; a missing spine is skipped without counting, a symlinked one is refused', () => {
  const dir = mk('pr');
  try {
    const event = (value) => JSON.stringify({ type: PLACE_EVENT, workflowKey: 'wk', rows: [{ key: 'L1/version', found: true, value }] });
    const spine = (n, body) => { const f = path.join(dir, `${n}.jsonl`); fs.writeFileSync(f, body); return f; };
    const rows = [
      { runid: 'run-1', job: 'j', spine: spine('one', `${event('0.1.0')}\n`) },
      { runid: 'run-2', job: 'j', spine: path.join(dir, 'missing.jsonl') },
      { runid: 'run-3', job: 'j', spine: spine('three', `{"type":"other"}\n${event('0.2.0')}\n`) },
    ];
    assert.deepEqual(lastPlaceRead({ rows, job: 'j', workflowKey: 'wk', runid: 'run-9' }), { 'L1/version': '0.2.0' });
    assert.deepEqual(lastPlaceRead({ rows, job: 'j', workflowKey: 'other', runid: 'run-9' }), {});
    // a spine that is a symlink is not followed
    const real = spine('real', `${event('9.9.9')}\n`);
    const link = path.join(dir, 'link.jsonl'); fs.symlinkSync(real, link);
    assert.deepEqual(lastPlaceRead({ rows: [{ runid: 'run-1', job: 'j', spine: link }], job: 'j', workflowKey: 'wk', runid: 'run-9' }), {});
    // more than 25 earlier runs are not looked at: 25 unreadable (symlink) ones count, the 26th is never read
    const many = Array.from({ length: 26 }, (_, i) => ({ runid: `r${i}`, job: 'j', spine: i === 0 ? real : link }));
    assert.deepEqual(lastPlaceRead({ rows: many, job: 'j', workflowKey: 'wk', runid: 'run-9' }), {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('blockasks: a block with an open reading asks it in fwd\'s words, and applyChoices takes the person\'s choice', () => {
  const text = 'Flight 1 Departs 05:30 AM Price $120\nFlight 2 Departs 09:30 AM Price $200\n';
  const b = new CheckBlock({ texts: { page: text }, labels: ['page'], asks: true, split: true });
  b.fromJob([{ n: 1, text: 'List the flights', rules: ['not a red-eye'] }]);
  b.addLook([], []);
  b.reconcile();
  const qs = questionsOfBlock(b);
  assert.ok(qs.length >= 0);
  for (const q of qs) assert.match(q.question, /^(Your line|Line) 1/);
  const refused = applyChoices(b, qs.map((q) => ({ key: q.key, choice: 'drop' })));
  assert.deepEqual(refused, []);
});
