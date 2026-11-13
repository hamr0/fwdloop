// borrowed-from: bareloop tests/checkblock.test.js@v0.56.0 (3383cce + f148028e for the agree-follower tests), imports pointed at fwd's files, fixtures under test/fixtures/m16-block/
// hamr 2026-11-12: "goal again is simplfication and one flow one place ai suggestes ! code adds $ and code decides what worked/doable".
// The CheckBlock (src/checkblock.js): the five invariants of the design, the POC's bars over COMMITTED fixtures (tests/fixtures/checkblock/, copied from the valid POC cases),
// the mutants the POC used (each must break a bar), the per-reply cap, the already-on-the-list refusals with their own reasons (A3), the one-check rule and the two-sources door.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CheckBlock, renderCard, REASON, CARD_T } from '../src/checkblock.js';
import { listMatchesClose } from '../src/rubricstep.js';
import { MAX_BANG } from '../src/checklist.js';

const load = (/** @type {string} */ f) => JSON.parse(readFileSync(new URL(`./fixtures/m16-block/checkblock/${f}`, import.meta.url), 'utf8'));
const CASES = load('replay-cases.json');
const D = load('r3-cases.json');
const norm = (/** @type {unknown} */ t) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const strip = (/** @type {any} */ rows) => JSON.parse(JSON.stringify(rows, (k, v) => (k === 'can' ? undefined : v)));

/** the saved person: answers by line, rule words and ask kind */
const answerer = (/** @type {any} */ c) => (/** @type {any} */ q) => { const h = c.answers.find((/** @type {any} */ a) => a.line === q.line && norm(a.ruleText) === norm(q.ruleText) && a.ask === q.ask); return h ? { choice: h.choice, text: h.text } : null; };

/** @param {any} c a saved case @param {{extra?: any[], cls?: typeof CheckBlock}} [o] */
function replay(c, { extra = [], cls = CheckBlock } = {}) {
  const b = new cls({ texts: c.inputs.texts, labels: c.inputs.labels });
  b.fromJob(c.inputs.jobLines);
  b.addLook(c.inputs.lookFacts);
  const deltas = c.deltas.map((/** @type {any} */ d) => ({ ...d, edits: [...d.edits] }));
  if (extra.length) { if (deltas.length) deltas.at(-1).edits.push(...extra); else deltas.push({ label: 'probe', pre: true, edits: [...extra] }); }
  b.queue.push(...deltas);
  b.drive({ answer: answerer(c) });
  return b;
}

