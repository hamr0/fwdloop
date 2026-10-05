// POC fake modelStep (FWDLOOP_TEST_MODEL_STEP module): the stub modelStep; sleeps POC_STEP_SLEEP_MS per step
// and (POC_STEP_MODE=echo) writes DEEPSEEK_API_KEY to stdout/stderr once.

export default function make() {
  let echoed = false;
  return async (ctx) => {
    if (process.env.POC_STEP_MODE === 'echo' && !echoed) {
      echoed = true;
      process.stdout.write(`STEP-ECHO key=${process.env.DEEPSEEK_API_KEY}\n`);
      process.stderr.write(`STEP-ECHO key=${process.env.DEEPSEEK_API_KEY}\n`);
    }
    await new Promise((r) => { setTimeout(r, Number(process.env.POC_STEP_SLEEP_MS ?? 0)); });
    // The drafter writes the signed prose line verbatim as each goal, so no goal text can be matched: every step gets the
    // job2 summary text (it satisfies the 3-sections close; the read steps accept any non-empty text).
    const text = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
    return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
  };
}
