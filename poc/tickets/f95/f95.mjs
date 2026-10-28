// F95: typed boxes with `unsure`, code decides RUN/SKIP/HITL by bareguard `in`. Pre-registered in docs/logs/FINDINGS.md (F95).
// Same call path as poc/tickets/f93/f93.mjs. Run: SCRATCH=<scratch repo> N=3 OUT=<dir> node f95.mjs   (SELFTEST=1: $0 decision-function test, no provider)
// The boxes and their descriptions below are HAND-WRITTEN (in a build the drafter proposes them and hamr signs them).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const S = process.env.SCRATCH; const OUT = process.env.OUT ?? join(here, 'out'); const N = Number(process.env.N ?? 3);
const BUDGET = 0.30;
mkdirSync(OUT, { recursive: true });
const bg = await import(pathToFileURL(join(S, 'node_modules/bareguard/src/index.js')).href);
const { createRubric, checkStep } = bg;

const PRIORITY_SET = ['P0', 'P1', 'P2', 'P3', 'none', 'unsure'];
const TOPIC_SET = ['crash-or-hang', 'other', 'unsure'];
// guardrails: `priority P2 only` -> in ['P2'] on box priority; `only crashes or hangs` -> in ['crash-or-hang'] on box topic
const RULES = [
  { id: 'priority', rule: 'in', field: 'priority', values: ['P2'] },
  { id: 'topic', rule: 'in', field: 'topic', values: ['crash-or-hang'] },
];
const rubric = createRubric({ schema: 1, goal: 'ticket filter', checkpoints: { filter: { gating: true, checks: RULES }, }, maxReds: 5 });

// code decision: bareguard `in` per box; unsure beats skip
export async function decide(boxes) {
  const res = await checkStep(rubric, 'filter', boxes);
  if (res.verdict === 'stopped') return { decision: 'RED', rows: [], why: 'checkStep stopped' };
  const gaps = res.verdict === 'red' ? res.gaps : [];
  if (gaps.length === 0) return { decision: 'RUN', rows: [] };
  const rows = gaps.map((g) => ({ rule: g.id, kind: g.kind ?? g.reason ?? null, measured: g.measured ?? null, raw: g }));
  const bad = rows.find((r) => !(r.kind === 'not-in' || /not-in/.test(JSON.stringify(r.raw))));
  if (bad) return { decision: 'RED', rows, why: 'a box was missing / wrong type' };
  if (rows.some((r) => r.measured === 'unsure' || JSON.stringify(r.raw).includes('"unsure"'))) return { decision: 'HITL', rows };
  return { decision: 'SKIP', rows };
}

if (process.env.SELFTEST) {
  for (const b of [{ priority: 'P2', topic: 'crash-or-hang' }, { priority: 'P3', topic: 'crash-or-hang' }, { priority: 'P2', topic: 'other' }, { priority: 'unsure', topic: 'crash-or-hang' }, { priority: 'P3', topic: 'unsure' }, { priority: 'P3', topic: 'other' }, { priority: 'none', topic: 'other' }, { priority: 'P2' }, { priority: 'P2', topic: 5 }]) {
    const d = await decide(b); console.log(JSON.stringify(b), d.decision, JSON.stringify(d.rows.map((r) => [r.rule, r.kind, r.measured])), d.why ?? '');
  }
  process.exit(0);
}

const { Loop } = await import('bare-agent');
const { makeProvider } = await import(pathToFileURL(join(S, 'src/provider.js')).href);
const { LIVE_PROVIDER_OPTIONS } = await import(pathToFileURL(join(S, 'src/model-step.js')).href);
const GOAL = 'read the ticket into the two boxes: its priority and what kind of problem it reports';
const SYSTEM = 'You are executing one step of a signed, human-authored automation. '
  + 'Call emit_artifact exactly once with this step\'s result. Ground every value in the '
  + 'reads you were handed or the tools you were granted — never invent a figure.';
