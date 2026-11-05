// F151 (PAID, pre-registered in docs/logs/FINDINGS.md before any run)
// Question: does making the schema's ticketFilter description say "required when a guardrail names a priority or a label" remove drafts that name the filter but never emit it?
// Two wordings (A: "priority P1 only", B: "only tickets with priority P1 count"), F151_N drafts each, through the real
// `fwdloop draft --flow-type tickets --mcp github` of the repo at F151_REPO (run once on a baseline worktree, once on the after branch).
// Run by hamr, key already in the environment (never read from `pass` here, never printed).
// Usage: F151_LABEL=baseline|after F151_REPO=/abs/repo F151_OUT=/abs/new/folder [F151_KEY_NAME=FIREWORKS_API_KEY] [F151_MODEL=...] [F151_N=10] node poc/mcp/f151/f151.mjs
// Refuses at $0 (exit 2, before any draft) on a missing/invalid setting, an empty key, a repo without bin/fwdloop, or an F151_OUT that already exists.
// Aborts when the cumulative spend passes $0.20.
import { spawnSync } from 'node:child_process';
import {
  readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync,
} from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';

const refuse = (m) => { console.error(`F151: ${m} Refused at $0, no draft started.`); process.exit(2); };
const keyName = process.env.F151_KEY_NAME ?? 'FIREWORKS_API_KEY';
if (!/^[A-Z][A-Z0-9_]*_KEY$/.test(keyName)) refuse(`F151_KEY_NAME "${keyName}" is not a key name (NAME_KEY).`);
const label = process.env.F151_LABEL;
if (label !== 'baseline' && label !== 'after') refuse('F151_LABEL must be "baseline" or "after".');
const repo = process.env.F151_REPO;
if (!repo || !isAbsolute(repo)) refuse('F151_REPO must be an absolute path.');
if (!existsSync(join(repo, 'bin/fwdloop'))) refuse(`F151_REPO has no bin/fwdloop (${repo}).`);
const outEnv = process.env.F151_OUT;
if (!outEnv || !isAbsolute(outEnv)) refuse('F151_OUT must be an absolute path to a new folder.');
if (existsSync(outEnv)) refuse(`F151_OUT already exists (${outEnv}); never overwritten, use a new folder.`);
const N = Number(process.env.F151_N ?? 10);
if (!Number.isInteger(N) || N < 1) refuse('F151_N must be a positive integer.');
let extraArgs = [];
if (process.env.F151_EXTRA_ARGS !== undefined) {
  try { extraArgs = JSON.parse(process.env.F151_EXTRA_ARGS); } catch { extraArgs = null; }
  if (!Array.isArray(extraArgs) || !extraArgs.every((x) => typeof x === 'string')) refuse('F151_EXTRA_ARGS must be a JSON list of strings.');
}
if (typeof process.env[keyName] !== 'string' || process.env[keyName].trim() === '') refuse(`${keyName} is empty or not set in the environment.`);

const work = resolve(outEnv);
const model = process.env.F151_MODEL ?? 'accounts/fireworks/models/deepseek-v4p1-flash';
const provider = process.env.F151_PROVIDER; // only when two keys tick the same model id
const list = process.env.F151_LIST ?? 'https://github.com/hamr0/hol-guard/issues';
const LIMIT = 0.20;
const WORDINGS = {
  a: 'priority P1 only',
  b: 'only tickets with priority P1 count',
};
mkdirSync(join(work, 'root'), { recursive: true });
mkdirSync(join(work, 'send'), { recursive: true });
const prose = (g) => `1. read the ticket and say what is broken
   guardrail: ${g}
2. write a short first-response plan for the on-call engineer
   guardrail: under 150 words
3. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
4. and once I accept, write it out.
Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:${join(work, 'send')}
guardrail: source issues = page:${list}
`;

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const strings = (v) => {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
};

