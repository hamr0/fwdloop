// F93: can deepseek-flash fill a typed `priority` box from a frozen ticket page? Paid POC, 25 calls. Pre-registered in docs/logs/FINDINGS.md (F93).
// Mirrors src/model-step.js (system prompt, user JSON {goal, reads, gap}, Loop + emit_artifact + onLlmResult, maxTokens 16000, thinking off).
// Uses the F92 scratch copy (SCRATCH env) for makeProvider; reads pages from ./pages. Key: DEEPSEEK_API_KEY in the env (never printed).
// Run: SCRATCH=<scratch repo> OUT=<dir> node f93.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Loop } from 'bare-agent';
const here = dirname(fileURLToPath(import.meta.url));
const S = process.env.SCRATCH; const OUT = process.env.OUT ?? join(here, 'out');
mkdirSync(OUT, { recursive: true });
const { makeProvider } = await import(pathToFileURL(join(S, 'src/provider.js')).href);
const { LIVE_PROVIDER_OPTIONS } = await import(pathToFileURL(join(S, 'src/model-step.js')).href);

const GOAL = 'read the ticket and pull out its priority and what is broken';
const SYSTEM = 'You are executing one step of a signed, human-authored automation. '
  + 'Call emit_artifact exactly once with this step\'s result. Ground every value in the '
  + 'reads you were handed or the tools you were granted — never invent a figure.';
const SCHEMA = {
  type: 'object',
  properties: {
    priority: { type: ['string', 'null'], description: "the ticket's priority exactly as its own priority label reads (for example P2); null if the ticket carries no priority label. Do not guess it from the ticket's wording." },
    summary: { type: 'string' },
    done: { type: 'boolean', description: "true only if this step's goal was actually accomplished with real data; false if anything blocked it" },
    blocker: { type: ['string', 'null'], description: 'when done is false, one sentence naming what blocked you; null when done is true' },
  },
  required: ['priority', 'done'],
  additionalProperties: false,
};
const PAGES = { p2a: 'P2', p2b: 'P2', p3: 'P3', none: null, p3x: 'P3' };
const N = 5;
const { provider, rates, modelId } = makeProvider('DEEPSEEK_API_KEY', { model: 'deepseek-flash', ...LIVE_PROVIDER_OPTIONS });
const rows = [];
for (const [page, expect] of Object.entries(PAGES)) {
  const text = readFileSync(join(here, 'pages', `${page}.txt`), 'utf8');
  for (let i = 1; i <= N; i += 1) {
    let captured; const meters = []; let err = null; let res = null;
    const t0 = Date.now();
    const tool = { name: 'emit_artifact', description: "Emit this step's one artifact.", parameters: SCHEMA, execute: async (a) => { captured = a; return { ok: true }; } };
    const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { meters.push(ev); } });
    const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({ goal: GOAL, reads: { issue: text }, gap: null }) }];
    try { res = await loop.run(messages, [tool], { maxTokens: 16000 }); } catch (e) { err = String(e?.message ?? e); }
    const costKnown = meters.length > 0 && meters.every((m) => typeof m?.costUsd === 'number');
    rows.push({
      page, i, expect, captured: captured ?? null, rounds: meters.length, err, stopReason: res?.stopReason ?? null,
      costUsd: costKnown ? meters.reduce((s, m) => s + m.costUsd, 0) : null, model: meters.at(-1)?.model ?? null,
      tokens: meters.map((m) => m?.usage ?? null), wallMs: Date.now() - t0,
    });
    console.log(page, i, JSON.stringify(captured?.priority), rows.at(-1).costUsd, err ?? '');
    writeFileSync(join(OUT, 'raw.json'), JSON.stringify({ modelId, rows }, null, 1));
  }
}
// score on the letter
const by = (p) => rows.filter((r) => r.page === p);
const prio = (r) => (r.captured && Object.hasOwn(r.captured, 'priority') ? r.captured.priority : undefined);
const J1n = ['p2a', 'p2b', 'p3'].flatMap(by).filter((r) => prio(r) === r.expect).length;
const J1fold = ['p2a', 'p2b', 'p3'].flatMap(by).filter((r) => typeof prio(r) === 'string' && prio(r).toLowerCase() === r.expect.toLowerCase()).length;
const J2n = by('none').filter((r) => prio(r) === null).length;
const J3n = by('p3x').filter((r) => prio(r) === 'P3').length;
const clean = rows.filter((r) => r.rounds === 1 && !r.err && r.captured && (typeof prio(r) === 'string' || prio(r) === null) && r.captured.done === true).length;
const unmetered = rows.filter((r) => r.costUsd === null).length;
const total = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
const sc = {
  J1: { n: J1n, of: 15, bar: 14, caseFolded: J1fold, verdict: J1n >= 14 ? 'PASS' : 'FAIL' },
  J2: { n: J2n, of: 5, bar: 5, verdict: J2n === 5 ? 'PASS' : 'FAIL' },
  J3: { n: J3n, of: 5, bar: 5, verdict: J3n === 5 ? 'PASS' : 'FAIL' },
  J4: { clean, of: 25, verdict: clean === 25 ? 'PASS' : 'FAIL' },
  J5: { totalUsd: total, unmetered, bar: 0.08, verdict: unmetered === 0 && total < 0.08 ? 'PASS' : 'FAIL' },
};
writeFileSync(join(OUT, 'score.json'), JSON.stringify(sc, null, 1));
console.log(JSON.stringify(sc, null, 1));