/** the POC's bars as ONE checker over a finished block; returns the list of broken bars (empty = every bar holds) */
function barsBroken(/** @type {any} */ b, /** @type {any} */ snapshots = null) {
  const broken = [];
  const rows = b.rows;
  // I1 agreed + checkable implies built (a checkable row that is not built says plainly that code could not build it)
  for (const r of rows) if (r.can?.ok && r.state !== 'built' && !/^(code could not build|the pick is not a legal|a result count needs a fact)/.test(r.reason ?? '')) broken.push(`b1 ${r.key} checkable but ${r.state}: ${r.reason}`);
  // I2 not checkable implies Not checked with a plain reason, and never built
  for (const r of rows) {
    if (r.can && !r.can.ok && r.state === 'built') broken.push(`b2 ${r.key} not checkable but built`);
    if (r.state !== 'built' && !(typeof r.reason === 'string' && r.reason.length >= 10 && !/[{}[\]]|undefined|\bnull\b/.test(r.reason.replace(/"[^"]*"/g, '')))) broken.push(`b2 ${r.key} not built without a plain reason: ${r.reason}`);
  }
  // b3 zero AI-format parts reach the close: every part is one code makes from rows (a fact part, a pick part, or code's own $ default)
  for (const p of b.closeCache?.parts ?? []) {
    const code = p.class === 'fact' || (p.class === 'countable' && (p.check === 'cited' || p.check === 'numbersFromFacts' || p.rule !== undefined || p.check !== undefined));
    if (!code || p.aiPart) broken.push(`b3 an AI-format part reached the close: ${JSON.stringify(p).slice(0, 80)}`);
  }
  for (const m of b.closeCache?.map ?? []) if (m.origin !== 'code') broken.push(`b3 a part of origin ${m.origin}`);
  // b4 the card is built from rows only: changing a row changes the card, and a card line exists for every non-floor row
  const card = renderCard(rows);
  if (card.map((/** @type {any} */ x) => x.key).join() !== rows.filter((/** @type {any} */ r) => r.kind !== 'floor').map((/** @type {any} */ r) => r.key).join()) broken.push('b4 card keys are not the rows');
  const copy = strip(rows); const t = copy.find((/** @type {any} */ r) => r.kind !== 'floor');
  if (t && JSON.stringify(renderCard(copy)) === JSON.stringify(renderCard(copy.map((/** @type {any} */ r) => (r === t ? { ...r, text: `${r.text ?? ''} X`, name: `${r.name ?? ''} X`, state: r.state === 'built' ? 'not-checked' : 'built' } : r))))) broken.push('b4 the card did not move when a row changed');
  // b5/b6 a bad edit refused alone removes no row; no row is dropped after the last try
  if (snapshots) for (let i = 1; i < snapshots.length; i += 1) for (const k of snapshots[i - 1]) if (!snapshots[i].includes(k)) broken.push(`b6 row ${k} vanished between ${i - 1} and ${i}`);
  return broken;
}

test('POC bars over 10 committed real cases: every agreed checkable row built, no not-checkable row built, zero AI parts, card from rows, nothing vanishes', () => {
  assert.equal(CASES.length, 10);
  let built = 0;
  for (const c of CASES) {
    const b = replay(c);
    assert.deepEqual(barsBroken(b), [], c.id);
    built += b.rows.filter((/** @type {any} */ r) => r.state === 'built' && r.kind !== 'floor').length;
    // the golden: the POC's own verdict per row (key, kind, by, state) for the same inputs, deltas and answers
    // ruling 1: an agreed answer also writes its own `~` row (a follower), which the POC did not have: every golden row is there with its state, the extras are followers
    assert.deepEqual(b.rows.filter((/** @type {any} */ r) => !r.parent).map((/** @type {any} */ r) => ({ key: r.key, kind: r.kind, by: r.by, state: r.state })), c.golden, c.id);
  }
  assert.ok(built >= 10, `the bars are not vacuous: ${built} built rows`);
});

test('invariant: every edit passes reconcile; no row is ever removed, over every reply and answer of every case', () => {
  for (const c of CASES) {
    const b = new CheckBlock({ texts: c.inputs.texts, labels: c.inputs.labels });
    b.fromJob(c.inputs.jobLines); b.addLook(c.inputs.lookFacts); b.reconcile();
    let seen = new Set(b.rows.map((/** @type {any} */ r) => r.key));
    for (const d of c.deltas) {
      b.applyDelta(d); b.reconcile();
      for (const k of seen) assert.ok(b.rows.some((/** @type {any} */ r) => r.key === k), `${c.id}: ${k} vanished`);
      for (const r of b.rows) assert.ok(r.state === 'built' || (r.state === 'not-checked' && r.reason), `${c.id}: ${r.key} is neither built nor plainly not checked`);
      seen = new Set(b.rows.map((/** @type {any} */ r) => r.key));
    }
  }
});

test('a bad edit is refused ALONE: the rest of the reply lands, no row is removed, and each refusal says why', () => {
  const probe = [
    { op: 'add', kind: 'phrase', line: 1, name: 'probe', words: ['zz-not-on-this-page-9137'] },
    { op: 'reading', line: 1, rules: [1], fact: 'no such fact', reading: { op: 'lt', value: 'x' } },
    { op: 'part', line: 1, partClass: 'fact' },
    'not even an object',
  ];
  for (const c of CASES) {
    const plain = replay(c);
    const probed = replay(c, { extra: probe });
    assert.deepEqual(strip(probed.rows), strip(plain.rows), `${c.id}: a probe changed a row`);
    const last = probed.deltaLog.at(-1);
    const refused = last.edits.slice(-probe.length);
    assert.ok(refused.every((/** @type {any} */ e) => e.accepted === false && typeof e.refusedBecause === 'string' && e.refusedBecause.length > 10), `${c.id}: ${JSON.stringify(refused)}`);
  }
});

test('no row changes by the AI after the last try (rows change only by the person or by code)', () => {
  const c = CASES[1];
  const b = new CheckBlock({ texts: c.inputs.texts, labels: c.inputs.labels, maxTries: 2 });
  b.fromJob(c.inputs.jobLines); b.addLook(c.inputs.lookFacts); b.reconcile();
  const add = (/** @type {string} */ w) => ({ op: 'add', kind: 'phrase', line: 1, name: w.toLowerCase(), words: [w], source: c.inputs.labels[0] });
  const word = (/** @type {number} */ i) => [...new Set(Object.values(c.inputs.texts).join(' ').match(/\b[A-Z][a-z]{6,}\b/g) ?? [])].filter((w) => !b.rows.some((/** @type {any} */ r) => r.words?.includes(w)))[i] ?? '';
  b.applyDelta({ label: 't1', edits: [add(word(0))] }); b.reconcile();
  b.applyDelta({ label: 't2', edits: [add(word(1))] }); b.reconcile();
  const before = JSON.stringify(strip(b.rows));
  const rec = b.applyDelta({ label: 't3', edits: [add(word(2)), { op: 'not-checkable', line: 1, rule: 1, reason: 'gone' }] }); b.reconcile();
  assert.equal(JSON.stringify(strip(b.rows)), before);
  assert.ok(rec.edits.every((/** @type {any} */ e) => e.refusedBecause === REASON.afterLast));
});

// ---- the mutants the POC used: each must BREAK a bar (a bar nothing can break is not a guard)
class DropAfterLast extends CheckBlock {
  /** @param {any} o */
  drive(o) { super.drive(o); this.rows = this.rows.filter((/** @type {any} */ r) => !(r.by === 'agent' && r.state !== 'built')); const i = this.rows.findIndex((/** @type {any} */ r) => r.kind === 'rule' && r.state !== 'built'); if (i >= 0) this.rows.splice(i, 1); return this; }
}
class KeepAi extends CheckBlock {
  build() { const c = super.build(); const p = { text: 'ai part', class: 'judged', aiPart: true }; c.parts.push(p); c.map.push({ part: c.parts.length - 1, line: 1, rows: [], origin: 'ai' }); return c; }
}
class WholeReply extends CheckBlock {
  /** @param {any} d */
  applyDelta(d) { if ((d.edits ?? []).some((/** @type {any} */ e) => e?.op === 'part' || e?.probe)) return super.applyDelta({ ...d, edits: [] }); return super.applyDelta(d); }
}
class SkipWordsRead extends CheckBlock {
  matchRule(/** @type {any} */ r) { if (r.links?.length && !r.aiReading && !r.agreed) { r.can = { ok: true, how: 'fact', link: r.links[0], reading: undefined }; return; } super.matchRule(r); }
}

test('mutants: drop-after-last and keep-ai and skip-words-read each break a bar on real data; a reply-wide refusal loses the good edits', () => {
  assert.ok(CASES.some((c) => replay(c, { cls: DropAfterLast }).rows.length < replay(c).rows.length), 'drop-after-last must remove a row on a real case');
  assert.ok(CASES.some((c) => barsBroken(replay(c, { cls: KeepAi })).some((/** @type {string} */ m) => m.startsWith('b3'))), 'keep-ai must break bar 3');
  const two = (/** @type {typeof CheckBlock} */ cls) => { const b = new cls({ texts: { flights: D.pages.usd }, labels: ['flights'] }); b.fromJob([{ n: 1, text: 'Pick a flight', rules: ['under $450 or over $900'] }]); b.addLook([{ line: 1, ...D.facts.usd, forRule: 1, source: 'flights' }]); b.drive({ answer: () => null }); return b.rows.find((r) => r.kind === 'rule'); };
  assert.equal(two(CheckBlock)?.state, 'not-checked');
  assert.equal(two(SkipWordsRead)?.state, 'built', 'skip-words-read builds a limitless check the real block refuses');
  // whole-reply: one good add and one bad edit in one reply; the per-edit block keeps the add, the whole-reply mutant loses it
  const c = CASES[1];
  const mk = (/** @type {typeof CheckBlock} */ cls) => { const b = new cls({ texts: c.inputs.texts, labels: c.inputs.labels }); b.fromJob(c.inputs.jobLines); b.addLook(c.inputs.lookFacts); b.reconcile(); return b; };
  const word = [...new Set(Object.values(c.inputs.texts).join(' ').match(/\b[A-Z][a-z]{6,}\b/g) ?? [])].find((w) => !mk(CheckBlock).rows.some((/** @type {any} */ r) => r.words?.includes(w)));
  const reply = { label: 'r', edits: [{ op: 'add', kind: 'phrase', line: 1, name: 'good word', words: [word], source: c.inputs.labels[0] }, { op: 'part', line: 1, probe: true }] };
  const good = mk(CheckBlock); good.applyDelta(reply);
  const bad = mk(WholeReply); bad.applyDelta(reply);
  assert.equal(good.deltaLog[0].edits.filter((/** @type {any} */ e) => e.accepted).length, 1);
  assert.equal(bad.deltaLog[0].edits.filter((/** @type {any} */ e) => e.accepted).length, 0);
});

// ---- the limit through the block: code reads the person's own words; an AI reading must not read a rule that holds two limits (A1)
const usdBlock = (/** @type {string} */ rule) => {
  const b = new CheckBlock({ texts: { flights: D.pages.usd }, labels: ['flights'] });
  b.fromJob([{ n: 1, text: 'Pick a flight', rules: [rule] }]);
  b.addLook([{ line: 1, ...D.facts.usd, forRule: 1, source: 'flights' }]);
  b.drive({ answer: () => null });
  return b;
};
const ruleRow = (/** @type {CheckBlock} */ b) => b.rows.find((r) => r.kind === 'rule');
const priceOf = (/** @type {CheckBlock} */ b) => b.closeCache.parts.flatMap((/** @type {any} */ p) => p.facts ?? []).find((/** @type {any} */ f) => f.shape === 'money');

test('the 42 B7 rules through the block: built exactly as expected, or Not checked with a plain reason', () => {
  for (const c of D.b7) {
    const page = c.fact === 'eur' ? D.pages.eur : c.fact === 'gbp' ? D.pages.gbp : D.pages.usd;
    const b = new CheckBlock({ texts: { flights: page }, labels: ['flights'] });
    b.fromJob([{ n: 1, text: 'Pick a flight', rules: [c.rule] }]);
    b.addLook([{ line: 1, ...D.facts[c.fact], forRule: 1, source: 'flights' }]);
    b.drive({ answer: () => null });
    const row = ruleRow(b);
    const fact = b.closeCache.parts.flatMap((/** @type {any} */ p) => p.facts ?? []).find((/** @type {any} */ f) => f.shape === D.facts[c.fact].shape);
    if (c.expect === null) assert.ok(!(row?.state === 'built' && fact), `${c.id} "${c.rule}" built a check it must not`);
    else { assert.equal(row?.state, 'built', c.id); assert.deepEqual(fact?.rule, c.expect, c.id); }
    if (row?.state !== 'built') assert.ok(row?.reason && row.reason.length >= 15, c.id);
  }
});

test('A1: an AI reading edit on a rule with two limits is refused, so the rule stays Not checked; a one-limit rule still takes the reading', () => {
  const b = usdBlock('under $450 or over $900');
  assert.equal(ruleRow(b)?.state, 'not-checked');
  const rec = b.applyDelta({ label: 'ai', edits: [{ op: 'reading', line: 1, rules: [1], fact: 'price', reading: { op: 'lt', value: 450 } }] });
  b.reconcile();
  assert.equal(rec.edits[0].accepted, false);
  assert.match(rec.edits[0].refusedBecause, /more than one amount or range/);
  assert.equal(ruleRow(b)?.state, 'not-checked');
  assert.equal(priceOf(b), undefined);
  // a rule whose limit the person wrote and code could not read ("cheap") is still open to an honest AI reading, which then asks the person
  const c = usdBlock('a fair price');
  const ok = c.applyDelta({ label: 'ai', edits: [{ op: 'reading', line: 1, rules: [1], fact: 'price', reading: { op: 'lt', value: 450 } }] });
  c.reconcile();
  assert.equal(ok.edits[0].accepted, true);
  assert.equal(c.open.length, 1, 'a number the person did not write is asked, never built');
});

test('A3: the two reasons of a refused reading edit are different, each chosen by code for its own case', () => {
  const read = usdBlock('under $450'); // the person's own words already give the limit: the look gave none, code read it
  const noFact = read.applyDelta({ label: 'a', edits: [{ op: 'reading', line: 1, rules: [1], fact: 'colour', reading: { op: 'lt', value: 450 } }] }).edits[0];
  assert.match(noFact.refusedBecause, /no look fact named "colour"/);
  const first = usdBlock('a fair price');
  first.applyDelta({ label: 'a', edits: [{ op: 'reading', line: 1, rules: [1], fact: 'price', reading: { op: 'lt', value: 450 } }] });
  const again = first.applyDelta({ label: 'b', edits: [{ op: 'reading', line: 1, rules: [1], fact: 'price', reading: { op: 'lt', value: 500 } }] }).edits[0];
  assert.match(again.refusedBecause, /^already on the list: the look or an earlier reading already reads that rule/);
  assert.notEqual(noFact.refusedBecause, again.refusedBecause);
  assert.ok(!/ or no look fact/.test(again.refusedBecause) && !/the look already reads it, or/.test(noFact.refusedBecause));
});

// ---- the cap of MAX_BANG counts the checks KEPT in ONE reply (POC round 1 fault: it counted across replies)
test('a reply of 5 legal adds keeps 3 and refuses 2 alone; a second reply keeps its own 3', () => {
  const c = D.b10[0];
  const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
  const edit = (/** @type {string} */ w) => ({ op: 'add', kind: 'phrase', line: 1, name: names[Number(w.slice(1)) - 1], words: [w], source: 'flights' });
  const b = new CheckBlock({ texts: { flights: c.page }, labels: ['flights'] });
  b.fromJob([{ n: 1, text: c.lineText, rules: [] }]); b.reconcile();
  for (const rp of c.replies) {
    const rec = b.applyDelta({ label: rp.label, pre: rp.pre, edits: rp.words.map(edit) }); b.reconcile();
    assert.equal(rec.edits.filter((/** @type {any} */ e) => e.accepted).length, rp.expectKept, rp.label);
    assert.equal(rec.edits.filter((/** @type {any} */ e) => /^more than \d+ checks proposed/.test(e.refusedBecause ?? '')).length, rp.expectCapRefused, rp.label);
    if (rp.expectCapRefused > 0) assert.equal(rec.edits.findIndex((/** @type {any} */ e) => !e.accepted), MAX_BANG, 'the cap refuses only after 3 were kept');
  }
});

test('B10: the suggest call and the drafter reach the SAME door; under the cap, separate replies equal one combined reply', () => {
  const c = D.b10[1];
  const edit = (/** @type {string} */ w) => ({ op: 'add', kind: 'phrase', line: 1, name: `n${w.toLowerCase()}`.replace(/\d/g, 'x'), words: [w], source: 'flights' });
  const mk = () => { const b = new CheckBlock({ texts: { flights: c.page }, labels: ['flights'] }); b.fromJob([{ n: 1, text: c.lineText, rules: [] }]); b.reconcile(); return b; };
  const S = mk();
  for (const rp of c.replies) { S.applyDelta({ label: rp.label, pre: rp.pre, edits: rp.words.map(edit) }); S.reconcile(); }
  const C = mk();
  C.applyDelta({ label: 'combined', pre: true, edits: c.replies.flatMap((/** @type {any} */ rp) => rp.words.map(edit)) }); C.reconcile();
  const keys = (/** @type {CheckBlock} */ b) => b.rows.map((r) => r.key).sort();
  assert.deepEqual(keys(S), keys(C));
  assert.equal(S.tries, 1, 'a suggest-call reply is not a try; the drafter reply is');
});

// ---- B8: an add that repeats a look fact tied to a ~ rule is refused as "already on the list", and no row changes
test('B8: a repeat of a ~-tied look fact is refused "already on the list" alone; a control add still lands', () => {
  for (const f of D.b8) {
    const page = f.pageText ?? D.pages[f.page];
    const look = f.tiedRaw ? [f.tiedRaw] : [{ line: 1, ...D.facts[f.tied.fact], forRule: f.tied.forRule, source: 'flights' }];
    const b = new CheckBlock({ texts: { flights: page }, labels: ['flights'] });
    b.fromJob([{ n: 1, text: f.lineText, rules: f.rules }]); b.addLook(look); b.drive({ answer: () => null });
    for (const [v, e] of Object.entries(f.adds)) {
      const pre = JSON.stringify(strip(b.rows));
      const ed = b.applyDelta({ label: `${f.id}-${v}`, pre: true, edits: [e] }).edits[0]; b.reconcile();
      assert.equal(ed.accepted, false, `${f.id} ${v}`);
      assert.match(ed.refusedBecause, /already on the list/, `${f.id} ${v}`);
      assert.equal(JSON.stringify(strip(b.rows)), pre, `${f.id} ${v}: a row changed`);
    }
    const ctl = b.applyDelta({ label: `${f.id}-ctl`, pre: true, edits: [f.control] }).edits[0];
    assert.equal(ctl.accepted, true, `${f.id} control: ${ctl.refusedBecause}`);
  }
});

// ---- B9: the standing ruling "a run needs one check"
test('B9: hasBuiltCheck says no where the standing ruling "a run needs one check" says no, and agrees with the signed list', () => {
  for (const c of D.b9) {
    const b = new CheckBlock({ texts: c.texts, labels: c.labels });
    b.fromJob([{ n: 1, text: c.lineText, rules: c.rules }]); b.addLook(c.look);
    b.drive({ answer: () => ({ choice: 'drop' }) });
    assert.equal(b.hasBuiltCheck(), c.expect, c.id);
    assert.equal(b.signedRows().some((r) => r.state === 'built' && r.kind !== 'floor'), c.expect, `${c.id}: the signed list says what the block says`);
  }
  for (const c of CASES) { const b = replay(c); assert.equal(b.hasBuiltCheck(), b.signedRows().some((r) => r.state === 'built' && r.kind !== 'floor'), c.id); }
});

test('signedRows carries only the signed fields (never words), each row built or not-checked, and a built row points at its part', () => {
  const b = replay(CASES[0]);
  const rows = b.signedRows();
  assert.equal(rows.length, b.rows.length);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).filter((k) => !['line', 'key', 'from', 'by', 'kind', 'state', 'rule', 'part', 'reason', 'facts'].includes(k)), []);
    assert.ok(r.state === 'built' || r.state === 'not-checked');
  }
  const built = rows.filter((r) => r.state === 'built' && r.kind !== 'floor');
  assert.ok(built.length > 0 && built.every((r) => r.part && Number.isInteger(r.part.part)), JSON.stringify(built));
  assert.ok(CARD_T.agreed);
});

