// F154 (PAID, pre-registered in docs/logs/FINDINGS.md before any run)
// Question: for signed M13 am8 (code adds the door), when the real drafter is handed a job whose end was added by code,
// does every line the person wrote become a step, with the added Ask after it and the added `write it out` as the send?
// Hand-written prose equal to what code will add; the real `fwdloop draft` (plain flow), no src change.
// Job X (F153's walk-9 job + added Ask + write it out, send at line 5), N=10. Job Y (already ends in an Ask + write it out, send at line 4), N=5.
// Run by hamr, key already in the environment (never read from `pass` here, never printed).
// Usage: F154_OUT=/abs/new/folder [F154_KEY_NAME=FIREWORKS_API_KEY] [F154_MODEL=...] node poc/m13-am8/f154.mjs
// Refuses at $0 (exit 2, before any draft) on a bad setting, an empty key, or an F154_OUT that is missing or already exists.
// Aborts when the cumulative spend passes $0.20.
import { spawnSync } from 'node:child_process';
import {
  readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync,
} from 'node:fs';
import { join, resolve, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const refuse = (m) => { console.error(`F154: ${m} Refused at $0, no draft started.`); process.exit(2); };
const keyName = process.env.F154_KEY_NAME ?? 'FIREWORKS_API_KEY';
if (!/^[A-Z][A-Z0-9_]*_KEY$/.test(keyName)) refuse(`F154_KEY_NAME "${keyName}" is not a key name (NAME_KEY).`);
const outEnv = process.env.F154_OUT;
if (!outEnv) refuse('F154_OUT is not set (an absolute path to a new folder).');
if (!isAbsolute(outEnv)) refuse('F154_OUT must be an absolute path.');
if (existsSync(outEnv)) refuse(`F154_OUT already exists (${outEnv}); never overwritten, use a new folder.`);
if (typeof process.env[keyName] !== 'string' || process.env[keyName].trim() === '') refuse(`${keyName} is empty or not set in the environment.`);

const work = resolve(outEnv);
const model = process.env.F154_MODEL ?? 'accounts/fireworks/models/deepseek-v4p1-flash';
const provider = process.env.F154_PROVIDER; // only when two keys tick the same model id
const LIMIT = 0.20;
const NOTES = '/home/hamr/fwdloop-walk/m14-garden-notes.md';
mkdirSync(join(work, 'root'), { recursive: true });
mkdirSync(join(work, 'send'), { recursive: true });

const tail = (sendLine) => `
Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.6 per run
guardrail: send at line ${sendLine} to file:${join(work, 'send')}
guardrail: source notes = file:${NOTES}
`;
const JOBS = {
  X: {
    n: 10,
    prose: `1. Write 3 lines about my garden from the notes
2. ask 1h: check it with me
3. Write one line about the weather from the notes
4. ask 1h: check the result with me
5. write it out
${tail(5)}`,
  },
  Y: {
    n: 5,
    prose: `1. Write 3 lines about my garden from the notes
2. Write one line about the weather from the notes
3. ask 1h: check it with me
4. write it out
${tail(4)}`,
  },
};

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const trunc = (s, n = 160) => { const t = typeof s === 'string' ? s : JSON.stringify(s); return t.length > n ? `${t.slice(0, n)}...` : t; };
const hasWrite = (s) => Array.isArray(s?.primitives) && s.primitives.includes('write');
const isAsk = (s) => Array.isArray(s?.primitives) && s.primitives.length === 0;
const emitsOf = (s) => (s?.emits == null ? [] : [].concat(s.emits));
const readsOf = (s) => (Array.isArray(s?.reads) ? s.reads : []);
const readsEmitOf = (send, prev) => emitsOf(prev).some((e) => readsOf(send).includes(e));
const at = (steps, line) => steps.filter((s) => s.fromLine === line);

// the criteria are fixed in the pre-registration; anything else is a miss
function judge(job, ok, refusedLines, steps) {
  if (!ok || refusedLines.length > 0) return false;
  if (job === 'X') {
    const s1 = at(steps, 1); const s3 = at(steps, 3); const s4 = at(steps, 4); const s5 = at(steps, 5);
    return s1.length > 0 && s3.length > 0 && !s3.some(hasWrite)
      && s4.length > 0 && s4.every(isAsk)
      && s5.length > 0 && s5.some((s) => hasWrite(s) && s4.some((a) => readsEmitOf(s, a)));
  }
  const s1 = at(steps, 1); const s2 = at(steps, 2); const s3 = at(steps, 3); const s4 = at(steps, 4);
  return s1.length > 0 && !s1.some(hasWrite) && s2.length > 0 && !s2.some(hasWrite)
    && s3.length > 0 && s3.every(isAsk)
    && s4.length > 0 && s4.some((s) => hasWrite(s) && s3.some((a) => readsEmitOf(s, a)));
}

let spent = 0;
let aborted = false;
const rows = [];
for (const [job, spec] of Object.entries(JOBS)) {
  for (let n = 1; n <= spec.n; n += 1) {
    if (spent > LIMIT) { aborted = true; console.log('ABORT: spend guard', spent); break; }
    const id = `${job}${n}`;
    const proseFile = join(work, `prose-${id}.txt`);
    writeFileSync(proseFile, spec.prose);
    const out = join(work, `draft-${id}`);
    const argv = ['draft', proseFile, '--out', out, '--root', join(work, 'root'), '--name', `f154-${id.toLowerCase()}`, '--model', model, ...(provider ? ['--provider', provider] : [])];
    const r = spawnSync(process.execPath, [join(repo, 'bin/fwdloop'), ...argv], { encoding: 'utf8', timeout: 300000, env: process.env });
    appendFileSync(join(work, 'cli-out.txt'), `=== ${id} exit ${r.status}\n${r.stdout}${r.stderr}\n`);
    const sp = readJson(join(out, 'draft-spend.json'));
    const log = readJson(join(out, 'log.json'));
    let cost = null;
    if (typeof log?.costUsd === 'number') cost = log.costUsd;
    else if (sp) cost = typeof sp.costUsd === 'number' ? sp.costUsd : (typeof sp.cost === 'number' ? sp.cost : null);
    if (typeof cost === 'number') spent += cost;
    const decl = readJson(join(out, 'declaration.json'));
    const steps = (Array.isArray(decl?.steps) ? decl.steps : []).map((s) => ({
      fromLine: s.fromLine, primitives: s.primitives ?? null, reads: readsOf(s), emits: s.emits ?? null,
    }));
    const refusedLines = Array.isArray(decl?.refused) ? decl.refused : [];
    const ok = r.status === 0 && log?.ok === true;
    const reds = (Array.isArray(log?.reds) ? log.reds : []).slice(0, 2).map((x) => trunc(x));
    const pass = judge(job, ok, refusedLines, steps);
    rows.push({
      id, job, exit: r.status, cost, ok, stop: log?.stop ?? null, rounds: log?.rounds ?? null, reds, refused: refusedLines.map((x) => trunc(x)), steps, pass,
    });
    console.log(id, 'exit', r.status, 'cost', cost, 'ok', ok, 'stop', JSON.stringify(log?.stop ?? null), pass ? 'PASS' : 'MISS');
    console.log('  reds', JSON.stringify(reds), 'refused', JSON.stringify(refusedLines.map((x) => trunc(x))));
    for (const s of steps) console.log(`  line ${s.fromLine} prims ${JSON.stringify(s.primitives)} reads ${JSON.stringify(s.reads)} emits ${JSON.stringify(s.emits)}`);
  }
}
const summary = Object.keys(JOBS).map((job) => {
  const rs = rows.filter((x) => x.job === job);
  return { job, bar: JOBS[job].n, drafts: rs.length, passes: rs.filter((x) => x.pass).length, misses: rs.filter((x) => !x.pass).length };
});
const totalPasses = rows.filter((x) => x.pass).length;
const barMet = !aborted && summary.every((s) => s.drafts === s.bar && s.passes === s.bar);
writeFileSync(join(work, 'results.json'), `${JSON.stringify({ model, spentUsd: spent, aborted, barMet, passes: totalPasses, of: rows.length, summary, rows }, null, 2)}\n`);
console.log(`\nF154 (${model})`);
console.log('job  drafts  passes  misses  (bar = all)');
for (const s of summary) console.log(`${s.job.padEnd(4)} ${String(s.drafts).padEnd(7)} ${String(s.passes).padEnd(7)} ${s.misses}`);
console.log(`total: ${totalPasses} pass of ${rows.length}; bar ${barMet ? 'MET' : 'NOT MET'}; spent $${spent.toFixed(4)}${aborted ? ' (ABORTED by spend guard)' : ''}; results in ${join(work, 'results.json')}`);
process.exit(0);
