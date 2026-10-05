// POC fake modelStep (FWDLOOP_TEST_MODEL_STEP module): the job2 fake from test/fixtures, but sleeps POC_STEP_SLEEP_MS per step
// and (POC_STEP_MODE=echo) writes DEEPSEEK_API_KEY to stdout/stderr once.
import inner from '../../test/fixtures/cli-fake-model-step.mjs';

export default function make() {
  const step = inner();
  let echoed = false;
  return async (ctx) => {
    if (process.env.POC_STEP_MODE === 'echo' && !echoed) {
      echoed = true;
      process.stdout.write(`STEP-ECHO key=${process.env.DEEPSEEK_API_KEY}\n`);
      process.stderr.write(`STEP-ECHO key=${process.env.DEEPSEEK_API_KEY}\n`);
    }
    await new Promise((r) => { setTimeout(r, Number(process.env.POC_STEP_SLEEP_MS ?? 0)); });
    return step(ctx);
  };
}
