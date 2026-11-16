// F201 paid POC harness: look prompt A (today's mapPrompt + MAP_SYSTEM) vs B (promptB.mjs). Pre-registration: docs/logs/FINDINGS.md "F201".
// usage: node poc/f201-lookprompt/run.mjs --tag <name> [--samples 10] [--cap 0.95] [--dry] [--preflight]
//   --dry        fake provider, $0, no key: proves the harness end to end
//   --preflight  builds the live provider with a dummy key (no call) to prove config, model and price resolve
// Live: key ONLY from env DEEPSEEK_API_KEY (the orchestrator sets it); empty is refused at $0. The key is never printed or written.
// Real call path copied from src/drafter.js makeCallModel: `new Loop({ provider, rates, onLlmResult })`, run([system,user], [], { maxTokens: 16000, thinkingMode }),
// attempt 1 thinking off, the one retry (an unreadable answer) thinking on, every round metered. Not run: the post-checks of lookAtPage (the AI's answer is what is scored).
import fs from 'node:fs';
import path from 'node:path';
import { Loop } from 'bare-agent';
import { MAP_SYSTEM, mapPrompt, parseMapAnswer } from '../../src/pagemap.js';
import { makeProvider } from '../../src/provider.js';
import { LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';
import { DRAFT_MAX_TOKENS } from '../../src/drafter.js';
import { CASES } from './cases.mjs';
import { mapPromptB, MAP_SYSTEM_B } from './promptB.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const has = (k) => process.argv.includes(`--${k}`);
const tag = arg('tag'); const samples = Number(arg('samples', 10)); const cap = Number(arg('cap', 0.95));
const dry = has('dry'); const preflight = has('preflight');
const OUT = path.resolve(import.meta.dirname, '../../.claude/scratch/f201');
const stop = (m) => { console.error(`STOP: ${m}`); process.exit(1); };
if (!/^[a-z0-9][a-z0-9-]*$/.test(tag ?? '')) stop('--tag <name> is required (letters, digits, dash)');
if (!Number.isFinite(samples) || samples < 1 || !Number.isFinite(cap) || cap <= 0) stop('bad --samples / --cap');

const ARMS = { A: { system: MAP_SYSTEM, prompt: mapPrompt }, B: { system: MAP_SYSTEM_B, prompt: mapPromptB } };

// ---- the provider
let provider; let rates; let modelId;
if (dry) {
  rates = { in: 0.0006, out: 0.0012 }; modelId = 'fake';
  // fixed valid answer per arm; reads the prompt only to name the job's own lines and rules (B lists a "friendly"-like rule as cannot, A ties every rule)
  provider = { async generate(msgs) {
    const u = msgs[msgs.length - 1].content; const arm = u.includes('"cannot"') ? 'B' : 'A';
    const facts = []; const cannot = []; let line = 0;
    for (const m of u.split('PAGE TEXT')[0].split('\n')) {
      const l = /^LINE (\d+):/.exec(m); if (l) { line = Number(l[1]); continue; }
      const r = /^~ rule (\d+): (.*)$/.exec(m); if (!r) continue;
      if (arm === 'B' && /friendly/.test(r[2])) cannot.push({ from: `line ${line} rule ${r[1]}`, why: 'fake' });
      else facts.push({ name: `fact ${line} ${r[1]}`, from: `line ${line} rule ${r[1]}`, shape: 'phrase', words: ['x'], ...(arm === 'B' ? { why: 'fake' } : {}) });
    }
    return { text: JSON.stringify(arm === 'B' ? { facts, cannot } : { facts }), toolCalls: [], usage: { inputTokens: 1000, outputTokens: 200 }, stopReason: 'stop', model: 'fake' };
  } };
} else {
  const env = preflight ? { DEEPSEEK_API_KEY: 'dummy-preflight' } : process.env;
  if (!preflight && !(process.env.DEEPSEEK_API_KEY ?? '').trim()) stop('DEEPSEEK_API_KEY is empty: refused at $0, nothing sent');
  try { ({ provider, rates, modelId } = makeProvider('DEEPSEEK_API_KEY', { model: 'deepseek-flash', env, ...LIVE_PROVIDER_OPTIONS })); } catch (e) { stop(`provider: ${e.message}`); }
  if (!rates || !(rates.in > 0) || !(rates.out > 0)) stop('no price for the model: refused, never priced as 0');
}
if (preflight) { console.log(`preflight ok: model ${modelId}, rates per 1K in ${rates.in} out ${rates.out}, maxTokens ${DRAFT_MAX_TOKENS}, ${JSON.stringify(LIVE_PROVIDER_OPTIONS)}; no call made`); process.exit(0); }

// ---- the results file: a tag that already has results is refused, never overwritten
const file = path.join(OUT, `results-${tag}.jsonl`);
if (fs.existsSync(file)) stop(`${file} already has results: use a new tag`);
const fd = fs.openSync(file, 'wx');
const write = (row) => fs.writeSync(fd, `${JSON.stringify(row)}\n`);

/** one look: the real call path, once more (thinking on) if the answer is unreadable. Returns the row's measured parts. */
async function look(arm, c) {
  const content = ARMS[arm].prompt({ jobLines: c.jobLines, label: c.label, text: c.text });
  const rounds = []; let parsed = { ok: false }; let error = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const events = [];
    const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); } });
    let res = null;
    try { res = await loop.run([{ role: 'system', content: ARMS[arm].system }, { role: 'user', content }], [], { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: attempt === 1 ? 'off' : 'on' }); } catch (e) { error = e.message; }
    const cost = events.length === 0 ? null : events.every((e) => e.costUsd != null) ? events.reduce((s, e) => s + e.costUsd, 0) : null;
    const text = res?.text ?? '';
    const cutOff = res?.stopReason === 'max_tokens';
    rounds.push({ attempt, text, cutOff, stopReason: res?.stopReason ?? null, costUsd: cost, unpriced: events.length === 0 || cost === null, tokens: events.map((e) => e.usage ?? null), model: events[events.length - 1]?.model ?? null, error: error ?? res?.error ?? null });
    if (error || (res?.error && !cutOff)) break;
    parsed = cutOff ? { ok: false } : parseMapAnswer(text);
    if (parsed.ok) break;
  }
  return { rounds, parsed, error };
}

