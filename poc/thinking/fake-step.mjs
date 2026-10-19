// POC (throwaway, never shipped): the $0 stand-in for a live model. Loaded through the CLI's own test hook
//   NODE_ENV=test FWDLOOP_TEST_MODEL_STEP=<this file>   (the engine copy's bin/fwdloop honours it)
// It builds the ENGINE COPY's makeLiveModelStep around a fake provider, so the patched code path (thinkingMode into
// loop.run, the call recorder) is the one that runs. Fake behaviour, by env:
//   FWDLOOP_POC_FAKE_FAIL_FIRST=1  the first model call of every step emits done:false (a red), so attempt 2 happens
//   FWDLOOP_POC_FAKE_STATUS=<s>    the thinkingStatus the fake reports (default 'applied')
import { makeLiveModelStep } from './engine/src/model-step.js';

const WORDS = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');

export function makeFakeProvider({ failFirst = false, status = 'applied' } = {}) {
  const seen = new Set();
  return {
    model: 'deepseek-flash',
    generate: async (messages, tools, options) => {
      const last = messages.at(-1);
      const emit = (tools ?? []).find((t) => t.name === 'emit_artifact');
      const usage = { inputTokens: 1000, outputTokens: 500 };
      const base = { usage, model: 'deepseek-flash', thinkingStatus: options && options.thinkingMode ? status : undefined };
      if (last?.role === 'tool' || !emit) return { ...base, text: 'done', toolCalls: [], stopReason: 'stop' };
      const props = Object.keys(emit.parameters?.properties ?? {});
      let goal = 'step';
      try { goal = JSON.parse(messages.find((m) => m.role === 'user').content).goal; } catch { /* keep default */ }
      const first = !seen.has(goal);
      seen.add(goal);
      let args;
      if (failFirst && first) args = { ...(props.includes('text') ? { text: 'x' } : { fields: {} }), done: false, blocker: 'fake: first call fails' };
      else if (props.includes('fields')) args = { fields: {}, done: true, blocker: null };
      else args = { text: WORDS, done: true, blocker: null };
      return { ...base, text: null, toolCalls: [{ id: `t-${Math.random().toString(36).slice(2)}`, name: 'emit_artifact', arguments: args }], stopReason: 'tool_calls' };
    },
  };
}

export default async function ({ spendPath }) {
  return makeLiveModelStep({
    spendPath,
    provider: makeFakeProvider({ failFirst: process.env.FWDLOOP_POC_FAKE_FAIL_FIRST === '1', status: process.env.FWDLOOP_POC_FAKE_STATUS || 'applied' }),
    rates: { in: 0.001, out: 0.002 },
    modelId: 'deepseek-flash',
  });
}