const SCHEMA = {
  type: 'object',
  properties: {
    priority: { type: 'string', enum: PRIORITY_SET, description: "the ticket's priority. Use the ticket's priority LABEL if it has one that names a P0..P3 number in any spelling (for example 'P2', 'Priority: P2', 'priority : P2-High' is P2). If it has no priority label, a line in the ticket's own text such as 'Priority: P2' counts. If both exist, the label wins. 'none' when the ticket has neither a priority label nor such a line. 'unsure' when a priority is stated but not as a P0..P3 number (for example 'important-soon', 'high'), or you cannot tell. Do not guess it from the ticket's wording or tone." },
    topic: { type: 'string', enum: TOPIC_SET, description: "'crash-or-hang' when the ticket reports a program, tool or process crashing, panicking, aborting or hanging/freezing. 'other' when it clearly reports something else (wrong output, an error response, a feature request, a UI defect, slowness, a question). 'unsure' when you cannot tell which." },
    basis: { type: 'string', description: 'a short quote of the label or text line you used for priority' },
    done: { type: 'boolean', description: "true only if this step's goal was actually accomplished with real data; false if anything blocked it" },
    blocker: { type: ['string', 'null'], description: 'when done is false, one sentence naming what blocked you; null when done is true' },
  },
  required: ['priority', 'topic', 'done'],
  additionalProperties: false,
};
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8'));
const ids = Object.keys(expected).filter((k) => !k.startsWith('_'));
const { provider, rates, modelId } = makeProvider('DEEPSEEK_API_KEY', { model: 'deepseek-flash', ...LIVE_PROVIDER_OPTIONS });
const rows = []; let spent = 0; let aborted = false;
outer: for (let i = 1; i <= N; i += 1) {
  for (const id of ids) {
    if (spent > BUDGET) { aborted = true; break outer; }
    const text = readFileSync(join(here, 'pages', `${id}.txt`), 'utf8');
    let captured; const meters = []; let err = null;
    const t0 = Date.now();
    const tool = { name: 'emit_artifact', description: "Emit this step's one artifact.", parameters: SCHEMA, execute: async (a) => { captured = a; return { ok: true }; } };
    const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { meters.push(ev); } });
    const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({ goal: GOAL, reads: { ticket: text }, gap: null }) }];
    try { await loop.run(messages, [tool], { maxTokens: 16000 }); } catch (e) { err = String(e?.message ?? e); }
    const costKnown = meters.length > 0 && meters.every((m) => typeof m?.costUsd === 'number');
    const cost = costKnown ? meters.reduce((s, m) => s + m.costUsd, 0) : null; spent += cost ?? 0.01;
    let d = { decision: 'RED', rows: [], why: err ?? 'no artifact' };
    if (captured) { try { d = await decide({ priority: captured.priority, topic: captured.topic }); } catch (e) { d = { decision: 'RED', rows: [], why: String(e) }; } }
    const inSet = !!captured && PRIORITY_SET.includes(captured.priority) && TOPIC_SET.includes(captured.topic) && typeof captured.done === 'boolean' && !err;
    rows.push({ id, call: i, expected: expected[id].decision, decision: d.decision, boxes: captured ? { priority: captured.priority, topic: captured.topic, basis: captured.basis ?? null, done: captured.done } : null, skipRow: d.decision === 'SKIP' ? { ticket: id, boxes: { priority: captured.priority, topic: captured.topic }, failed: d.rows.map((r) => r.rule) } : null, inSet, err, cost, rounds: meters.length, wallMs: Date.now() - t0 });
    console.log(i, id, d.decision, `(exp ${expected[id].decision})`, captured?.priority, captured?.topic, cost?.toFixed(5), `spent ${spent.toFixed(4)}`);
    writeFileSync(join(OUT, 'raw.json'), JSON.stringify({ modelId, N, rows }, null, 1));
  }
}
const by = (id) => rows.filter((r) => r.id === id);
const Q1 = ids.map((id) => ({ id, ok: by(id).filter((r) => r.decision === expected[id].decision).length, of: by(id).length }));
const Q2bad = rows.filter((r) => r.expected !== 'SKIP' && r.decision === 'SKIP');
const unsureBox = (id, box) => by(id).filter((r) => r.boxes?.[box] === 'unsure').length;
const Q3 = { f180865_topic_unsure: unsureBox('f180865', 'topic'), k124871_priority_unsure: unsureBox('k124871', 'priority'), of: N };
const is = (id, v) => by(id).filter((r) => r.boxes?.priority === v).length;
const Q4 = { s2_P3: is('s2', 'P3'), s1_P2: is('s1', 'P2'), h11_P2: is('h11', 'P2'), of: N };
const Q5bad = rows.filter((r) => !r.inSet);
const unmetered = rows.filter((r) => r.cost === null).length;
const sc = {
  aborted, calls: rows.length, N,
  Q1: { perTicket: Q1, verdict: !aborted && Q1.every((x) => x.ok === N && x.of === N) ? 'PASS' : 'FAIL' },
  Q2: { wrongSkips: Q2bad.map((r) => `${r.id}#${r.call}`), verdict: Q2bad.length === 0 && !aborted ? 'PASS' : 'FAIL' },
  Q3: { ...Q3, verdict: Q3.f180865_topic_unsure >= 2 && Q3.k124871_priority_unsure >= 2 ? 'PASS' : 'FAIL' },
  Q4: { ...Q4, verdict: Q4.s2_P3 === N && Q4.s1_P2 === N && Q4.h11_P2 === N ? 'PASS' : 'FAIL' },
  Q5: { bad: Q5bad.map((r) => `${r.id}#${r.call}`), verdict: Q5bad.length === 0 ? 'PASS' : 'FAIL' },
  Q6: { totalUsd: spent, unmetered, verdict: unmetered === 0 && spent < BUDGET && !aborted ? 'PASS' : 'FAIL' },
};
writeFileSync(join(OUT, 'score.json'), JSON.stringify(sc, null, 1));
console.log(JSON.stringify(sc, null, 1));