// ---- hamr's rulings 2026-11-12: agree writes a `~` row with the SAME rule number a typed rule gets; the agreed fact is no AI proposal; carried picks; look drops show; retention shape
const flight = () => {
  const b = new CheckBlock({ texts: { flights: 'Flights\nDeparture time: 07:30\nPrice: $450\n' }, labels: ['flights'] });
  b.fromJob([{ n: 1, text: 'Pick a flight', rules: ['not a redeye'] }]);
  b.addLook([{ line: 1, name: 'departure', shape: 'time', words: ['Departure time:'], forRule: 1, source: 'flights', reading: { op: 'between', lo: '06:00', hi: '21:00' } }]);
  b.reconcile();
  return b;
};

test('agree on a reading adds a `~` row with the next rule number; the agreed fact carries both numbers and no aiProposal', () => {
  const b = flight();
  assert.equal(b.open.length, 1);
  assert.equal(b.open[0].ask, 'reading');
  assert.deepEqual(b.applyAnswer(b.open[0].key, 'agree'), { ok: true });
  b.reconcile();
  const rules = b.rows.filter((r) => r.kind === 'rule');
  assert.deepEqual(rules.map((r) => r.rule), [1, 2]);
  assert.equal(rules[1].by, 'you');
  assert.match(rules[1].text, /departure/);
  assert.ok(rules.every((r) => r.state === 'built'), JSON.stringify(rules.map((r) => r.reason)));
  const part = b.closeCache.parts.find((/** @type {any} */ p) => p.class === 'fact');
  assert.deepEqual(part.rules, [1, 2]);
  assert.equal(part.facts[0].aiProposal, undefined);
  assert.equal(b.open.length, 0);
});

