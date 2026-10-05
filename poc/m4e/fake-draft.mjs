// POC fake draft provider (FWDLOOP_TEST_DRAFT_PROVIDER module). Modes via POC_DRAFT_MODE:
//   ok (default) | slow (sleeps POC_DRAFT_SLEEP_MS before answering) | quote (the key goes into the step-0 goal: the drafter overwrites goals with the signed line, so it is dropped) | quote-emits (key appended to step-0 `emits`: a red declaration) | echo (prints the key to stdout+stderr, then ok)
import { RATES, MODEL, validArgs, fakeProvider, toolReply } from '../../test/drafter-fixture.mjs';

export default function make() {
  const args = validArgs();
  if ((process.env.POC_DRAFT_MODE ?? 'ok') === 'quote') args.steps[0].goal += ` ${process.env.DEEPSEEK_API_KEY}`; // a model that quotes the key into its output
  if ((process.env.POC_DRAFT_MODE ?? 'ok') === 'quote-emits') args.steps[0].emits += `-${process.env.DEEPSEEK_API_KEY}`;
  const provider = fakeProvider([toolReply(args)]);
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
