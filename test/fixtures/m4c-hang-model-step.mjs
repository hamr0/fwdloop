// Test-only fake `modelStep` (FWDLOOP_TEST_MODEL_STEP, NODE_ENV=test) that never
// returns: the run stays alive mid-step so a test can watch the real process,
// then SIGKILL it. $0, no network. The timer just keeps the loop alive.
export default function makeHangModelStep() {
  return async function hangModelStep() {
    await new Promise((resolve) => { setTimeout(resolve, 120_000); });
    return { ok: false, red: 'm4c-hang-model-step: released', costUsd: 0 };
  };
}
