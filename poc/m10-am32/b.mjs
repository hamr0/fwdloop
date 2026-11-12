// F179 POC B (M10 am32): does the drafter fill `suggestion` and `ruleNo` when questions are forced open? NOT the product.
// borrowed-from: fwdloop poc/am24-questions/draft.mjs (call path, metering) and src/drafter.js buildRoundSchema (copied below, questions item extended).
//
//   export DEEPSEEK_API_KEY=...   (loaded by hamr in the live shell; this script never reads `pass`, never prints a key)
//   node poc/m10-am32/b.mjs --dry              # $0: builds the schema, prints one request, no provider call
//   setsid nohup node poc/m10-am32/b.mjs --tag 1 > poc/m10-am32/b-1.log 2>&1 &
//
// One forced round per vague job (v01-v10); fewer than 10 questions -> the jobs are rerun in order until 10 questions or the cap.
// Cap $0.30: before each round, ledger total (unknown cost at ceiling) + one round's ceiling must stay <= $0.30.
import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop, HaltError } from 'bare-agent';
import { parseSignedText } from '../../src/signed-text.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { wiredMenu } from '../../src/primitives.js';
import { readInputFacts } from '../../src/input-facts.js';
import { lineRules } from '../../src/pagebits.js';
import {
  makeProvider, sumMeterings, ceilingCostUsd, checkKeyPreflight, appendSpendRow, priceRecord,
} from '../../src/provider.js';
import { buildDeclarationSchema, buildSystemPrompt, DRAFT_MAX_TOKENS, DRAFT_SKILLS } from '../../src/drafter.js';
import { ratesFor } from '../rates.mjs';
import { ledgerTotalUsd, scrub, secretsFromEnv } from '../m6a/batch.mjs';
import { VAGUE } from '../am24-questions/jobs.mjs';
import { QUESTIONS_PROMPT } from '../am24-questions/draft.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAP_USD = 0.30;
const NEED_QUESTIONS = 10;
const BAR_SUGGESTED = 8;
const DEADLINE_MS = 300_000;
const MODEL = 'deepseek-flash';
const TOOL = 'emit_declaration';
const SLOT = 'DEEPSEEK_API_KEY'; // makeProvider's first argument is the key name, as checkKeyPreflight's
const PROVIDER_OPTIONS = { timeoutMs: 300_000, deadlineMs: 240_000, thinking: { type: 'disabled' } };

const NEW_FIELDS_PROMPT = [
  'Every question must also carry two more fields.',
  '"suggestion": the answer you would propose, written as one short rule the person could add to that job line as it stands (empty string if you have no proposal).',
  '"ruleNo": the number of the `guardrail:` rule on that job line the question is about, counting from 1, or null if it is about no such rule (or the line has none).',
].join('\n');

/** Copy of src/drafter.js buildRoundSchema, `questions` forced open: required, at least one item, each with required suggestion and ruleNo. */
export function buildForcedSchema(menu) {
  const s = buildDeclarationSchema(menu);
  const extra = {
    notChecked: { type: 'array', items: { type: 'string' }, description: 'what the job asks for that no typed check verifies' },
    questions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          line: { type: 'integer' }, question: { type: 'string' },
          suggestion: { type: 'string', description: 'a proposed rule for that line, in words; empty string if none' },
          ruleNo: { type: ['integer', 'null'], description: 'number of the guardrail rule on that line the question is about, or null' },
        },
        required: ['line', 'question', 'suggestion', 'ruleNo'],
      },
      description: 'questions the job cannot be drafted without; each names the job line it is about',
    },
  };
  return { ...s, properties: { ...s.properties, ...extra }, required: [...(s.required ?? []), 'questions'] };
}

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ __timedOut: true }), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function setup(job) {
  const parsed = parseSignedText(job.prose);
  if (!parsed.ok) throw new Error(`fixture ${job.id}: ${parsed.reds.join('; ')}`);
  const facts = readInputFacts(parsed.arbiter.sources);
  if (!facts.ok) throw new Error(`fixture ${job.id}: ${facts.reds.join('; ')}`);
  const menu = wiredMenu(DRAFT_SKILLS);
  const system = `${buildSystemPrompt({ menu, lines: parsed.lines, arbiter: parsed.arbiter, factsInfo: facts.info })}\n\n${QUESTIONS_PROMPT}\n\n${NEW_FIELDS_PROMPT}`;
  return { lines: parsed.lines, schema: buildForcedSchema(menu), system, userText: `Call ${TOOL} now.` };
}

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const ti = argv.indexOf('--tag');
const tag = ti !== -1 ? argv[ti + 1] : undefined;

