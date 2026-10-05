// Test-only fake `modelStep` (FWDLOOP_TEST_MODEL_STEP, NODE_ENV=test): the M4e fake step, but it waits until the file named
// by FWDLOOP_TEST_GATE exists before it answers — so a test can hold a real run "working", restart the panel, then release it
// and watch it park at its ask. $0, no network.
import { existsSync } from 'node:fs';
import make from './m4e-fake-model-step.mjs';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export default function makeGated(a) {
  const step = make(a);
  return async function gatedStep(ctx) {
    while (!existsSync(String(process.env.FWDLOOP_TEST_GATE))) await sleep(40); // eslint-disable-line no-await-in-loop
    return step(ctx);
  };
}