const refOf = (from) => { const m = /^line\s+(\d+)(?:\s+rule\s+(\d+))?$/i.exec(String(from ?? '').trim()); return m ? { line: Number(m[1]), rule: m[2] === undefined ? null : Number(m[2]) } : null; };
let spent = 0; let calls = 0; let stopped = null; let redRun = 0;
outer: for (let s = 1; s <= samples; s += 1) {
  for (const c of CASES) {
    for (const arm of ['A', 'B']) {
      if (spent >= cap) { stopped = `cap: spent $${spent.toFixed(4)} >= $${cap} before ${arm}/${c.id}/${s}`; break outer; }
      const { rounds, parsed, error } = await look(arm, c);
      calls += 1;
      const unpriced = rounds.some((r) => r.unpriced);
      const cost = unpriced ? null : rounds.reduce((x, r) => x + r.costUsd, 0);
      const raw = (() => { try { return JSON.parse(rounds[rounds.length - 1].text.trim()); } catch { return null; } })();
      const facts = parsed.ok ? parsed.mapping.facts.map((f) => ({ name: f.name, from: f.from ?? null, ref: refOf(f.from), shape: f.shape, words: f.words, why: f.why ?? null, reading: f.reading ?? null })) : [];
      const cannot = parsed.ok && Array.isArray(raw?.cannot) ? raw.cannot.map((x) => ({ from: x?.from ?? null, ref: refOf(x?.from), why: x?.why ?? null })) : [];
      write({ arm, case: c.id, sample: s, ok: parsed.ok, unreadable: !parsed.ok, error, attempts: rounds.length, rounds, facts, cannot, costUsd: cost, priced: !unpriced });
      if (unpriced) { stopped = `unpriced round at ${arm}/${c.id}/${s}: stopped, never priced as 0`; break outer; }
      spent += cost;
      redRun = error ? redRun + 1 : 0;
      if (redRun >= 3) { stopped = `3 provider errors in a row (last: ${error})`; break outer; }
    }
  }
}
fs.closeSync(fd);
console.log(`${dry ? 'DRY ' : ''}tag ${tag}: ${calls} looks written to ${path.relative(process.cwd(), file)}; spent $${spent.toFixed(4)} (cap $${cap})${stopped ? `; STOPPED EARLY: ${stopped}` : ''}`);