if (dry) {
  if (!loadCatalogue().ok) throw new Error('catalogue did not load');
  const { schema, system, userText } = setup(VAGUE[0]);
  const qi = schema.properties.questions;
  // Build the provider and read the rates with whatever key the shell has (a dummy is fine): no request is sent.
  let providerBuilt; let ceilingUsd = null;
  try {
    makeProvider(SLOT, { model: MODEL, env: process.env, ...PROVIDER_OPTIONS });
    providerBuilt = true;
    ceilingUsd = ceilingCostUsd(ratesFor(undefined, MODEL));
  } catch (e) { providerBuilt = `NOT built: ${scrub(e.message, secretsFromEnv(process.env.DEEPSEEK_API_KEY))}`; }
  process.stdout.write(`${JSON.stringify({
    dry: true, providerCalled: false, providerBuilt, roundCeilingUsd: ceilingUsd, job: VAGUE[0].id, model: MODEL, toolChoice: { name: TOOL }, maxTokens: DRAFT_MAX_TOKENS,
    userText, systemChars: system.length, systemTail: system.slice(-900),
    questionsRequired: schema.required.includes('questions'), questionsSchema: qi,
  }, null, 2)}\n`);
  process.exit(0);
}

const key = checkKeyPreflight('DEEPSEEK_API_KEY', process.env);
if (!key.ok) { process.stderr.write(`REFUSED: ${key.message}\n`); process.exit(1); }
if (!tag || /[^A-Za-z0-9._-]/.test(tag)) { process.stderr.write('REFUSED: --tag is required (letters, digits, . _ - only)\n'); process.exit(1); }
const resultsPath = join(__dirname, `results-b-${tag}.json`);
if (existsSync(resultsPath)) { process.stderr.write(`REFUSED: tag "${tag}" already has results; use a new --tag\n`); process.exit(1); }
const spendPath = join(__dirname, 'spend.jsonl');
const secrets = secretsFromEnv(process.env.DEEPSEEK_API_KEY);
const say = (s) => process.stdout.write(`${scrub(String(s), secrets)}\n`);

const { provider, rates } = makeProvider(SLOT, { model: MODEL, env: process.env, ...PROVIDER_OPTIONS });
const roundCeiling = ceilingCostUsd(ratesFor(undefined, MODEL));
const rounds = [];
const questions = [];
let stoppedBy = null;

