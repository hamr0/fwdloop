// F121 (PAID, pre-registered in docs/logs/FINDINGS.md before any run): does the DRAFTER give a ticketFilter for BOTH wordings of the same ticket filter?
//   A: "priority P1 only"            B: "only tickets with priority P1 count"
// N=3 drafts each, through the real `fwdloop draft --flow-type tickets --mcp github`, on deepseek-flash. Run by hamr, with the key already in the environment
// (never read from `pass` here, never printed). Usage: F121_KEY_NAME=DEEPSEEK_API_KEY node poc/mcp/f121/f121.mjs [workDir]
// Needs: `check tools` pressed once for the github server in Settings > MCP (the draft refuses at $0 otherwise, and this script records that refusal as the draft's result).
// Refuses at $0 (exit 2, before any draft) when the key named by F121_KEY_NAME is empty or missing in the environment. Aborts when the cumulative spend passes $0.10.
import { spawnSync } from 'node:child_process';
import {
  readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const keyName = process.env.F121_KEY_NAME ?? 'DEEPSEEK_API_KEY';
if (!/^[A-Z][A-Z0-9_]*_KEY$/.test(keyName)) { console.error(`F121: F121_KEY_NAME "${keyName}" is not a key name (NAME_KEY). Nothing spent.`); process.exit(2); }
if (typeof process.env[keyName] !== 'string' || process.env[keyName].trim() === '') {
  console.error(`F121: ${keyName} is empty or not set in the environment. Refused at $0, no draft started.`);
  process.exit(2);
}
const work = resolve(process.argv[2] ?? join(here, 'out'));
const model = process.env.F121_MODEL ?? 'deepseek-flash';
const provider = process.env.F121_PROVIDER; // only when two keys tick the same model id
const list = process.env.F121_LIST ?? 'https://github.com/hamr0/hol-guard/issues';
const LIMIT = 0.10;
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

let spent = 0;
const rows = [];
for (const [w, wording] of Object.entries(WORDINGS)) {
  for (const n of [1, 2, 3]) {
    if (spent > LIMIT) { console.log('ABORT: spend guard', spent); break; }
    const id = `${w}${n}`;
    const proseFile = join(work, `prose-${id}.txt`);
    writeFileSync(proseFile, prose(wording));
    const out = join(work, `draft-${id}`);
    const argv = ['draft', proseFile, '--out', out, '--root', join(work, 'root'), '--name', `f121-${id}`, '--model', model, '--flow-type', 'tickets', '--mcp', 'github', ...(provider ? ['--provider', provider] : [])];
    const r = spawnSync(process.execPath, [join(repo, 'bin/fwdloop'), ...argv], { encoding: 'utf8', timeout: 300000, env: process.env });
    appendFileSync(join(work, 'cli-out.txt'), `=== ${id} exit ${r.status}\n${r.stdout}${r.stderr}\n`);
    const sp = join(out, 'draft-spend.json');
    let cost = null;
    if (existsSync(sp)) { try { const j = JSON.parse(readFileSync(sp, 'utf8')); cost = typeof j.costUsd === 'number' ? j.costUsd : (typeof j.cost === 'number' ? j.cost : null); } catch { cost = null; } }
    if (typeof cost === 'number') spent += cost;
    let filter = null;
    const decl = join(out, 'declaration.json');
    if (existsSync(decl)) { try { filter = JSON.parse(readFileSync(decl, 'utf8')).ticketFilter ?? null; } catch { filter = null; } }
    const up = (a) => (Array.isArray(a) ? a : []).map((v) => String(v).trim().toUpperCase());
    const hasP1 = filter !== null && (up(filter.priority).includes('P1') || up(filter.labels).includes('P1'));
    // the pass letter: a draft that exists AND gives a ticketFilter naming P1 (as priority P1 or as the label P1); a refused or red draft is a miss, never skipped
    rows.push({ id, wording, exit: r.status, cost, ticketFilter: filter, pass: r.status === 0 && hasP1 });
    console.log(id, 'exit', r.status, 'cost', cost, 'ticketFilter', JSON.stringify(filter), hasP1 && r.status === 0 ? 'PASS' : 'FAIL');
  }
}
const passes = rows.filter((x) => x.pass).length;
const verdict = rows.length === 6 && passes === 6 ? 'PASS' : 'FAIL';
writeFileSync(join(work, 'results.json'), `${JSON.stringify({ model, list, spentUsd: spent, passes, of: rows.length, verdict, rows }, null, 2)}\n`);
console.log(`F121 ${verdict}: ${passes} of ${rows.length} drafts gave a ticketFilter naming P1; spent $${spent.toFixed(4)}; results in ${join(work, 'results.json')}`);
process.exit(verdict === 'PASS' ? 0 : 1);
