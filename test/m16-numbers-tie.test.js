// M16 am3 (2), R7: the `$` numbers default ("every number in the text is in a checked quote of an earlier line"), as a close field `numbersFrom`, graded by bareguard's numbersInQuote on the quotes
// the earlier lines' cited checks passed on. $0, fake provider. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rmSync, mkdirSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { closeByClass } from '../src/closers.js';
import { quotesOfLines, writeCitedLine } from '../src/cited-record.js';
import { validateDeclaration } from '../src/declaration.js';
import { parseSignedText } from '../src/signed-text.js';
import { loadCatalogue } from '../src/catalogue.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { writeFlow } from '../src/flow.js';
import { readAudit } from '../src/books.js';
import { sendViaPrimitive } from '../src/send.js';
import { sandboxSend } from './send-sandbox.js';
import { flightsPart, goodRows, PAGE } from './fixtures/m10-map/cited-help.mjs';

const CTX = { reads: {}, businessDate: '2026-11-18', numbers: { quotes: { 1: ['Select flight "From 120 US dollars"', 'Select flight "From 99 US dollars"'] }, missing: [] } };
const step = (close = { class: 'hitl', numbersFrom: [1] }) => ({ fromLine: 2, close });

test('(R7) a text with a number no earlier quote holds is red, naming the number; a clean text is not (hitl stays hitl)', async () => {
  const bad = await closeByClass(step(), { text: 'The cheapest is 99 and the other is 120, not 75.' }, CTX);
  assert.equal(bad.verdict, 'red', 'break: make closeNumbers return green and this reds');
  assert.match(bad.red, /number\(s\) 75 that no checked quote of line 1 holds/);
  const clean = await closeByClass(step(), { text: 'The cheapest is 99 and the other is 120.' }, CTX);
  assert.equal(clean.verdict, 'hitl');
  assert.equal(clean.numbersCheck.ok, true);
});

test('(R7) the third outcomes: an answer with no text is unparseable, no record of the quotes is a crash, a line not there yet is a red; never green', async () => {
  assert.equal((await closeByClass(step(), { cells: {} }, CTX)).verdict, 'unparseable');
  assert.equal((await closeByClass(step(), { text: 'in 99' }, { ...CTX, numbers: undefined })).verdict, 'crash');
  const gone = await closeByClass(step(), { text: 'in 99' }, { ...CTX, numbers: { quotes: {}, missing: [1] } });
  assert.equal(gone.verdict, 'red');
  assert.match(gone.red, /line 1's answer is not there yet/);
});

test('(R7) beside a softgreen pick both are told when both fail; a step without numbersFrom is exactly as before', async () => {
  const both = await closeByClass(step({ class: 'softgreen', shape: { picked: [{ rule: 'maxWords', value: 3 }] }, numbersFrom: [1] }), { text: 'one two three four 75' }, CTX);
  assert.equal(both.verdict, 'red');
  assert.equal(both.reds.length, 2, 'the pick and the numbers tie are both told');
  const plain = await closeByClass({ fromLine: 2, close: { class: 'hitl' } }, { text: 'anything 75' }, CTX);
  assert.deepEqual(plain, { verdict: 'hitl', red: null });
});

test('(R7) the quotes are read from the run\'s cited record: only a PASSED line counts', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16n-'));
  try {
    writeCitedLine(base, { n: 1, passed: true, rows: [{ quote: 'fare 99' }, { quote: 'fare 120' }] });
    writeCitedLine(base, { n: 3, passed: false, rows: [{ quote: 'fare 5' }] });
    assert.deepEqual(quotesOfLines(base, [1, 3, 4]), { quotes: { 1: ['fare 99', 'fare 120'] }, missing: [3, 4] });
    assert.deepEqual(quotesOfLines(path.join(base, 'nowhere'), [1]), { quotes: {}, missing: [1] });
  } finally { rmSync(base, { recursive: true, force: true }); }
});

