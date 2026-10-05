// Lives outside test/ on purpose (see walk-root.mjs). A test-only fake `modelStep` for the walk root's `run-gap`
// run: the same $0, no-network shape as test/fixtures/cli-fake-model-step.mjs, except the summary step's FIRST attempt
// returns a draft with two of the three signed sections missing, so the REAL shape closer fails it and the REAL
// runner writes the audit row (verdict red, the closer's own gap text, the tools and refused list recorded below);
// the retry carries `ctx.gap` and returns a good draft. Nothing in the books is hand-written.
export default function makeWalkGapModelStep() {
  return async function walkGapModelStep(ctx) {
    if (ctx.goal.includes('resume .docx')) {
      return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    }
    if (ctx.goal.includes('job description markdown')) {
      return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    }
    if (ctx.goal.includes('Draft the summary resume')) {
      const base = {
        costUsd: 0.002, model: 'deepseek-flash', tokens: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0 },
      };
      if (!ctx.gap) {
        return {
          ok: true,
          ...base,
          tools: { read: 2, grep: 1 },
          refused: [{ verb: 'write', path: '/etc/hosts', rule: 'writeScope: only out/ may be written' }],
          artifact: { text: '## summary of work history blurb\nworked places.', done: true },
        };
      }
      const text = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
      return { ok: true, ...base, tools: { read: 1 }, refused: [], artifact: { text, done: true } };
    }
    return { ok: false, red: `walk-gap-model-step: unexpected goal "${ctx.goal}"`, costUsd: 0 };
  };
}