for (let pass = 1; stoppedBy === null && questions.length < NEED_QUESTIONS; pass += 1) {
  for (const job of VAGUE) {
    if (questions.length >= NEED_QUESTIONS && pass > 1) break;
    const total = ledgerTotalUsd(spendPath);
    if (total + roundCeiling > CAP_USD) { stoppedBy = `cap: ledger $${total.toFixed(4)} + one round's ceiling $${roundCeiling.toFixed(4)} would pass $${CAP_USD.toFixed(2)}`; break; }
    const { lines, schema, system, userText } = setup(job);
    let captured;
    const events = [];
    const tool = {
      name: TOOL, description: 'Emit the flow declaration over the granted primitives, or refuse lines you cannot serve.', parameters: schema,
      execute: async (args) => { captured = args; throw new HaltError('declaration captured', { rule: 'captured' }); },
    };
    const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); } });
    const t0 = Date.now();
    let result; let err = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await withDeadline(loop.run([{ role: 'system', content: system }, { role: 'user', content: userText }], [tool], { maxTokens: DRAFT_MAX_TOKENS, toolChoice: { name: TOOL } }), DEADLINE_MS);
      if (result?.__timedOut) err = 'deadline';
    } catch (e) { err = e.message; }
    const m = sumMeterings(events);
    appendSpendRow(spendPath, {
      runId: `am32-b-${tag}-${job.id}-p${pass}`, step: 'poc-am32-b', model: MODEL, modelReturned: m.model ?? null, costUsd: events.length ? m.costUsd : null,
      rounds: m.rounds, calls: 1, spendComplete: events.length > 0 && m.costUsd !== null, wallMs: Date.now() - t0, price: priceRecord(null, rates),
    });
    const usable = isObj(captured) && err === null;
    const qs = usable && Array.isArray(captured.questions) ? captured.questions : [];
    const rec = { job: job.id, pass, usable, err: err ?? (usable ? null : `no usable tool call (${result?.stopReason ?? 'unknown'})`), costUsd: events.length ? m.costUsd : null, nQuestions: qs.length };
    rounds.push(rec);
    for (const q of qs) {
      const rulesOnLine = lineRules(lines.find((l) => l.n === (isObj(q) ? q.line : undefined)) ?? {}).length;
      const hasSuggestion = isObj(q) && typeof q.suggestion === 'string' && q.suggestion.trim() !== '';
      const ruleInt = isObj(q) && Number.isInteger(q.ruleNo);
      questions.push({
        job: job.id, pass, line: q?.line ?? null, question: q?.question ?? null, suggestion: q?.suggestion ?? null, ruleNo: q?.ruleNo ?? null,
        rulesOnLine, hasSuggestion, ruleNoInteger: ruleInt, ruleNoReal: ruleInt && q.ruleNo >= 1 && q.ruleNo <= rulesOnLine,
      });
    }
    say(`${job.id} p${pass}: ${rec.err ? `BROKE ${rec.err}` : 'ok'} questions=${qs.length} cost=${rec.costUsd === null ? 'UNKNOWN' : `$${rec.costUsd.toFixed(5)}`}`);
    if (err === 'deadline') { stoppedBy = 'deadline: a call hung; stopping'; break; }
  }
  if (pass >= 5) break; // never loop forever; the cap normally stops first
}

const counted = questions.length;
const withSuggestion = questions.filter((q) => q.hasSuggestion).length;
const broke = rounds.filter((r) => !r.usable).length;
const unknown = rounds.some((r) => r.costUsd === null);
const cost = rounds.reduce((s, r) => s + (r.costUsd ?? roundCeiling), 0);
const enough = counted >= NEED_QUESTIONS;
const pass = enough && withSuggestion / Math.min(counted, NEED_QUESTIONS) >= BAR_SUGGESTED / NEED_QUESTIONS && broke === 0;
const summary = {
  tag, model: MODEL, rounds: rounds.length, questions: counted, withSuggestion, bar: `at least ${BAR_SUGGESTED} of ${NEED_QUESTIONS} questions carry a suggestion, and no call breaks`,
  brokenCalls: broke, ruleNoInteger: questions.filter((q) => q.ruleNoInteger).length, ruleNoReal: questions.filter((q) => q.ruleNoReal).length,
  stoppedBy, costUsd: unknown ? `at least ${cost.toFixed(5)}` : Number(cost.toFixed(5)),
  verdict: !enough ? 'INCONCLUSIVE (fewer than 10 questions)' : pass ? 'PASS' : 'FAIL',
};
writeFileSync(resultsPath, scrub(`${JSON.stringify({ summary, rounds, questions }, null, 2)}\n`, secrets), { flag: 'wx' });
say(`SUMMARY ${JSON.stringify(summary)}`);
process.exit(summary.verdict === 'PASS' ? 0 : 3);
