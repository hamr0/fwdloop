// M10 piece 4 (item 2, "green grows"): the cited check - a quote word for word in the frozen text, the value in the quote, the value passes its rule,
// the result count - on F71's real saved page and its two cheat copies. $0: bareguard is the checker, no model. Each must-fail case from the signed text
// was seen red first; the forced reds are named in the commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checkCited, factPartReds, buildCitedSpec, factSentence, countSentence } from '../src/citedcheck.js';
import { CHEAT_REVERSED, FIXTURE_DIR } from './fixtures/m10-map/load.mjs';
import { flightsPart, flightRows, goodRows, PAGE, factPartFromLook } from './fixtures/m10-map/cited-help.mjs';

const PAY0 = readFileSync(`${FIXTURE_DIR}/page-ams-lhr.cheat-pay0.txt`, 'utf8');

test('3 results whose quotes are on the page and whose values pass the rules are green', async () => {
  const rows = goodRows(PAGE);
  assert.ok(rows.length >= 3, 'the real page has at least 3 flights under 150 dollars, non-stop');
  const r = await checkCited({ part: flightsPart(), text: PAGE, results: rows.slice(0, 3) });
  assert.equal(r.verdict, 'green', r.gapLines.join(' | '));
  assert.equal(r.claims.length, 3);
  assert.ok(r.evidence.length >= 3, 'what the check read comes back for the Result tab proof');
});

test('a quote that is not on the page word for word is red, named', async () => {
  const rows = goodRows(PAGE).slice(0, 3).map((r) => ({ ...r }));
  rows[1] = { ...rows[1], quote: rows[1].quote.replace('British Airways', 'Air Invented') };
  const r = await checkCited({ part: flightsPart(), text: PAGE, results: rows });
  assert.equal(r.verdict, 'red');
  assert.ok(r.gapLines.some((l) => l.startsWith('result 2: the quote is not found word for word')), r.gapLines.join('|'));
});

test('a signed label that is not in the quote is red, a signed label that reads no value is red', async () => {
  const rows = goodRows(PAGE).slice(0, 3);
  const part = flightsPart();
  const gone = { ...part, facts: part.facts.map((f) => (f.name === 'price' ? { ...f, anchor: 'Cost' } : f)) };
  const a = await checkCited({ part: gone, text: PAGE, results: rows });
  assert.equal(a.verdict, 'red');
  assert.ok(a.gapLines.some((l) => l.includes('fact "price": the label "Cost" is not in the quote')), a.gapLines.join('|'));
  // "Nonstop flight with" is in every quote, but no amount is written right after it
  const empty = { ...part, facts: part.facts.map((f) => (f.name === 'price' ? { ...f, anchor: 'Nonstop flight with' } : f)) };
  const b = await checkCited({ part: empty, text: PAGE, results: rows });
  assert.equal(b.verdict, 'red');
  assert.ok(b.gapLines.some((l) => l.includes('fact "price": the quote holds no money after "Nonstop flight with"')), b.gapLines.join('|'));
});

test('a value that fails its rule is red; a value the quote does not hold is red', async () => {
  const dear = flightRows(PAGE).find((r) => Number(r.values.price) >= 150 && /Nonstop/.test(r.quote));
  const rows = [...goodRows(PAGE).slice(0, 2), dear];
  const over = await checkCited({ part: flightsPart(), text: PAGE, results: rows });
  assert.equal(over.verdict, 'red');
  assert.ok(over.gapLines.some((l) => l.startsWith('result 3, fact "price": the value in the quote is above what the rule allows (under')), over.gapLines.join('|'));
  // a cheaper price written in "values" than the quote holds does not pass
  const lie = goodRows(PAGE).slice(0, 3).map((r, i) => (i === 0 ? { ...r, values: { ...r.values, price: '10' } } : r));
  const l = await checkCited({ part: flightsPart(), text: PAGE, results: lie });
  assert.equal(l.verdict, 'red');
  assert.ok(l.gapLines.some((x) => x.includes('the value is not what the quote holds')), l.gapLines.join('|'));
});

