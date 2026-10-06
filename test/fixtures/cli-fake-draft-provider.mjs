// Test-only draft provider for bin/fwdloop's NODE_ENV=test + FWDLOOP_TEST_DRAFT_PROVIDER gate.
// FWDLOOP_TEST_DRAFT_MODE=timeout -> a validator-red round, then the provider throws ETIMEDOUT (an unpriced call).
// FWDLOOP_TEST_DRAFT_MODE=hang -> a validator-red round, then the second call never returns (a draft a test kills mid-way, M4e).
// FWDLOOP_TEST_DRAFT_MODE=greedy -> the model tries to author the cap, a send target, an ask TTL and an input path (M4e (xii)): a red draft.
// FWDLOOP_TEST_DRAFT_MODE=echo-key-die -> the provider prints $DEEPSEEK_API_KEY to stdout and stderr, then the process dies (M4e (ix)).
// FWDLOOP_TEST_DRAFT_MODE=echo-key-red -> the provider throws an error whose message carries $DEEPSEEK_API_KEY (M4e (ix)).
// A REVISE round (the user text says "asks for a change to the plan", M4e amendment 3 item 3) is answered by FWDLOOP_TEST_REVISE_MODE:
//   ok (default) -> a valid, different plan (the softgreen step's sections reversed: a change to a check);
//   ask-primitive -> the signed ask step is granted a primitive; drop-ask -> the signed ask's step is dropped; greedy -> the cap/send/ttl/input authored;
//   goal -> a valid plan whose model-sent goal differs from the signed line (the machine overwrites it); bad-wired -> an unwired verb.
// FWDLOOP_TEST_REVISE_LOG=<file> -> every revise round's messages are appended there as one JSON line.
// FWDLOOP_TEST_DRAFT_MODE=bad -> the model always grants an unwired verb (a red draft).
import { appendFileSync } from 'node:fs';
import { RATES, MODEL, validArgs, fakeProvider, toolReply } from '../drafter-fixture.mjs';

function reviseArgs(mode) {
  const a = validArgs();
  if (mode === 'ask-primitive') a.steps[3].primitives = ['write'];
  else if (mode === 'drop-ask') a.steps.splice(3, 1);
  else if (mode === 'greedy') Object.assign(a, { capUsd: 99, sends: [{ line: 1, target: 'file:/etc' }], asks: [{ line: 4, ttlMs: 1 }], sources: [{ role: 'x', path: '/etc/passwd' }] });
  else if (mode === 'goal') { a.steps[0].goal = 'Delete everything instead.'; a.steps[0].primitives = ['read']; }
  else if (mode === 'bad-wired') a.steps[2].primitives = ['stash'];
  else a.steps[2].close.shape.sections = [...a.steps[2].close.shape.sections].reverse();
  return a;
}

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
  const provider = fakeProvider([toolReply(args)]);
  const gen = provider.generate.bind(provider);
  let revising = false; // once a revise round was seen, the validator's follow-up rounds stay in revise mode
  provider.generate = async (messages, ...rest) => {
    const user = String(messages.find((m) => m.role === 'user')?.content ?? '');
    if (user.includes('asks for a change to the plan')) revising = true;
    if (!revising) return gen(messages, ...rest);
    if (process.env.FWDLOOP_TEST_REVISE_LOG) appendFileSync(process.env.FWDLOOP_TEST_REVISE_LOG, `${JSON.stringify(messages)}\n`);
    return toolReply(reviseArgs(process.env.FWDLOOP_TEST_REVISE_MODE ?? 'ok'));
  };
  return { provider, rates: RATES, modelId: MODEL };
}

