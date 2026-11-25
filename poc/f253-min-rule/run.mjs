// F253 (docs/logs/FINDINGS.md): $0 POC for M19 am13. No key, no network, no provider. Run: node poc/f253-min-rule/run.mjs
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cardFields, cardToProse, parseJobBox } from '../../src/panel/authorcard.js';
import { parseSignedText } from '../../src/signed-text.js';
import { rulesOfLine } from '../../src/sheetblock.js';
import { draftToDir } from '../../src/authoring.js';

const results = [];
const bar = (id, ok, note) => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} (${id}) ${note}`); };

// the ONE count the build would use: parseSignedText (the drafter's own reader) + rulesOfLine (the block's own splitter)
function countRules(prose) {
  const p = parseSignedText(prose);
  if (!p.ok) return { ok: false, reds: p.reds };
  return { ok: true, count: p.lines.reduce((n, l) => n + rulesOfLine(l).length, 0), lines: p.lines.filter((l) => rulesOfLine(l).length > 0).length };
}

const base = { destination: 'out', capUsd: '0.25', askWait: '1h', inputs: '' };
const cardOf = (job, extra = {}) => cardFields({ ...base, flowName: 'poc', job, ...extra });
const cases = [
  { name: 'plain, zero ~', card: cardOf('Read the notes and list the open items\nWrite a short summary'), want: 0 },
  { name: 'plain, one ~', card: cardOf('Read the notes and list the open items\n~ every item has an owner\nWrite a short summary'), want: 1 },
  { name: 'plain, two ~ lines on one line', card: cardOf('Read the notes\n~ under 80 words\n~ no names\nWrite a summary'), want: 2 },
  { name: 'plain, one ~ on an Ask line only', card: cardOf('Read the notes\nAsk: is this fine?\n~ nothing goes out before I accept'), want: 1 },
  { name: 'plain, a "~ !" and "~ $" typed by the person', card: cardOf('Read the notes\n~ !agent says so\n~ $ default'), want: 2 },
  { name: 'MCP, zero ~', card: cardOf('Use the tool to read the page\nSummarise it', { flowType: 'mcp', mcp: 'barebrowse' }), want: 0 },
  { name: 'MCP, one ~', card: cardOf('Use the tool to read the page\n~ quote the title exactly\nSummarise it', { flowType: 'mcp', mcp: 'barebrowse' }), want: 1 },
  { name: 'Tickets MCP, zero ~', card: cardOf('Read the ticket and say what is broken\nWrite the answer', { flowType: 'tickets', mcp: 'github', inputs: 'issues: https://github.com/o/r/issues' }), want: 0 },
  { name: 'Tickets MCP, filter ~ only', card: cardOf('Read the ticket and say what is broken\n~ priority P1 or P2 only\nWrite the answer', { flowType: 'tickets', mcp: 'github', inputs: 'issues: https://github.com/o/r/issues' }), want: 1 },
];
let aOk = true;
for (const c of cases) {
  const box = parseJobBox(c.card.job).steps.reduce((n, s) => n + s.guardrails.length, 0);
  const got = countRules(cardToProse(c.card));
  const ok = got.ok && got.count === c.want && got.count === box;
  if (!ok) aOk = false;
  console.log(`  ${ok ? 'ok ' : 'BAD'} ${c.name}: box ~ lines ${box}, counted ${got.ok ? got.count : `RED ${got.reds}`}, wanted ${c.want}`);
}
// the real prose of the existing Tickets drafter test (a Tickets job as the drafter is handed it)
const t = readFileSync(resolve('test/m12-p3-drafter.test.js'), 'utf8');
const real = /const PROSE = `([^`]*)`/.exec(t)[1];
const realCount = countRules(real);
const realGrep = real.split('\n').filter((l) => /^\s+guardrail:/.test(l)).length; // indented = under a job line (the arbiter's are not indented)
console.log(`  real Tickets prose (test/m12-p3-drafter.test.js): counted ${realCount.count} on ${realCount.lines} lines; indented guardrail lines ${realGrep}; first = "priority P1 or P2 only" (the ticket filter)`);
if (realCount.count !== realGrep || realCount.count !== 2) aOk = false;
bar('a+c', aOk, 'count by parseSignedText + rulesOfLine equals the box ~ count in every fixture (plain, MCP, Tickets MCP; Ask-line ~ and the filter ~ count; arbiter guardrail: lines do not)');

// (b) the top of the real draftToDir: an unusable key refuses at $0 with nothing on disk
const root = mkdtempSync(join(tmpdir(), 'f253-'));
try {
  const dir = join(root, 'out', 'plan');
  const prose = join(root, 'prose.txt');
  execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(prose)}, ${JSON.stringify(cardToProse(cases[0].card))})`]);
  const before = readdirSync(root).sort().join(',');
  const r = await draftToDir({ proseFile: prose, dir, root: join(root, 'flows'), name: 'poc', slot: 'deepseek', model: 'x', env: {} });
  const after = readdirSync(root).sort().join(',');
  const ok = r.ok === false && r.wrote === false && r.costUsd === 0 && !existsSync(dir) && !existsSync(join(dir, 'spend.jsonl')) && before === after;
  console.log(`  draftToDir (no key): ok=${r.ok} wrote=${r.wrote} costUsd=${r.costUsd} reds=${JSON.stringify(r.reds)} folderMade=${existsSync(dir)} rootChanged=${before !== after}`);
  bar('b', ok, 'a refusal at the top of draftToDir returns wrote:false, costUsd 0, no plan folder, no spend row (the min-rule refusal would sit beside the key refusal, src/authoring.js:412)');
} finally { rmSync(root, { recursive: true, force: true }); }

// (d) every caller of draftToDir in the tree
const callers = execFileSync('grep', ['-rn', 'draftToDir(', 'src', 'bin'], { encoding: 'utf8' }).split('\n').filter((l) => l && !/^\S+:\d+:\s*(\/\/|\*)/.test(l) && !/export async function draftToDir/.test(l));
console.log(callers.map((l) => `  caller: ${l.trim()}`).join('\n'));
bar('d', callers.length === 1 && callers[0].startsWith('bin/fwdloop:'), 'draftToDir has exactly one caller, bin/fwdloop cmdDraft; no run path reaches it');
process.exitCode = results.every((x) => x.ok) ? 0 : 1;