test('a time outside a between rule is red', async () => {
  const part = flightsPart();
  const tight = { ...part, facts: part.facts.map((f) => (f.name === 'departure time' ? { ...f, rule: { op: 'between', lo: '17:00', hi: '18:00' } } : f)) };
  const r = await checkCited({ part: tight, text: PAGE, results: goodRows(PAGE).slice(0, 3) });
  assert.equal(r.verdict, 'red');
  assert.ok(r.gapLines.some((l) => l.includes('fact "departure time"')), r.gapLines.join('|'));
});

test('the wrong result count is red, either way, and the step never writes the count', async () => {
  const rows = goodRows(PAGE);
  const few = await checkCited({ part: flightsPart(), text: PAGE, results: rows.slice(0, 2) });
  assert.equal(few.verdict, 'red');
  assert.deepEqual(few.gapLines, ['2 result(s) are listed, at least 3 are required']);
  const many = await checkCited({ part: flightsPart(), text: PAGE, results: rows.slice(0, 4) });
  assert.equal(many.verdict, 'red');
  assert.deepEqual(many.gapLines, ['4 results are listed, at most 3 are allowed']);
  // a count the step writes into its own results is not read
  const lies = await checkCited({ part: flightsPart(), text: PAGE, results: Object.assign(rows.slice(0, 2), { count: 3 }) });
  assert.equal(lies.verdict, 'red');
});

