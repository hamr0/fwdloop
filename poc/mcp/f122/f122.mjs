// F122 (PAID, pre-registered in docs/logs/FINDINGS.md before any run): does one added ticketFactsLines line plus a hint in the pause red stop
// the drafter giving line 1 of a Tickets job no primitives? N=12 real drafts of the F121 wording A job ("priority P1 only"), through the real
// `fwdloop draft --flow-type tickets --mcp github`. Run twice, by the orchestrator: BASELINE (checkout the commit before the fix) and AFTER (the fix commit).
// Usage: FIREWORKS_API_KEY already in the environment (never read from `pass` here, never printed):
//   F122_LABEL=baseline|after node poc/mcp/f122/f122.mjs <workDir>      (workDir must be NEW; a used one is refused)
// Needs: `check tools` pressed once for the github server in Settings > MCP. Refuses at $0 (exit 2) when the key is empty/missing or the work folder is used.
// Aborts the batch when the cumulative spend passes $0.25. Measures: try-1 steps[0].primitives empty (from log.json log[0].args), final pause reds, spend.
import { spawnSync } from 'node:child_process';
import {
  readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync, readdirSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const keyName = 'FIREWORKS_API_KEY';
if (typeof process.env[keyName] !== 'string' || process.env[keyName].trim() === '') {
  console.error(`F122: ${keyName} is empty or not set in the environment. Refused at $0, no draft started.`);
  process.exit(2);
}
const label = process.env.F122_LABEL ?? '';
if (label !== 'baseline' && label !== 'after') { console.error('F122: set F122_LABEL=baseline or after. Nothing spent.'); process.exit(2); }
if (!process.argv[2]) { console.error('F122: give a NEW work folder as the first argument. Nothing spent.'); process.exit(2); }
const work = resolve(process.argv[2]);
if (existsSync(work) && readdirSync(work).length > 0) { console.error(`F122: ${work} is not empty; use a new folder. Nothing spent.`); process.exit(2); }
const model = 'accounts/fireworks/models/deepseek-v4p1-flash';
const provider = process.env.F122_PROVIDER; // only when two keys tick the same model id
const list = process.env.F122_LIST ?? 'https://github.com/hamr0/hol-guard/issues';
const N = 12;
const LIMIT = 0.25;
const PAUSE = 'is a pause (no primitives, hitl) at an unsigned line';
mkdirSync(join(work, 'root'), { recursive: true });
mkdirSync(join(work, 'send'), { recursive: true });
const prose = `1. read the ticket and say what is broken
   guardrail: priority P1 only
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
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

let spent = 0;
const rows = [];
for (let n = 1; n <= N; n += 1) {
  if (spent > LIMIT) { console.log('ABORT: spend guard', spent); break; }
  const id = `${label}${n}`;
  const proseFile = join(work, `prose-${id}.txt`);
  writeFileSync(proseFile, prose);
  const out = join(work, `draft-${id}`);
  const argv = ['draft', proseFile, '--out', out, '--root', join(work, 'root'), '--name', `f122-${id}`, '--model', model, '--flow-type', 'tickets', '--mcp', 'github', ...(provider ? ['--provider', provider] : [])];
  const r = spawnSync(process.execPath, [join(repo, 'bin/fwdloop'), ...argv], { encoding: 'utf8', timeout: 300000, env: process.env });
  appendFileSync(join(work, 'cli-out.txt'), `=== ${id} exit ${r.status}\n${r.stdout}${r.stderr}\n`);
  const sp = readJson(join(out, 'draft-spend.json'));
  const cost = sp && typeof (sp.costUsd ?? sp.cost) === 'number' ? (sp.costUsd ?? sp.cost) : null;
  if (typeof cost === 'number') spent += cost;
  const lg = readJson(join(out, 'log.json'));
  const try1 = lg?.log?.[0]?.args ?? null;
  const prims = try1?.steps?.[0]?.primitives;
  // 'empty' = try 1 gave steps[0] with no primitives; 'unknown' = no parsed try-1 declaration in log.json (never counted as empty, never hidden)
  const try1State = Array.isArray(prims) ? (prims.length === 0 ? 'empty' : 'granted') : 'unknown';
  const finalPause = r.status !== 0 && (lg?.reds ?? []).some((x) => String(x).includes(PAUSE));
  rows.push({ id, exit: r.status, cost, try1State, try1Primitives: prims ?? null, finalPause, reds: lg?.reds ?? null });
  console.log(id, 'exit', r.status, 'cost', cost, 'try1', try1State, 'finalPause', finalPause);
}
const empty = rows.filter((x) => x.try1State === 'empty').length;
const unknown = rows.filter((x) => x.try1State === 'unknown').length;
const pauses = rows.filter((x) => x.finalPause).length;
writeFileSync(join(work, 'results.json'), `${JSON.stringify({ label, model, list, spentUsd: spent, drafts: rows.length, try1Empty: empty, try1Unknown: unknown, finalPauseReds: pauses, rows }, null, 2)}\n`);
console.log(`F122 ${label}: ${rows.length} drafts; try-1 steps[0] primitives empty ${empty}, unknown ${unknown}; final pause reds ${pauses}; spent $${spent.toFixed(4)}; results in ${join(work, 'results.json')}`);
