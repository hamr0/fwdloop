// Test-only draft provider for bin/fwdloop's NODE_ENV=test + FWDLOOP_TEST_DRAFT_PROVIDER gate.
// FWDLOOP_TEST_DRAFT_MODE=timeout -> a validator-red round, then the provider throws ETIMEDOUT (an unpriced call).
// FWDLOOP_TEST_DRAFT_MODE=hang -> a validator-red round, then the second call never returns (a draft a test kills mid-way, M4e).
// FWDLOOP_TEST_DRAFT_MODE=bad -> the model always grants an unwired verb (a red draft).
import { RATES, MODEL, validArgs, fakeProvider, toolReply } from '../drafter-fixture.mjs';

export default function make() {
  const args = validArgs();
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'bad') args.steps[2].primitives = ['stash'];
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
  return { provider: fakeProvider([toolReply(args)]), rates: RATES, modelId: MODEL };
}