test('drop on a question leaves the rule Not checked and adds no row; a typed rule adds a typed row', () => {
  const b = flight();
  b.applyAnswer(b.open[0].key, 'drop'); b.reconcile();
  assert.equal(b.rows.filter((r) => r.kind === 'rule').length, 1);
  assert.equal(b.rows.find((r) => r.kind === 'rule')?.reason, REASON.left);
  const c = new CheckBlock({ texts: { f: 'x y z' }, labels: ['f'] });
  c.fromJob([{ n: 1, text: 'Say it', rules: ['be nice'] }]); c.reconcile();
  assert.equal(c.open[0].ask, 'cant-check');
  c.applyAnswer(c.open[0].key, 'rule', 'mention x'); c.reconcile();
  assert.deepEqual(c.rows.filter((r) => r.kind === 'rule').map((r) => [r.rule, r.origin]), [[1, 'job'], [2, 'typed']]);
});

test('an agreed count pick: pick part carries the rule and its added line; carry() keeps a last draft pick as a follower and a left rule left', () => {
  const mk = () => { const b = new CheckBlock({ texts: { f: 'x' }, labels: ['f'] }); b.fromJob([{ n: 1, text: 'Summarise it', rules: ['exactly 3 bullets', 'under 80 words', 'exactly 3 bullets'] }]); return b; };
  const b = mk(); b.reconcile();
  const q = b.open.find((x) => x.ruleText === 'under 80 words');
  assert.equal(q?.ask, 'check');
  b.applyAnswer(q.key, 'agree'); b.reconcile();
  assert.ok(b.rows.find((r) => r.rule === 2)?.pick);
  assert.equal(b.rows.find((r) => r.rule === 2)?.from, 'pick');
  const c = mk();
  const check = b.rows.find((r) => r.rule === 2).pick;
  c.carry({ picks: [{ line: 1, rule: 2, check, added: 'at most 80 words' }], left: [{ line: 1, rule: 1 }] });
  c.reconcile();
  assert.equal(c.rows.find((r) => r.rule === 2)?.state, 'built');
  assert.equal(c.rows.find((r) => r.rule === 1)?.reason, REASON.left);
  assert.ok(!c.open.some((x) => x.ruleText === 'under 80 words'));
  assert.equal(c.signedRows().find((r) => r.rule === 2)?.from, 'pick');
});

