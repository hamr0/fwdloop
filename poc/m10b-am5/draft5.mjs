// F182 POC 2 (M10b am5, PAID): the walk-m10am32-1 job drafted 5 times on deepseek-flash through the REAL draft path (src/drafter.js `draft`). NOT the product.
// Pass (signed bar): no final plan carries a table check that fails on its input, AND at least 4 of 5 drafts end green.
//
//   export DEEPSEEK_API_KEY=...   (loaded by hamr in the live shell; this script never reads `pass`, never prints a key)
//   node poc/m10b-am5/draft5.mjs --dry                 # $0: builds the real prompt through draft() with a stub provider; nothing leaves the machine
//   setsid nohup node poc/m10b-am5/draft5.mjs --tag 1 > poc/m10b-am5/draft5-1.log 2>&1 &
//
// Cap $0.20: the signed cap of the job text below is $0.2, and draft()'s own `priorSpend` takes what earlier drafts spent off it before every round; an unpriced draft counts at ceiling.
// Results: poc/m10b-am5/results-draft5-<tag>.json, created once per tag (a tag with results is refused, never overwritten).
// The job text and boxes are copied from flow walk-m10am32-1 (prose.txt: the job after the agreed column rule); the sheet is fixtures/ar-aging.csv.
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft } from '../../src/drafter.js';
import { checkKeyPreflight, ceilingCostUsd } from '../../src/provider.js';
import { tableChecksFailingOnInput } from '../../src/sheetrun.js';
import { parseCsv, sheetTable } from '../../src/csv.js';
import { ratesFor } from '../rates.mjs';
import { scrub, secretsFromEnv } from '../m6a/batch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CSV = join(ROOT, 'fixtures', 'ar-aging.csv');
const SLOT = 'DEEPSEEK_API_KEY';
const MODEL = 'deepseek-flash';
const N = 5;
const CAP_USD = 0.20;
const BAR_GREEN = 4;

const PROSE = `1. Read the aging report
2. Total the balance due per customer
   guardrail: every customer appears exactly once; total the balance due; use the column 'Amount' for 'balance due'
3. ask 1h: check it with me
4. Write it out
5. ask 1h: check the result with me
6. write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $${CAP_USD} per run
guardrail: send at line 6 to file:/home/hamr/fwdloop-out
guardrail: source aging = file:${CSV}
`;

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const ti = argv.indexOf('--tag');
const tag = ti !== -1 ? argv[ti + 1] : undefined;
const tables = { aging: sheetTable(parseCsv(readFileSync(CSV, 'utf8'))) };

