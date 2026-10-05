// POC m4d (b): what does fwdloop book for DeepSeek cached input vs DeepSeek's published price?
// Two identical calls (~1500-token fixed prefix); the 2nd should hit DeepSeek's disk cache.
// Never prints the key or headers: raw `usage` is captured by wrapping the provider's _normalizeUsage (it receives data.usage verbatim).
import { Loop } from 'bare-agent';
import { makeProvider } from '../../src/provider.js';

const rawUsage = [];
const { provider, rates, modelId } = makeProvider('deepseek', {});   // exactly as model-step.js (no thinking opt, no LIVE timeouts needed)
const orig = provider._normalizeUsage.bind(provider);
provider._normalizeUsage = (u) => { rawUsage.push(u ?? null); return orig(u); };
const filler = Array.from({ length: 150 }, (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog near the riverbank at dawn.`).join('\n');
const messages = [
  { role: 'system', content: 'You are a terse assistant.' },
  { role: 'user', content: `${filler}\n\nReply with OK.` },
];

// DeepSeek published (peak), USD per 1M tokens; off-peak is half.
const PUB = { miss: 0.30, hit: 0.006, out: 1.20 };
const rows = [];
let bookedTotal = 0; let realPeakTotal = 0; let realOffTotal = 0;
for (let call = 1; call <= 2; call += 1) {
  const events = [];
  const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); } });
  const before = rawUsage.length;
  await loop.run(messages, [], { maxTokens: 32 });
  const raw = rawUsage[before];
  const ev = events[0];
  const u = ev.usage ?? ev;
  const hit = raw?.prompt_cache_hit_tokens ?? raw?.prompt_tokens_details?.cached_tokens ?? u.cacheReadTokens ?? 0;
  const miss = raw?.prompt_cache_miss_tokens ?? ((raw?.prompt_tokens ?? 0) - hit);
  const out = raw?.completion_tokens ?? 0;
  const realPeak = (miss * PUB.miss + hit * PUB.hit + out * PUB.out) / 1e6;
  const booked = ev.costUsd ?? ev.cost ?? null;
  bookedTotal += booked ?? 0; realPeakTotal += realPeak; realOffTotal += realPeak / 2;
  rows.push({
    call, rawUsage: raw,
    mapped: { inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheCreationTokens: u.cacheCreationTokens },
    event: { costUsd: ev.costUsd, rateSource: ev.rateSource, model: ev.model, keys: Object.keys(ev) },
    rawHit: hit, rawMiss: miss, rawOut: out,
    mappedInputPlusCacheRead: (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0),
    rawPromptTokens: raw?.prompt_tokens,
    bookedUsd: booked, realPeakUsd: realPeak, realOffPeakUsd: realPeak / 2,
    // what the same hit tokens are booked at vs real, per 1M
    bookedHitPerM: rates.in * 1000 * 0.1, realHitPerM: PUB.hit,
  });
}
console.log(JSON.stringify({ modelId, rates, rows }, null, 2));
console.log(`TOTAL booked $${bookedTotal.toFixed(6)}  real peak $${realPeakTotal.toFixed(6)}  real off-peak $${realOffTotal.toFixed(6)}  (must be < $0.01)`);