test('a count rule code does not scope in is Not checked with the plain words, never asked (countScope)', () => {
  const b = new CheckBlock({ texts: { f: 'x' }, labels: ['f'], countScope: () => false });
  b.fromJob([{ n: 1, text: 'Summarise it', rules: ['exactly 3 bullets'] }]); b.reconcile();
  assert.equal(b.open.length, 0);
  assert.equal(b.rows.find((r) => r.kind === 'rule')?.reason, REASON.noRule);
});

test('ruling 4: a whole fact the look dropped shows Not checked with its plain sentence (a tied rule gets it as its reason, a loose fact is a `!` row); person-left is the block\'s own', () => {
  const b = new CheckBlock({ texts: { f: 'x' }, labels: ['f'] });
  b.fromJob([{ n: 1, text: 'Find it', rules: ['cheap enough'] }]);
  b.addLook([], [{ line: 1, rule: 1, fact: 'price', reason: 'no-label' }, { line: 1, fact: 'seats', reason: 'no-label' }, { line: 1, rule: 1, fact: 'price', reason: 'person-left' }]);
  b.reconcile();
  b.applyAnswer(b.open[0].key, 'drop'); b.reconcile();
  const loose = b.rows.find((r) => r.kind === 'fact');
  assert.equal(loose?.state, 'not-checked');
  assert.match(String(loose?.reason), /No word on this page reads "seats" safely/);
  const c = new CheckBlock({ texts: { f: 'x' }, labels: ['f'] });
  c.fromJob([{ n: 1, text: 'Find it', rules: ['cheap enough'] }]);
  c.addLook([], [{ line: 1, rule: 1, fact: 'price', reason: 'no-label' }]);
  c.reconcile(); c.applyAnswer(c.open[0].key, 'rule', 'mention x'); c.reconcile();
  assert.match(String(c.rows.find((r) => r.rule === 1)?.reason), /No word on this page reads "price" safely/);
});