let spent = 0;
let aborted = false;
const rows = [];
for (const [w, wording] of Object.entries(WORDINGS)) {
  for (let n = 1; n <= N; n += 1) {
    if (spent > LIMIT) { aborted = true; console.log('ABORT: spend guard', spent); break; }
    const id = `${w}${n}`;
    const proseFile = join(work, `prose-${id}.txt`);
    writeFileSync(proseFile, prose(wording));
    const out = join(work, `draft-${id}`);
    const argv = ['draft', proseFile, '--out', out, '--root', join(work, 'root'), '--name', `f151-${label}-${id}`, '--model', model, '--flow-type', 'tickets', '--mcp', 'github', ...(provider ? ['--provider', provider] : []), ...extraArgs];
    const r = spawnSync(process.execPath, [join(repo, 'bin/fwdloop'), ...argv], { encoding: 'utf8', timeout: 300000, env: process.env });
    appendFileSync(join(work, 'cli-out.txt'), `=== ${id} exit ${r.status}\n${r.stdout}${r.stderr}\n`);
    const sp = readJson(join(out, 'draft-spend.json'));
    let cost = null;
    if (sp) cost = typeof sp.costUsd === 'number' ? sp.costUsd : (typeof sp.cost === 'number' ? sp.cost : null);
    if (typeof cost === 'number') spent += cost;
    const decl = readJson(join(out, 'declaration.json'));
    const filter = decl?.ticketFilter ?? null;
    const up = (a) => (Array.isArray(a) ? a : []).map((v) => String(v).trim().toUpperCase());
    const hasP1 = filter !== null && (up(filter.priority).includes('P1') || up(filter.labels).includes('P1'));
    // pass letter (same as F121): exit 0 AND a ticketFilter naming P1 as priority or label; anything else is a miss, never skipped
    const pass = r.status === 0 && hasP1;
    // bareloop's e1 shape: no key, but refused / unjudgeable / not-checked text mentions the filter or P1
    const texts = [...strings(decl?.refused), ...strings(decl?.unjudgeable), ...strings(readJson(join(out, 'not-checked.json')))];
    const namedNotEmitted = filter === null && texts.some((t) => /filter|P1/i.test(t));
    rows.push({ id, wording: w, exit: r.status, cost, ticketFilter: filter, pass, namedNotEmitted });
    console.log(id, 'exit', r.status, 'cost', cost, 'ticketFilter', JSON.stringify(filter), pass ? 'PASS' : 'MISS', namedNotEmitted ? 'namedNotEmitted' : '');
  }
}
const summary = Object.keys(WORDINGS).map((w) => {
  const rs = rows.filter((x) => x.wording === w);
  return { wording: w, text: WORDINGS[w], drafts: rs.length, passes: rs.filter((x) => x.pass).length, misses: rs.filter((x) => !x.pass).length, namedNotEmitted: rs.filter((x) => x.namedNotEmitted).length };
});
const totalPasses = rows.filter((x) => x.pass).length;
writeFileSync(join(work, 'results.json'), `${JSON.stringify({ label, repo, model, list, extraArgs, n: N, spentUsd: spent, aborted, passes: totalPasses, of: rows.length, summary, rows }, null, 2)}\n`);
console.log(`\nF151 ${label} (${model}) extraArgs ${JSON.stringify(extraArgs)}`);
console.log('wording  drafts  passes  misses  namedNotEmitted');
for (const s of summary) console.log(`${s.wording.padEnd(8)} ${String(s.drafts).padEnd(7)} ${String(s.passes).padEnd(7)} ${String(s.misses).padEnd(7)} ${s.namedNotEmitted}`);
console.log(`total: ${totalPasses} pass, ${rows.length - totalPasses} miss of ${rows.length}; spent $${spent.toFixed(4)}${aborted ? ' (ABORTED by spend guard)' : ''}; results in ${join(work, 'results.json')}`);
process.exit(0);
