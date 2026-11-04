// F128 (PAID, pre-registered in docs/logs/FINDINGS.md before any run): bare-agent 0.59 cutOff report on fwdloop's step path. Throwaway POC; never imported by src.
// Usage: BASETEN_API_KEY in env. node poc/f128-cutoff/f128.mjs <outFile> <spendLedger>   (arm A = installed bare-agent 0.57, arm B = installed 0.59)
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Loop } from 'bare-agent';
import { makeProvider, sumMeterings } from '../../src/provider.js';
import { LIVE_PROVIDER_OPTIONS, buildEmitArtifactSchema } from '../../src/model-step.js';

const require = createRequire(import.meta.url);
const version = require('bare-agent/package.json').version;
const arm = version.startsWith('0.59') ? 'B' : 'A';
const [outFile, ledger] = process.argv.slice(2);
if (!process.env.BASETEN_API_KEY?.trim()) { console.error('F128: BASETEN_API_KEY empty. Refused at $0.'); process.exit(2); }
if (existsSync(outFile)) { console.error('F128: outFile exists; use a new one.'); process.exit(2); }
const MODEL = 'meta-models/muse-spark-open-1026'; const N = 5; const CAP = Number(process.env.F128_CAP ?? 0.40); // own spend per script run (pre-registered $0.20 proved too small: reasoning-heavy rounds; overall $1.50 hard cap still holds)
const FROM = Number(process.env.F128_FROM ?? 1);
let own = 0;
const GOAL = 'Write a numbered list of exactly 60 lines (1. to 60.) of tips for running a small bakery. Each line must be a full sentence of at least 12 words. Put the whole list in the text field.';
const SYSTEM = "You are executing one step of a signed, human-authored automation. Call emit_artifact exactly once with this step's result. Ground every value in the reads you were handed or the tools you were granted — never invent a figure.";
const total = () => (existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd ?? 0), 0) : 0);
const complete = (a) => typeof a?.text === 'string' && a.done !== undefined && (a.text.match(/^\s*\d+[.)]/gm) ?? []).length >= 60;
const results = []; let halted = null; let unpriced = false; let errs = 0;

for (let n = FROM; n <= N && !halted; n += 1) {
  const { provider, rates } = makeProvider('BASETEN_API_KEY', { model: MODEL, ...LIVE_PROVIDER_OPTIONS });
  const events = []; let generateCalls = 0;
  const counted = Object.create(provider); counted.generate = async (...a) => { generateCalls += 1; return provider.generate(...a); };
  const rec = { run: n, arm, version, tries: [] };
  let gap = null;
  for (let k = 1; k <= 3; k += 1) {
    if (own >= CAP || total() >= 1.5) { halted = `budget $${CAP} reached`; break; }
    let art;
    const tool = { name: 'emit_artifact', description: "Emit this step's one artifact.", parameters: buildEmitArtifactSchema('softgreen'), execute: async (a) => { art = a; return { ok: true }; } };
    const maxTokens = k === 1 ? 400 : 16000;
    let r;
    try {
      r = await new Loop({ provider: counted, rates, onLlmResult: async (e) => { events.push(e); } })
        .run([{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({ goal: GOAL, reads: {}, gap }) }], [tool], { maxTokens });
      errs = 0;
    } catch (e) { rec.tries.push({ k, thrown: e.message }); errs += 1; if (errs >= 3) halted = '3 provider errors in a row'; break; }
    const cut = r.stopReason === 'max_tokens' || r.error === 'truncated:max_tokens';
    const t = { k, maxTokens, stopReason: r.stopReason ?? null, error: r.error ?? null, cut, cutOff: r.cutOff ?? null, badCalls: r.badCalls ?? null, captured: art !== undefined, complete: complete(art) };
    rec.tries.push(t);
    if (t.complete) break;
    const outTok = sumMeterings(events.slice(-1)).tokens?.outputTokens ?? '?';
    if (cut) gap = arm === 'B' && r.cutOff ? `Your previous reply was cut off by the output cap before any tool call was made. outputTokens=${r.cutOff.outputTokens}, reasoningTokens=${r.cutOff.reasoningTokens ?? 'unreported'}, maxTokensRequested=${r.cutOff.maxTokensRequested}.` : `truncated: ${outTok} tokens, no tool call`;
    else gap = 'no usable tool call';
  }
  const m = sumMeterings(events); own += m.costUsd ?? 0; if (typeof m.costUsd !== 'number') unpriced = true;
  const plain = events.reduce((s, e) => s + (typeof e.costUsd === 'number' ? e.costUsd : NaN), 0);
  const recomputed = events.reduce((s, e) => s + ((e.usage?.inputTokens ?? 0) * 1.25 + (e.usage?.outputTokens ?? 0) * 4.25 + (e.usage?.cacheReadTokens ?? 0) * 1.25 * (rates.cacheReadMult ?? 1)) / 1e6, 0);
  rec.metering = { events: events.length, generateCalls, sumMeterings: m.costUsd, plain, recomputed, tokens: m.tokens, balanced: events.length === generateCalls && Math.abs(m.costUsd - plain) < 1e-9 && Math.abs(m.costUsd - recomputed) < 1e-9 };
  rec.firstTryCut = rec.tries[0]?.cut === true; rec.cutOffPopulated = rec.tries[0]?.cutOff != null; rec.finalComplete = rec.tries.some((t) => t.complete);
  appendFileSync(ledger, `${JSON.stringify({ tag: `f128-${arm}-${n}`, usd: m.costUsd ?? 0 })}\n`);
  results.push(rec);
  writeFileSync(outFile, JSON.stringify({ arm, version, model: MODEL, results, halted, unpriced }, null, 1));
  console.log(`run ${n} arm ${arm}: cut=${rec.firstTryCut} cutOff=${JSON.stringify(rec.tries[0]?.cutOff)} complete=${rec.finalComplete} balanced=${rec.metering.balanced}`);
}
writeFileSync(outFile, JSON.stringify({ arm, version, model: MODEL, results, halted, unpriced }, null, 1));
console.log('DONE', halted ?? 'complete');
