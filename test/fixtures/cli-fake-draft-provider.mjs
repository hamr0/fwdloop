// Test-only draft provider for bin/fwdloop's NODE_ENV=test + FWDLOOP_TEST_DRAFT_PROVIDER gate.
// FWDLOOP_TEST_DRAFT_MODE=timeout -> a validator-red round, then the provider throws ETIMEDOUT (an unpriced call).
// FWDLOOP_TEST_DRAFT_MODE=hang -> a validator-red round, then the second call never returns (a draft a test kills mid-way, M4e).
// FWDLOOP_TEST_DRAFT_MODE=greedy -> the model tries to author the cap, a send target, an ask TTL and an input path (M4e (xii)): a red draft.
// FWDLOOP_TEST_DRAFT_MODE=echo-key-die -> the provider prints $DEEPSEEK_API_KEY to stdout and stderr, then the process dies (M4e (ix)).
// FWDLOOP_TEST_DRAFT_MODE=echo-key-red -> the provider throws an error whose message carries $DEEPSEEK_API_KEY (M4e (ix)).
// M4e amendment 14: a revise is a plain fresh draft of the edited card, so there is no revise mode. Per-card test switches, read from the
// SYSTEM prompt (the job lines are in it):
//   a line containing REDMARK -> the model grants an unwired verb (a red plan); HANGMARK -> the call never returns (a draft a test watches in flight).
// FWDLOOP_TEST_DRAFT_LOG=<file> -> every provider call's messages are appended there as one JSON line (what the model was actually sent).
// FWDLOOP_TEST_DRAFT_MODE=bad -> the model always grants an unwired verb (a red draft).
import { appendFileSync } from 'node:fs';
import { RATES, MODEL, validArgs, fakeProvider, toolReply } from '../drafter-fixture.mjs';

export default function make() {
  const args = validArgs();
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'bad') args.steps[2].primitives = ['stash'];
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'greedy') {
    Object.assign(args, { capUsd: 99, sends: [{ line: 1, target: 'file:/etc' }], asks: [{ line: 4, ttlMs: 1 }], sources: [{ role: 'x', path: '/etc/passwd' }] });
  }
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'echo-key-die' || process.env.FWDLOOP_TEST_DRAFT_MODE === 'echo-key-red') {
    const provider = fakeProvider([toolReply(args)]);
    provider.generate = async () => {
      const key = process.env.DEEPSEEK_API_KEY;
      if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'echo-key-red') throw new Error(`upstream rejected key ${key}`);
      process.stdout.write(`PROVIDER-ECHO key=${key}\n`);
      process.stderr.write(`PROVIDER-ECHO key=${key}\n`);
      process.exit(3);
    };
    return { provider, rates: RATES, modelId: MODEL };
  }
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'hang') {
    args.steps[2].primitives = ['stash'];
    const provider = fakeProvider([toolReply(args)]);
    const gen = provider.generate.bind(provider);
    provider.generate = async (...a) => {
      if (provider.calls.length >= 1) return new Promise((r) => { setTimeout(r, 3_600_000); });
      return gen(...a);
    };
    return { provider, rates: RATES, modelId: MODEL };
  }
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'timeout') {
    args.steps[2].primitives = ['stash'];
    const provider = fakeProvider([toolReply(args)]);
    const gen = provider.generate.bind(provider);
    provider.generate = async (...a) => {
      if (provider.calls.length >= 1) throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
      return gen(...a);
    };
    return { provider, rates: RATES, modelId: MODEL };
  }
  const redArgs = validArgs();
  redArgs.steps[2].primitives = ['stash'];
  const provider = fakeProvider([toolReply(args)]);
  const gen = provider.generate.bind(provider);
  provider.generate = async (messages, ...rest) => {
    if (process.env.FWDLOOP_TEST_DRAFT_LOG) appendFileSync(process.env.FWDLOOP_TEST_DRAFT_LOG, `${JSON.stringify(messages)}\n`);
    const system = String(messages.find((m) => m.role === 'system')?.content ?? '');
    if (system.includes('HANGMARK')) return new Promise((r) => { setTimeout(r, 3_600_000); });
    if (system.includes('REDMARK')) return toolReply(redArgs);
    return gen(messages, ...rest);
  };
  return { provider, rates: RATES, modelId: MODEL };
}
