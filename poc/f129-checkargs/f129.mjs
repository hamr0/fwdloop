// F129 (pre-registered in docs/logs/FINDINGS.md before any run): bare-agent 0.59 checkArgs. Throwaway POC; never imported by src.
// Usage: node poc/f129-checkargs/f129.mjs <outFile> <part: free|smoke> [spendLedger]   (run from a tree whose bare-agent is 0.59.0; smoke needs BASETEN_API_KEY)
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Loop } from 'bare-agent';
import { makeProvider, sumMeterings } from '../../src/provider.js';
import { LIVE_PROVIDER_OPTIONS, buildEmitArtifactSchema } from '../../src/model-step.js';

const require = createRequire(import.meta.url);
const version = require('bare-agent/package.json').version;
const [outFile, part, ledger] = process.argv.slice(2);
const out = { bareAgent: version, part };
const schema = { type: 'object', properties: { text: { type: 'string' }, done: { type: 'boolean' } }, required: ['text', 'done'] };

if (part === 'free') {
  const calls = [];
  const tool = { name: 'emit_artifact', description: 'emit', parameters: schema, execute: async (a) => { calls.push(a); return { ok: true }; } };
  const script = [
    [{ id: 'c1', name: 'emit_artifact', arguments: { text: 42, done: true } }],
    [{ id: 'c2', name: 'emit_artifact', arguments: { done: true } }],
    [{ id: 'c3', name: 'emit_artifact', arguments: { text: 'ok', done: true } }],
    [],
  ];
  let n = 0; const seen = [];
  const provider = { generate: async (messages) => { seen.push(messages.length); const toolCalls = script[n] ?? []; n += 1; return { text: toolCalls.length ? '' : 'finished', toolCalls, usage: { inputTokens: 10, outputTokens: 5 }, model: 'fake' }; } };
  const loop = new Loop({ provider, checkArgs: true });
  const r = await loop.run([{ role: 'user', content: 'go' }], [tool], { maxTokens: 100 });
  out.calls = calls; out.badCalls = r.badCalls ?? null; out.rounds = n; out.error = r.error ?? null;
  const toolMsgs = r.messages?.filter?.((m) => m.role === 'tool').map((m) => String(m.content).slice(0, 120)) ?? null;
  out.toolMessages = toolMsgs;
  const bc = r.badCalls ?? [];
  out.bars = {
    b1_notExecutedOnBad: calls.every((c) => c.text === 'ok') && !calls.some((c) => c.text === 42 || c.text === undefined),
    b2_badCalls: bc.some((b) => b.kind === 'arg-type' && b.tool === 'emit_artifact' && b.param === 'text') && bc.some((b) => b.kind === 'arg-missing' && b.tool === 'emit_artifact' && b.param === 'text'),
    b3_continuedAndCorrectedExecuted: calls.length === 1 && calls[0].text === 'ok' && n >= 3,
  };
  // negative control: same script with checkArgs OFF must execute the bad calls (shows the check above can fail)
  const calls0 = []; n = 0;
  const tool0 = { ...tool, execute: async (a) => { calls0.push(a); return { ok: true }; } };
  const r0 = await new Loop({ provider }).run([{ role: 'user', content: 'go' }], [tool0], { maxTokens: 100 });
  out.control = { checkArgsOff_executedCalls: calls0.length, badCalls: r0.badCalls ?? null, wouldFailB1: !(calls0.every((c) => c.text === 'ok')) };
  writeFileSync(outFile, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out.bars), 'control', JSON.stringify(out.control));
} else {
  if (!process.env.BASETEN_API_KEY?.trim()) { console.error('F129: BASETEN_API_KEY empty. Refused at $0.'); process.exit(2); }
  const MODEL = 'meta-models/muse-spark-open-1026';
  const goals = ['Summarise in exactly 3 short lines why a bakery might start a loyalty card. Facts: stamps per purchase, 10 stamps earn a free loaf.',
    'Write 3 short lines welcoming customers to a bakery. Facts: opens 7am, closes 5pm, closed Mondays.',
    'Write 3 short lines about sourdough. Facts: 24 hour ferment, stone-baked, sold out by noon.'];
  const total = () => (ledger && existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd ?? 0), 0) : 0);
  const runs = []; let spent = 0; let unpriced = false; let halted = null;
  for (const checkArgs of [true, false]) {
    for (let i = 0; i < goals.length; i += 1) {
      if (spent >= 0.05 || total() >= 1.5) { halted = 'smoke cap $0.05'; break; }
      const { provider, rates } = makeProvider('BASETEN_API_KEY', { model: MODEL, ...LIVE_PROVIDER_OPTIONS });
      let art; const events = [];
      const tool = { name: 'emit_artifact', description: "Emit this step's one artifact.", parameters: buildEmitArtifactSchema('softgreen'), execute: async (a) => { art = a; return { ok: true }; } };
      const system = "You are executing one step of a signed, human-authored automation. Call emit_artifact exactly once with this step's result. Ground every value in the reads you were handed or the tools you were granted — never invent a figure.";
      const r = await new Loop({ provider, rates, checkArgs, onLlmResult: async (e) => { events.push(e); } })
        .run([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ goal: goals[i], reads: {}, gap: null }) }], [tool], { maxTokens: 16000 });
      const m = sumMeterings(events); if (typeof m.costUsd !== 'number') unpriced = true; spent += m.costUsd ?? 0;
      if (ledger) appendFileSync(ledger, `${JSON.stringify({ tag: `f129-${checkArgs}-${i}`, usd: m.costUsd ?? 0 })}\n`);
      runs.push({ checkArgs, i, error: r.error ?? null, hasBadCallsKey: 'badCalls' in r, badCalls: r.badCalls ?? null, artifactKeys: art ? Object.keys(art).sort() : null, usd: m.costUsd });
    }
  }
  out.runs = runs; out.spent = spent; out.unpriced = unpriced; out.halted = halted;
  const on = runs.filter((x) => x.checkArgs); const off = runs.filter((x) => !x.checkArgs);
  out.bar4 = {
    noFalseBadCalls: on.length === 3 && on.every((x) => !x.hasBadCallsKey),
    allCaptured: on.length === 3 && on.every((x) => x.artifactKeys),
    sameShape: on.every((x) => x.artifactKeys && off[0]?.artifactKeys && JSON.stringify(x.artifactKeys) === JSON.stringify(off[0].artifactKeys)) && off.every((x) => x.artifactKeys),
  };
  writeFileSync(outFile, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out.bar4), `spent $${spent.toFixed(4)}`);
}
