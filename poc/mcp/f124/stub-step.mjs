// F124 test stub for FWDLOOP_TEST_MODEL_STEP: books $0.001 and answers done:false (the run ends fast, never skipped). $0, no network.
import { appendSpendRow } from '../../../src/provider.js';

export default function make({ spendPath } = {}) {
  return async function stubStep() {
    if (spendPath) appendSpendRow(spendPath, { kind: 'step', provider: 'deepseek', model: 'deepseek-flash', modelReturned: 'deepseek-flash', costUsd: 0.001, rounds: 1, calls: 1, spendComplete: true });
    return { ok: true, costUsd: 0.001, artifact: { text: 'stub', done: false, blocker: 'stopped for F124' } };
  };
}