test('retention() has retentionOfList\'s shape and counts', () => {
  const b = replay(CASES[0]);
  const r = b.retention();
  assert.deepEqual(Object.keys(r[0]).sort(), ['aiParts', 'dropped', 'kept', 'line', 'picks']);
  assert.equal(r[0].aiParts, r[0].kept + r[0].dropped);
});

// ---- live draft smwevmaaazskf (hamr 2026-11-13): an agreed answer's follower row must end with its parent's check, else Sign & run refuses ("a row points at a check the close does not run")
test('after an agree, the follower row carries its parent\'s part and the signed list matches the close', () => {
  const b = flight();
  b.applyAnswer(b.open[0].key, 'agree'); b.reconcile();
  const follower = b.rows.find((r) => r.parent);
  assert.ok(follower, 'the agreed answer is a follower row');
  const parent = b.rows.find((r) => r.key === follower.parent);
  assert.ok(parent?.part, 'the parent has its part');
  assert.deepEqual(follower.part, parent.part);
  assert.equal(follower.state, 'built');
  assert.deepEqual(listMatchesClose({ stages: b.closeCache.stages, list: b.signedRows() }), { ok: true });
});

test('real saved draft smwevmaaazskf: the agreed reading rebuilt from its saved page, job and look matches the close; the saved (buggy) list did not', () => {
  const dir = new URL('./fixtures/m16-block/agree-follower/', import.meta.url);
  const text = readFileSync(new URL('flights.txt', dir), 'utf8');
  const spec = JSON.parse(readFileSync(new URL('resolved-spec.json', dir), 'utf8'));
  const log = readFileSync(new URL('draft-log.jsonl', dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  // the live failure as saved: the agreed row L1.~4 was signed `built` with no part
  const saved = spec.closeDecl;
  assert.equal(saved.list.find((/** @type {any} */ r) => r.key === 'L1.~4').part, undefined);
  assert.equal(listMatchesClose({ stages: saved.stages, list: saved.list }).ok, false);
  // rebuilt from the saved page-map facts (the look) and the saved job lines, with the person's agree
  const look = JSON.parse(log.find((x) => x.label === 'page-map').raw).facts;
  const lookFacts = look.filter((/** @type {any} */ f) => f.name !== 'stops').map((/** @type {any} */ f) => ({ ...f, line: 1, source: 'flights', forRule: Number(/rule (\d+)/.exec(f.from)?.[1]) || undefined }));
  const b = new CheckBlock({ texts: { flights: text }, labels: ['flights'], split: true });
  b.fromJob(spec.jobLines.map((/** @type {any} */ l) => ({ n: l.n, text: l.text, rules: l.rules.slice(0, 3) })));
  b.addLook(lookFacts);
  b.reconcile();
  const q = b.open.find((x) => x.ruleText === 'not a red-eye');
  assert.ok(q, JSON.stringify(b.open));
  assert.deepEqual(b.applyAnswer(q.key, 'agree'), { ok: true });
  b.reconcile();
  const follower = b.rows.find((r) => r.parent);
  assert.ok(follower);
  assert.deepEqual(follower.part, b.rows.find((r) => r.key === follower.parent)?.part);
  assert.deepEqual(listMatchesClose({ stages: b.closeCache.stages, list: b.signedRows() }), { ok: true });
});