test('a "Pay $0" cheat page does not pass: the signed label "From" is not in the cheat quotes', async () => {
  const cheat = PAY0.split('\n').flatMap((l, i, L) => (/Pay \$0\./.test(l) && /Select flight"/.test(l) ? [{ quote: `${l.trim()}\n${(L[i + 1] ?? '').trim()}`, values: { price: '0', 'departure time': '9:00 AM' } }] : []));
  assert.ok(cheat.length >= 3, 'the cheat copy plants "Pay $0" flights');
  const r = await checkCited({ part: flightsPart(), text: PAY0, results: cheat.slice(0, 3) });
  assert.equal(r.verdict, 'red');
});

test('results quoted from the real page are red against a cheat copy of it (the run is checked against the text it is handed)', async () => {
  const r = await checkCited({ part: flightsPart(), text: CHEAT_REVERSED, results: goodRows(PAGE).slice(0, 3) });
  assert.equal(r.verdict, 'red');
  assert.ok(r.gapLines.every((l) => l.includes('the quote is not found word for word')), r.gapLines.join('|'));
});

test('a reversed route is red when the origin and destination are signed as the words after "Leaves" and "arrives at" (a presence phrase alone cannot tell the direction)', async () => {
  const part = flightsPart();
  const directional = {
    ...part,
    facts: part.facts.map((f) => {
      if (f.name === 'origin airport') return { name: 'origin airport', shape: 'text', anchor: 'Leaves', until: ' at' };
      if (f.name === 'destination airport') return { name: 'destination airport', shape: 'text', anchor: 'arrives at', until: ' at' };
      return f;
    }),
  };
  const fill = (rows) => rows.map((r) => ({ ...r, values: { ...r.values, 'origin airport': 'Amsterdam Airport Schiphol', 'destination airport': 'Heathrow Airport' } }));
  const real = await checkCited({ part: directional, text: PAGE, results: fill(goodRows(PAGE)).slice(0, 3) });
  assert.equal(real.verdict, 'green', real.gapLines.join('|'));
  // the same rows, as the reversed cheat page writes them: each flight leaves Heathrow and arrives at Amsterdam
  const reversed = await checkCited({ part: directional, text: CHEAT_REVERSED, results: fill(goodRows(CHEAT_REVERSED)).slice(0, 3) });
  assert.equal(reversed.verdict, 'red', 'the direction is signed, so the reversed route is not green');
  assert.ok(reversed.gapLines.some((l) => l.includes('origin airport')), reversed.gapLines.join('|'));
});

test('a reversed route is red with the look\'s own place phrases: they grew to "Leaves ..." and "arrives at ..." (M10 am7 item 2, R2; before it this passed)', async () => {
  const part = flightsPart();
  assert.deepEqual(part.facts.filter((f) => f.name.includes('airport')).map((f) => f.phrase).sort(), ['Leaves Amsterdam Airport Schiphol', 'arrives at Heathrow Airport']);
  const r = await checkCited({ part, text: CHEAT_REVERSED, results: goodRows(CHEAT_REVERSED).slice(0, 3) });
  assert.equal(r.verdict, 'red');
  assert.ok(r.gapLines.some((l) => /fact "(origin|destination) airport": the quote does not say "(Leaves Amsterdam Airport Schiphol|arrives at Heathrow Airport)"/.test(l)), r.gapLines.join('|'));
});

test('results that are not a list, or are empty, are red; a part that cannot be signed is stopped; neither is ever green', async () => {
  for (const results of [undefined, null, 'three flights', {}, []]) {
    const r = await checkCited({ part: flightsPart(), text: PAGE, results });
    assert.notEqual(r.verdict, 'green', JSON.stringify(results));
  }
  const bad = await checkCited({ part: { source: 'flights', facts: [{ name: 'price', shape: 'money' }] }, text: PAGE, results: goodRows(PAGE) });
  assert.equal(bad.verdict, 'stopped');
  assert.match(bad.fault, /money needs a unit or a currency/);
  const none = await checkCited({ part: { source: 'flights', facts: [] }, text: PAGE, results: [] });
  assert.equal(none.verdict, 'stopped');
});

test('a quote in a doc: the same check over a markdown document, a number rule and a count', async () => {
  const doc = '# Releases\n\n- v1.4.0 shipped 2026-03-02 with 12 fixes\n- v1.3.1 shipped 2026-02-11 with 3 fixes\n- v1.3.0 shipped 2026-01-20 with 40 fixes\n';
  const part = { source: 'notes', facts: [{ name: 'fixes', shape: 'number', anchor: 'with', rule: { op: 'lt', value: 50 } }], count: { min: 3, max: 3 } };
  const rows = [['v1.4.0 shipped 2026-03-02 with 12 fixes', '12'], ['v1.3.1 shipped 2026-02-11 with 3 fixes', '3'], ['v1.3.0 shipped 2026-01-20 with 40 fixes', '40']].map(([quote, fixes]) => ({ quote, values: { fixes } }));
  const ok = await checkCited({ part, text: doc, results: rows });
  assert.equal(ok.verdict, 'green', ok.gapLines.join('|'));
  const over = await checkCited({ part: { ...part, facts: [{ ...part.facts[0], rule: { op: 'gt', value: 5 } }] }, text: doc, results: rows });
  assert.equal(over.verdict, 'red');
});

test('the sentences the Result tab shows are written by code from the signed fields', () => {
  const part = flightsPart();
  assert.equal(factSentence(part.facts.find((f) => f.name === 'price'), 'flights'), 'fact · price — money in US dollars, under 150 US dollars, after "From", quoted from "flights"');
  assert.equal(factSentence(part.facts.find((f) => f.name === 'nonstop'), 'flights'), 'fact · nonstop — phrase, must say "Nonstop", quoted from "flights"');
  assert.equal(countSentence(part), 'fact · results — exactly 3 results, each quoted from "flights"');
  assert.equal(countSentence({ ...part, count: undefined }), null);
});

test('factPartFromLook keeps the first label as the anchor, the look\'s reading as the rule, and nothing else', () => {
  const part = flightsPart();
  const dep = part.facts.find((f) => f.name === 'departure time');
  assert.deepEqual(dep, { name: 'departure time', shape: 'time', anchor: 'Departure time:', rule: { op: 'between', lo: '05:00', hi: '23:59' } });
  assert.deepEqual(factPartReds(part), []);
  assert.equal(buildCitedSpec(part, 'a'.repeat(64)).checkpoints.cited.checks.length, 3, 'the cited check, a min and a max');
  assert.deepEqual(factPartFromLook([], 'x').facts, []);
});