if (dry) {
  // $0: the real draft() with a stub provider (no network). It answers plain text, so the draft ends red; what is printed is what the real request carries.
  const calls = [];
  const rates = ratesFor(undefined, MODEL);
  const provider = {
    lastMalformedToolCall: null,
    async generate(messages, tools, options) {
      calls.push({ tools: tools.map((t) => t.name), system: messages[0]?.content ?? '', user: messages.at(-1)?.content ?? '', options });
      return { text: '{"facts":[]}', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop', model: MODEL };
    },
  };
  const r = await draft({ proseText: PROSE, provider, rates, modelId: MODEL, offerQuestions: false });
  const dc = calls.find((c) => c.tools[0] === 'emit_declaration');
  process.stdout.write(`${JSON.stringify({
    dry: true, providerCalled: false, stubCalls: calls.length, stubToolNames: calls.map((c) => c.tools), drafted: r.ok, stop: r.stop, capUsd: CAP_USD, drafts: N, model: MODEL,
    roundCeilingUsd: ceilingCostUsd(rates), draftOptions: dc?.options ?? null,
    systemHasAm5Sentence: !!dc && dc.system.includes('must already hold on that sheet'), systemChars: dc?.system.length ?? null,
    userText: dc?.user ?? null, tableRoles: Object.keys(tables), tableRows: tables.aging.rows.length,
  }, null, 2)}\n`);
  process.exit(0);
}

const key = checkKeyPreflight(SLOT, process.env);
if (!key.ok) { process.stderr.write(`REFUSED: ${key.message}\n`); process.exit(1); }
if (!tag || /[^A-Za-z0-9._-]/.test(tag)) { process.stderr.write('REFUSED: --tag is required (letters, digits, . _ - only)\n'); process.exit(1); }
const resultsPath = join(HERE, `results-draft5-${tag}.json`);
if (existsSync(resultsPath)) { process.stderr.write(`REFUSED: tag "${tag}" already has results; use a new --tag\n`); process.exit(1); }
const secrets = secretsFromEnv(process.env[SLOT]);
const say = (s) => process.stdout.write(`${scrub(String(s), secrets)}\n`);
const ceiling = ceilingCostUsd(ratesFor(undefined, MODEL));

let spent = 0; // priced spend of finished drafts; an unpriced or incomplete draft adds one round ceiling per unknown call, never 0
const out = { tag, model: MODEL, capUsd: CAP_USD, startedAt: new Date().toISOString(), drafts: [], stoppedBy: null };
let created = false;
const save = () => { writeFileSync(resultsPath, `${JSON.stringify(out, null, 1)}\n`, { flag: created ? 'w' : 'wx' }); created = true; };
for (let i = 1; i <= N; i += 1) {
  if (spent + ceiling > CAP_USD) { out.stoppedBy = `cap: spent $${spent.toFixed(4)} + one round's ceiling $${ceiling.toFixed(4)} would pass $${CAP_USD.toFixed(2)}`; break; }
  const t0 = Date.now();
  let r;
  try {
    r = await draft({ proseText: PROSE, slot: SLOT, model: MODEL, env: process.env, priorSpend: () => spent, offerQuestions: false });
  } catch (e) { r = { ok: false, reds: [`threw: ${e.message}`], costUsd: null, spendComplete: false, calls: 1, rounds: 0, declaration: null, log: [], stop: 'threw' }; }
  const unknownRounds = r.spendComplete === false || r.costUsd === null ? Math.max(1, (r.calls ?? 1) - (r.rounds ?? 0)) : 0;
  spent += (r.costUsd ?? 0) + unknownRounds * ceiling;
  // the final plan's table checks, run again here with the same real check: a green draft carries its declaration; a red draft's last plan is in its last log entry
  const finalPlan = r.declaration ?? r.log?.at(-1)?.args ?? null;
  const failing = finalPlan ? await tableChecksFailingOnInput(finalPlan, tables) : [];
  const tableChecks = (finalPlan?.steps ?? []).flatMap((s) => (Array.isArray(s?.close?.sheet) ? s.close.sheet : []).filter((c) => c?.rule === 'table').map((c) => ({ line: s.fromLine, op: c.op, column: c.column ?? null })));
  out.drafts.push({
    n: i, green: r.ok === true, stop: r.stop ?? null, reds: r.reds ?? [], tries: r.log?.length ?? 0, calls: r.calls, rounds: r.rounds, costUsd: r.costUsd, spendComplete: r.spendComplete,
    modelReturned: r.modelReturned, wallMs: Date.now() - t0, tableChecks, finalPlanFailingTableChecks: failing,
    am5RedsSeen: (r.log ?? []).flatMap((e) => e.reds ?? []).filter((x) => String(x).includes('already fails on the input')),
  });
  out.spentUsd = spent;
  save();
  say(`draft ${i}: ${r.ok ? 'green' : `RED (${r.stop})`} cost=${r.costUsd === null ? 'UNKNOWN' : `$${r.costUsd.toFixed(5)}`} tries=${r.log?.length ?? 0} tableChecks=${JSON.stringify(tableChecks)} failingOnInput=${failing.length}`);
}
const greens = out.drafts.filter((d) => d.green).length;
const badFinal = out.drafts.filter((d) => d.finalPlanFailingTableChecks.length > 0).length;
out.verdict = out.drafts.length === N && greens >= BAR_GREEN && badFinal === 0 ? 'PASS' : 'FAIL';
out.finishedAt = new Date().toISOString();
save();
say(`greens ${greens}/${out.drafts.length} (need ${BAR_GREEN}); final plans with a table check failing on the input: ${badFinal} (need 0); spent ${out.drafts.some((d) => d.costUsd === null) ? 'at least ' : ''}$${spent.toFixed(4)}; ${out.verdict}`);