const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR&hl=en&curr=USD';
const PROSE = `1. List 3 flights from Amsterdam to London,
   guardrail: under $150; departure time between 05:00 and 23:59; nonstop
2. Write a short note about the prices,
3. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
4. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source flights = page:${ADDRESS}
`;
const declOf = (numbersFrom) => ({
  steps: [
    { goal: 'List 3 flights from Amsterdam to London,', primitives: [], reads: ['flights'], emits: 'flights_found', fromLine: 1, close: { class: 'green', cited: flightsPart() } },
    { goal: 'Write a short note about the prices,', primitives: ['read'], reads: ['flights_found'], emits: 'note', fromLine: 2, close: { class: 'hitl', numbersFrom } },
    { goal: 'ask 30m: check it with me,', primitives: [], reads: ['note'], emits: 'accepted', fromLine: 3, close: { class: 'hitl' } },
    { goal: 'and once I accept, write it out.', primitives: ['write'], reads: ['accepted'], emits: 'sent', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'green', 3: 'hitl' }, unjudgeable: {}, refused: [], inputFacts: {},
});

test('(R7) the validator: numbersFrom must name an EARLIER line that checks quotes', () => {
  const signed = parseSignedText(sandboxSend(PROSE));
  assert.ok(signed.ok);
  if (!signed.ok) return;
  const ctx = { arbiter: signed.arbiter, lines: signed.lines, catalogue: loadCatalogue().primitives, wired: WIRED_VERBS };
  const ok = validateDeclaration(declOf([1]), ctx);
  assert.equal(ok.ok, true, ok.ok ? '' : ok.reds.join('|'));
  const reds = (/** @type {number[]} */ n) => { const v = validateDeclaration(declOf(n), ctx); return v.ok ? '' : v.reds.join('|'); };
  assert.match(reds([3]), /numbersFrom: line 3 is not before line 2/);
  assert.match(reds([2]), /numbersFrom: line 2 is not before line 2/);
  assert.match(reds([]), /numbersFrom must be a non-empty list/);
});

/** the signed flow run once with a fake provider; the second step's text is `noteText(prices)` */
async function runWith(noteText) {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16n-run-'));
  try {
    const root = path.join(base, 'flows');
    mkdirSync(root);
    const catalogue = loadCatalogue().primitives;
    const w = writeFlow({ root, name: 'flights', proseText: sandboxSend(PROSE), declaration: declOf([1]), signedBy: 'hamr', signedAt: '2026-11-13T10:00:00Z', catalogue });
    assert.equal(w.ok, true, JSON.stringify(w.reds));
    const rows = goodRows(PAGE).slice(0, 3);
    const prices = rows.map((r) => r.values.price);
    const provider = {
      generate: async (messages) => {
        const goal = String(messages.find((m) => m.role === 'user').content);
        const args = goal.includes('Write a short note') ? { text: noteText(prices), done: true } : { results: rows, done: true };
        return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: args }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
      },
    };
    const modelStep = makeLiveModelStep({ spendPath: path.join(base, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
    const out = await runFlow({ root, name: 'flights', runId: 'run-1', catalogue, modelStep, askStep: makeParkingAskStep(), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-18', sources: [{ id: 'flights', path: ADDRESS }], fetchPage: async (url) => ({ ok: true, text: PAGE, url }) });
    return { out, audit: readAudit(path.join(root, 'flights', 'runs', 'run-1')).filter((a) => a.step === 'note') };
  } finally { rmSync(base, { recursive: true, force: true }); }
}

test('(R7) the real run path: the text line is graded on the quotes line 1 passed; a made-up number is a red try, prices from the quotes pass', async () => {
  const good = await runWith((prices) => `Fares: ${prices.join(', ')}.`);
  assert.notEqual(good.out.outcome, 'red', JSON.stringify(good.out));
  assert.ok(!good.audit.some((a) => a.verdict === 'red'), JSON.stringify(good.audit.map((a) => [a.verdict, a.gap])));
  const bad = await runWith((prices) => `Fares: ${prices.join(', ')}, and one at 7777.`);
  assert.ok(bad.audit.some((a) => a.verdict === 'red' && /7777/.test(String(a.gap))), JSON.stringify(bad.audit.map((a) => [a.verdict, a.gap])));
});
