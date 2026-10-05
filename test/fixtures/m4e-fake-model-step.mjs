// Test-only fake `modelStep` for the M4e tests, matching the job #2 prose the M4e fixtures draft
// (test/fixtures/job2-m6a.prose.txt: goals are the signed lines verbatim). $0, no network. Like the real model
// step it books one priced row per call in the run's own spend ledger (`spendPath`), so a test can tell a run's
// spend from a draft's.
import { appendSpendRow } from '../../src/provider.js';

export default function make({ spendPath } = {}) {
  const book = () => {
    if (spendPath) {
      appendSpendRow(spendPath, {
        kind: 'step', provider: 'deepseek', model: 'deepseek-flash', modelReturned: 'deepseek-flash', costUsd: 0.001, rounds: 1, calls: 1, spendComplete: true,
      });
    }
  };
  return async function fakeModelStep(ctx) {
    book();
    if (ctx.goal.startsWith('Read my resume')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('read the JD')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('summary resume')) {
      const text = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    return { ok: false, red: `m4e-fake-model-step: unexpected goal "${ctx.goal}"`, costUsd: 0 };
  };
}
