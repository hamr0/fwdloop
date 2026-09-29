// Test-only draft provider for bin/fwdloop's NODE_ENV=test + FWDLOOP_TEST_DRAFT_PROVIDER gate.
// FWDLOOP_TEST_DRAFT_MODE=bad -> the model always grants an unwired verb (a red draft).
import { RATES, MODEL, validArgs, fakeProvider, toolReply } from '../drafter-fixture.mjs';

export default function make() {
  const args = validArgs();
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'bad') args.steps[2].primitives = ['stash'];
  return { provider: fakeProvider([toolReply(args)]), rates: RATES, modelId: MODEL };
}
