// M4e amendment 7 item 8 POC — $0, fake provider, no key. Never shipped.
// Riskiest assumption: a stop can be read BEFORE every model call (each turn inside bare-agent's Loop, and each new Loop = a new try)
// without losing the in-flight call's metering. Seam under test: Loop's own `assemble(msgs, ctx)` option, which runs before every
// provider.generate (round 0 included) and whose thrown HaltError is a clean return `error: 'halt:<rule>'`, not a throw.
// Run: node poc/m4e-am7/proto.mjs   (PASS/FAIL per row, exit 1 on a FAIL)
import { Loop } from 'bare-agent';
import { HaltError } from 'bare-agent/errors';

let fails = 0;
const row = (id, ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${msg}`); if (!ok) fails += 1; };

function makeRun({ stopAfterCall, emitOnCall }) {
  const state = { stop: false, calls: 0, metered: [], artifact: undefined };
  const provider = {
    generate: async () => {
      state.calls += 1;
      if (state.calls === stopAfterCall) state.stop = true; // the human clicks Stop while this call is in flight
      const emit = state.calls === emitOnCall;
      if (state.calls > emitOnCall) return { text: '', toolCalls: [], stopReason: 'stop', model: 'fake', usage: { inputTokens: 10, outputTokens: 5 } };
      return {
        text: '', stopReason: 'tool_calls', model: 'fake',
        usage: { inputTokens: 100, outputTokens: 50 },
        toolCalls: [emit
          ? { id: `t${state.calls}`, name: 'emit_artifact', arguments: { text: 'x' } }
          : { id: `t${state.calls}`, name: 'look', arguments: {} }],
      };
    },
  };
  const tools = [
    { name: 'look', description: 'a primitive', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true }) },
    { name: 'emit_artifact', description: 'emit', parameters: { type: 'object', properties: { text: { type: 'string' } } }, execute: async (a) => { state.artifact = a; return { ok: true }; } },
  ];
  const loop = new Loop({
    provider,
    rates: { in: 0.001, out: 0.002 },
    onLlmResult: async (ev) => { state.metered.push(ev); },
    assemble: async (msgs) => { if (state.stop) throw new HaltError('stop requested', { rule: 'stop-requested' }); return msgs; },
  });
  return { state, loop, tools };
}

// P1: stop lands during the first call (a tool-using turn). Exactly one call made, it is metered, the loop returns cleanly.
{
  const { state, loop, tools } = makeRun({ stopAfterCall: 1, emitOnCall: 3 });
  const r = await loop.run([{ role: 'user', content: 'go' }], tools, { maxTokens: 100 });
  row('p1.a', state.calls === 1, `provider called ${state.calls}x (must be 1: the in-flight call, nothing new)`);
  row('p1.b', r.error === 'halt:stop-requested', `clean return, error=${r.error}`);
  row('p1.c', state.metered.length === 1 && state.metered[0].usage?.inputTokens === 100, `in-flight call metered once via onLlmResult (${state.metered.length})`);
  row('p1.d', r.metrics?.costUsd > 0, `metrics.costUsd=${r.metrics?.costUsd} (the in-flight call is priced)`);
}
// P2: control — no stop: three calls run, artifact emitted on the third.
{
  const { state, loop, tools } = makeRun({ stopAfterCall: 0, emitOnCall: 3 });
  const r = await loop.run([{ role: 'user', content: 'go' }], tools, { maxTokens: 100 });
  row('p2', state.calls >= 3 && state.artifact?.text === 'x' && r.error !== 'halt:stop-requested', `without a stop: ${state.calls} calls, artifact captured`);
}
// P3: stop lands during the EMIT turn: the artifact is captured (tool body runs), and no further (wasted) call starts.
{
  const { state, loop, tools } = makeRun({ stopAfterCall: 2, emitOnCall: 2 });
  const r = await loop.run([{ role: 'user', content: 'go' }], tools, { maxTokens: 100 });
  row('p3.a', state.calls === 2, `${state.calls} calls: nothing after the emit turn`);
  row('p3.b', state.artifact?.text === 'x', 'the emitted artifact survives (the step can close; the after-step seam then ends the run)');
  row('p3.c', r.error === 'halt:stop-requested', `loop reports the stop (${r.error}); caller must prefer the captured artifact`);
}
// P4: a stop already pending before a new Loop (a new try): zero provider calls.
{
  const { state, loop, tools } = makeRun({ stopAfterCall: 0, emitOnCall: 1 });
  state.stop = true;
  const r = await loop.run([{ role: 'user', content: 'go' }], tools, { maxTokens: 100 });
  row('p4', state.calls === 0 && r.error === 'halt:stop-requested' && state.metered.length === 0, `pending stop: ${state.calls} calls, ${state.metered.length} metered`);
}
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
