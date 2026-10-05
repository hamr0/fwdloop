// Test-only fake `modelStep` (FWDLOOP_TEST_MODEL_STEP, NODE_ENV=test) that holds the run alive until the file named
// by M4D_RELEASE_FILE exists, then behaves like the CLI's fake step. $0, no network. Lets a test keep two real
// `fwdloop run` processes alive at the same moment (the monthly check's race).
import { existsSync } from 'node:fs';
import makeCliFakeModelStep from './cli-fake-model-step.mjs';

export default function make(deps) {
  const inner = makeCliFakeModelStep(deps);
  return async function blockedStep(ctx) {
    const deadline = Date.now() + 60_000;
    while (!existsSync(process.env.M4D_RELEASE_FILE) && Date.now() < deadline) {
      await new Promise((r) => { setTimeout(r, 25); });
    }
    return inner(ctx);
  };
}
