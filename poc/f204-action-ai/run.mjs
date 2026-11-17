// F204 harness: two AI asks for the job's final action (RECOGNISE, SUGGEST), forced typed tool call, the real call path of src/drafter.js `forcedTurn`
// (Loop + onLlmResult metering, HaltError-capturing tool, maxTokens 16000, thinkingMode 'off' because DeepSeek cannot combine thinking with a forced call,
// LIVE_PROVIDER_OPTIONS timeout 300s). Model deepseek-flash direct; key ONLY from env DEEPSEEK_API_KEY; prices from the real config.
// usage: node poc/f204-action-ai/run.mjs --tag <tag> [--dry] [--preflight]      (paid: DEEPSEEK_API_KEY from env, tag e.g. paid1)
import { openSync, closeSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop, HaltError } from 'bare-agent';
import { makeProvider, readPriceConfig, resolveUsableModel, ceilingCostUsd, checkKeyPreflight } from '../../src/provider.js';
import { LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';
import { DRAFT_MAX_TOKENS } from '../../src/drafter.js';
import { CASES, DESTINATION } from './cases.mjs';
import {
  RECOGNISE_SYSTEM, SUGGEST_SYSTEM, RECOGNISE_SCHEMA, SUGGEST_SCHEMA, RECOGNISE_TOOL, SUGGEST_TOOL, jobView,
} from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const PREFLIGHT = args.includes('--preflight');
const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : undefined;
const SLOT = 'DEEPSEEK_API_KEY';
const MODEL = 'deepseek-flash';
const SAMPLES = 5;
const CAP_USD = 0.90;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

if (!PREFLIGHT && (tag === undefined || !/^[A-Za-z0-9_-]+$/.test(tag))) { console.error('usage: --tag <tag> [--dry] [--preflight]'); process.exit(2); }

// ---- the provider: real (key from env, refuse at $0 if empty) or the fake
let provider; let rates; let prices = null;
if (DRY) {
  const u = resolveUsableModel(SLOT, { config: readPriceConfig(), model: MODEL });
  if (!u.ok) { console.error(u.say); process.exit(2); }
  ({ rates, prices } = u);
  provider = fakeProvider();
} else {
  const key = checkKeyPreflight(SLOT, process.env);
  if (!key.ok) { console.error(`REFUSED at $0: ${key.message}`); process.exit(2); }
  const m = makeProvider(SLOT, { model: MODEL, ...LIVE_PROVIDER_OPTIONS });
  ({ provider, rates, prices } = m);
}

if (PREFLIGHT) {
  console.log(`preflight ok: model ${MODEL} slot ${SLOT} dry=${DRY} prices ${JSON.stringify(prices?.perM)} maxTokens ${DRAFT_MAX_TOKENS} ${JSON.stringify(LIVE_PROVIDER_OPTIONS)} ceiling/round $${ceilingCostUsd(rates, 2000).toFixed(4)}`);
  for (const c of CASES) { const v = jobView(c.job, DESTINATION); console.log(`${c.id} ${c.kind} lines ${v.count} asks ${JSON.stringify(v.askLines)} expected ${JSON.stringify(c.expected)}`); }
  process.exit(0);
}

const outDir = join(HERE, 'out');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${tag}.jsonl`);
if (existsSync(outPath)) { console.error(`REFUSED: ${outPath} already has results; use a new tag`); process.exit(2); }
closeSync(openSync(outPath, 'wx'));
const write = (row) => appendFileSync(outPath, `${JSON.stringify(row)}\n`);

let spent = 0;
let calls = 0;

/** ONE forced-tool round. Returns { args, rawText, cost, estimated, threw }. A round with no usage is priced at the CEILING and marked. */
async function forcedRound({ system, user, name, desc, schema }) {
  /** @type {any} */ let captured;
  const events = [];
  const tool = { name, description: desc, parameters: schema, execute: async (a) => { captured = a; throw new HaltError(`${name} captured`, { rule: 'captured' }); } };
  const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); } });
  let res; let threw = null;
  try {
    res = await loop.run([{ role: 'system', content: system }, { role: 'user', content: user }], [tool], { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: 'off', toolChoice: { name } });
  } catch (e) { threw = e; }
  const ceiling = ceilingCostUsd(rates, system.length + user.length + JSON.stringify(schema).length);
  const priced = events.length > 0 && events.every((e) => typeof e.costUsd === 'number');
  const cost = priced ? events.reduce((s, e) => s + e.costUsd, 0) : ceiling;
  const malformed = provider?.lastMalformedToolCall ?? null;
  return {
    args: isObj(captured) ? captured : null,
    rawText: typeof res?.text === 'string' && res.text !== '' ? res.text : (typeof malformed?.rawArguments === 'string' ? malformed.rawArguments : null),
    stopReason: res?.stopReason ?? null,
    cost, estimated: !priced, threw: threw && !(captured && threw instanceof HaltError) ? String(threw.message ?? threw) : null,
    modelReturned: events[0]?.model ?? null,
  };
}

/** code's checks (never the model's say): RECOGNISE. line must be the LAST line, else refused. */
export function judgeRecognise(args, view) {
  const a = args?.action;
  if (!isObj(a) || !('line' in a)) return { verdict: 'unreadable' };
  const { line } = a;
  if (line !== null && !Number.isInteger(line)) return { verdict: 'unreadable' };
  if (line === null) return { verdict: 'null', line: null };
  if (line !== view.count) return { verdict: 'refused', why: 'not the last line', line };
  return { verdict: 'accepted', line };
}
/** code's checks: SUGGEST = one non-empty line, at most 100 characters. `says` (the pre-registered bar-2 check, scored not gated):
 *  the text contains the Destination path, or a word starting write / save / send (case-insensitive). */
export const MAX_SUGGEST_CHARS = 100;
export function judgeSuggest(args) {
  if (!isObj(args) || typeof args.text !== 'string') return { verdict: 'unreadable' };
  const t = args.text.trim();
  const oneLine = t !== '' && !/[\r\n]/.test(args.text) && t.length <= MAX_SUGGEST_CHARS;
  const says = args.text.includes(DESTINATION) || /\b(write|save|send)/i.test(args.text);
  return { verdict: oneLine ? 'accepted' : 'refused', why: oneLine ? undefined : 'not one short line', oneLine, says };
}

async function ask(c, sample, which) {
  const view = jobView(c.job, DESTINATION);
  const isRec = which === 'recognise';
  const spec = isRec
    ? { system: RECOGNISE_SYSTEM, user: view.text, name: RECOGNISE_TOOL, desc: 'Say which last step, if any, writes or sends everything that came before it.', schema: RECOGNISE_SCHEMA }
    : { system: SUGGEST_SYSTEM, user: view.text, name: SUGGEST_TOOL, desc: 'Suggest the one new last step that writes or sends everything that came before it to the Destination.', schema: SUGGEST_SCHEMA };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (spent >= CAP_USD) { write({ case: c.id, sample, ask: which, attempt, stop: 'cap', spent }); return 'cap'; }
    calls += 1;
    const r = await forcedRound(spec);
    spent += r.cost;
    const judged = r.args ? (isRec ? judgeRecognise(r.args, view) : judgeSuggest(r.args)) : { verdict: 'unreadable' };
    const noUsage = r.estimated;
    const final = (r.args !== null && !noUsage) || attempt === 2;
    write({ case: c.id, sample, ask: which, attempt, final, raw: r.args ?? r.rawText, parsed: judged, stopReason: r.stopReason, threw: r.threw, cost: r.cost, estimatedAtCeiling: r.estimated, model: r.modelReturned, spentSoFar: spent });
    if (final) return 'ok';
  }
  return 'ok';
}

// ---- interleaved: sample 1 of every case, then sample 2 ...; the SUGGEST ask runs on the no-action cases every sample (independent of what RECOGNISE answered)
let capped = false;
for (let s = 1; s <= SAMPLES && !capped; s += 1) {
  for (const c of CASES) {
    if (await ask(c, s, 'recognise') === 'cap') { capped = true; break; }
    if (c.kind === 'none' && await ask(c, s, 'suggest') === 'cap') { capped = true; break; }
  }
}
write({ done: true, calls, spent, capped, dry: DRY });
console.log(`${DRY ? 'DRY ' : ''}done: ${calls} calls, spent $${spent.toFixed(5)}, capped ${capped}, results ${outPath}`);

// ---- fake provider for --dry: mostly right, with one wrong-but-valid, one wrong line, one text answer, one no-usage throw, so every code path shows
function fakeProvider() {
  let n = 0;
  const reply = (name, a) => ({ text: '', toolCalls: [{ id: `c${n}`, name, arguments: a }], usage: { inputTokens: 600, outputTokens: 40 }, stopReason: 'tool_calls', model: 'fake' });
  return {
    lastMalformedToolCall: null,
    async generate(messages, tools) {
      n += 1;
      const name = tools[0].name;
      const user = messages.find((m) => m.role === 'user').content;
      const lines = [...user.matchAll(/^(\d+)\. /gm)].length;
      const lastIsAction = /(write it out|once I accept)/i.test(user.split('\n').filter((l) => /^\d+\. /.test(l)).pop());
      if (n === 7) throw new Error('socket hang up');
      if (n === 9) return { text: 'I think it is the last line.', toolCalls: [], usage: { inputTokens: 600, outputTokens: 20 }, stopReason: 'stop', model: 'fake' };
      if (name === RECOGNISE_TOOL) {
        if (n === 11) return reply(name, { action: { line: 1 } });
        return reply(name, { action: { line: lastIsAction ? lines : null } });
      }
      if (n === 14) return reply(name, { text: 'first line\nsecond line' });
      return reply(name, { text: n % 5 === 0 ? 'Then it is done.' : 'Write it all out to the Destination.' });
    },
  };
}
