// M10 am28 (docs/wiki/the-module-ladder.md): a page-quoting step whose line carries picks is told each pick (values only) beside its fact rules. $0, fake provider.
// Each Must fail case was seen red on the old code first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rmSync, mkdirSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { makeLiveModelStep } from '../src/model-step.js';
import { citedBrief, toldPicks } from '../src/citedcheck.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { sendViaPrimitive } from '../src/send.js';
import { sandboxSend } from './send-sandbox.js';
import { flightsPart, PAGE } from './fixtures/m10-map/cited-help.mjs';

const LIST3 = { rule: 'listItems', value: 3 };
const WORDS80 = { rule: 'maxWords', value: 80 };

/** the user message one step call sends, parsed */
async function briefOf(stepMeta, goal = 'List 3 flights, nonstop, under $150') {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am28-'));
  try {
    const sent = [];
    const provider = {
      generate: async (messages) => {
        sent.push(JSON.parse(JSON.stringify(messages)));
        return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { results: [], done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
      },
    };
    const step = makeLiveModelStep({ spendPath: path.join(dir, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
    await step({ goal, primitives: [], reads: { flights: { kind: 'text', text: PAGE } }, gap: null }, {}, stepMeta);
    return sent[0].find((m) => m.role === 'user').content;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('(1) a page-quoting step with picks is told each pick: both, and a single one', async () => {
  const part = flightsPart();
  const both = JSON.parse(await briefOf({ class: 'green', cited: part, picked: [LIST3, WORDS80] }));
  assert.deepEqual(both.quoting.yourTextHas, [
    'Your "text" must have exactly 3 list items; a list item is its own line starting with "1." or "- " followed by a space and its text.',
    'Your "text" must have at most 80 words.',
  ]);
  const one = JSON.parse(await briefOf({ class: 'green', cited: part, picked: [WORDS80] }));
  assert.deepEqual(one.quoting.yourTextHas, ['Your "text" must have at most 80 words.']);
  assert.deepEqual(toldPicks([LIST3]).length, 1);
});

test('(2) the told picks carry no verdict and no guardrail that is not a pick: the fact rules stay as today, the line\'s own words are not added', async () => {
  const part = flightsPart();
  const user = JSON.parse(await briefOf({ class: 'green', cited: part, picked: [WORDS80] }));
  const { yourTextHas, ...rest } = user.quoting;
  assert.deepEqual(rest, citedBrief(part), 'everything but the told picks is exactly the fact brief');
  assert.equal(yourTextHas.length, 1, 'one line for the one pick, nothing else');
  const told = JSON.stringify(yourTextHas);
  assert.doesNotMatch(told, /nonstop|150|under|red|not met|found|fail/i);
});

test('(3) no picks, or no page-quoting step: the brief is byte-identical to today', async () => {
  const part = flightsPart();
  const todayRaw = JSON.stringify({ ...JSON.parse(await briefOf({ class: 'green', cited: part })) });
  for (const picked of [null, []]) {
    assert.equal(await briefOf({ class: 'green', cited: part, picked }), await briefOf({ class: 'green', cited: part }));
  }
  assert.equal('yourTextHas' in JSON.parse(todayRaw).quoting, false);
  // a step with picks that does not quote a page (no cited part) is unchanged: am28 covers page-quoting steps only
  const bare = await briefOf({ class: 'softgreen', cited: null });
  assert.equal(await briefOf({ class: 'softgreen', cited: null, picked: [LIST3, WORDS80] }), bare);
  assert.equal(await briefOf({ class: 'hitl', cited: null, picked: [WORDS80] }), await briefOf({ class: 'hitl', cited: null }));
  assert.equal(bare.includes('yourTextHas'), false);
});

test('(1) through the runner\'s real step path: a signed green cited line with close.picked reaches the provider call told its picks; without picks it is not', async () => {
  const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR&hl=en&curr=USD';
  const fetchPage = async (url) => ({ ok: true, text: PAGE, url });
  const catalogue = loadCatalogue().primitives;
  /** @param {any[]|null} picked @returns {Promise<any[]>} the user messages the provider got for the cited step */
  async function sentFor(picked) {
    const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-am28-run-'));
    try {
      const root = path.join(base, 'flows');
      mkdirSync(root);
      const prose = sandboxSend(`1. List 3 flights from Amsterdam to London,
   guardrail: under $150; departure time between 05:00 and 23:59; nonstop
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source flights = page:${ADDRESS}
`);
      const declaration = {
        steps: [
          { goal: 'List 3 flights from Amsterdam to London,', primitives: [], reads: ['flights'], emits: 'flights_found', fromLine: 1, close: { class: 'green', cited: flightsPart(), ...(picked ? { picked } : {}) } },
          { goal: 'ask 30m: check it with me,', primitives: [], reads: ['flights_found'], emits: 'accepted', fromLine: 2, close: { class: 'hitl' } },
          { goal: 'and once I accept, write it out.', primitives: ['write'], reads: ['accepted'], emits: 'sent', fromLine: 3, close: { class: 'hitl' } },
        ],
        guardrailClasses: { 1: 'green', 2: 'hitl' },
        unjudgeable: {},
        refused: [],
        inputFacts: {},
        ...(picked ? { pickedLines: [1] } : {}),
      };
      const w = writeFlow({ root, name: 'flights', proseText: prose, declaration, signedBy: 'hamr', signedAt: '2026-10-20T10:00:00Z', catalogue });
      assert.equal(w.ok, true, JSON.stringify(w.reds));
      const sent = [];
      const provider = {
        generate: async (messages) => {
          sent.push(JSON.parse(messages.find((m) => m.role === 'user').content));
          return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { results: [], done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
        },
      };
      const modelStep = makeLiveModelStep({ spendPath: path.join(base, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
      await runFlow({ root, name: 'flights', runId: 'run-1', catalogue, modelStep, askStep: makeParkingAskStep(), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-18', sources: [{ id: 'flights', path: ADDRESS }], fetchPage });
      return sent.filter((u) => u.quoting);
    } finally { rmSync(base, { recursive: true, force: true }); }
  }
  const withPicks = await sentFor([LIST3, WORDS80]);
  assert.ok(withPicks.length >= 1, 'the cited step reached the provider');
  assert.deepEqual(withPicks[0].quoting.yourTextHas, toldPicks([LIST3, WORDS80]));
  const none = await sentFor(null);
  assert.ok(none.length >= 1);
  assert.equal('yourTextHas' in none[0].quoting, false);
});
