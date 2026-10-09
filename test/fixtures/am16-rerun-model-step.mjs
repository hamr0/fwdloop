// Test-only fake `modelStep` for test/m4e-am16-records.test.js (C2). Spawned CLI children load it through FWDLOOP_TEST_MODEL_STEP.
// On every call it (1) notes whether the monthly record already names the run dir this process is spending into, and (2) books
// a $0.001 spend row into that dir, the way the live provider does. With AM16_KILL=1 the process then dies hard (SIGKILL).
import {
  appendFileSync, mkdirSync, readFileSync,
} from 'node:fs';
import { join } from 'node:path';

export default function make() {
  const dir = join(process.env.AM16_ROOT, 'job2', 'runs', 'run-1-rerun-1');
  return async function step(ctx) {
    let named = false;
    try {
      named = readFileSync(join(process.env.FWDLOOP_CONFIG_HOME, 'runs.jsonl'), 'utf8').includes('run-1-rerun-1');
    } catch { /* no record */ }
    appendFileSync(process.env.AM16_MARK, `${JSON.stringify({ named })}\n`);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'spend.jsonl'), `${JSON.stringify({ costUsd: 0.001, at: new Date().toISOString(), spendComplete: true })}\n`);
    if (process.env.AM16_KILL === '1') process.kill(process.pid, 'SIGKILL');
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    const text = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
    return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
  };
}
