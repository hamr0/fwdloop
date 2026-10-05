// POC fake draft provider (FWDLOOP_TEST_DRAFT_PROVIDER module). Modes via POC_DRAFT_MODE:
//   ok (default) | slow (sleeps POC_DRAFT_SLEEP_MS before answering) | echo (prints the key to stdout+stderr, then ok)
import { RATES, MODEL, validArgs, fakeProvider, toolReply } from '../../test/drafter-fixture.mjs';

export default function make() {
  const provider = fakeProvider([toolReply(validArgs())]);
  const mode = process.env.POC_DRAFT_MODE ?? 'ok';
  const gen = provider.generate.bind(provider);
  provider.generate = async (...a) => {
    if (mode === 'echo') {
      process.stdout.write(`PROVIDER-ECHO key=${process.env.DEEPSEEK_API_KEY}\n`);
      process.stderr.write(`PROVIDER-ECHO key=${process.env.DEEPSEEK_API_KEY}\n`);
    }
    if (mode === 'slow') await new Promise((r) => { setTimeout(r, Number(process.env.POC_DRAFT_SLEEP_MS ?? 8000)); });
    return gen(...a);
  };
  return { provider, rates: RATES, modelId: MODEL };
}
