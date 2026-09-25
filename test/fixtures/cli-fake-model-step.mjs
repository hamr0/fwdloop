// Test-only fake `modelStep` the CLI's own test-only escape hatch
// (`FWDLOOP_TEST_MODEL_STEP`, gated by `NODE_ENV==='test'` — see
// `bin/fwdloop`'s `resolveModelStep`) loads in place of the live provider.
// $0, no network, matches job #2's three model-backed steps by goal text —
// exactly `test/park-resume.test.js`'s own `makeJob2ModelStep`, just
// import-able by path since a spawned CLI child process can't share this
// process's in-memory function.

export default function makeCliFakeModelStep() {
  return async function fakeModelStep(ctx) {
    if (ctx.goal.includes('resume .docx')) {
      return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    }
    if (ctx.goal.includes('job description markdown')) {
      return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    }
    if (ctx.goal.includes('Draft the summary resume')) {
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    return { ok: false, red: `cli-fake-model-step: unexpected goal "${ctx.goal}"`, costUsd: 0 };
  };
}
