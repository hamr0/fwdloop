// F187 (never ships). Paid POC: deepseek-flash answers bareloop v0.56.0's row-edit turn (vendor/rowedit.js unchanged), called the way src/drafter.js calls its forced tool turn;
// the reply is applied by the copied block (vendor/checkblock.js applyDelta + reconcile, as bareloop authorflow.js@v0.56.0 does). Hard cap $0.30.
// Usage: DEEPSEEK_API_KEY="$(pass amr/deepseek_api | head -n1 | tr -d '\r\n')" node poc/f187-rowedit/run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Loop, HaltError } from 'bare-agent';
import { parseSignedText } from '../../src/signed-text.js';
import { makeProvider, sumMeterings } from '../../src/provider.js';
import { LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';
import { DRAFT_MAX_TOKENS } from '../../src/drafter.js';

if (!(process.env.DEEPSEEK_API_KEY ?? '').trim()) { console.error('DEEPSEEK_API_KEY is empty: refusing to start, no call made'); process.exit(2); }
const CAP = 0.30;
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH = '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/3ce0f482-5c76-4fdf-a7f3-a80f5a98d7a7/scratchpad/bg035';
const vendorDir = path.join(SCRATCH, 'vendor');
fs.rmSync(vendorDir, { recursive: true, force: true });
fs.cpSync(path.join(here, '../f185-block/vendor'), vendorDir, { recursive: true });
for (const dep of ['litectx', 'bare-agent']) {
  const lc = path.join(SCRATCH, 'node_modules', dep);
  if (!fs.existsSync(lc)) fs.symlinkSync(path.resolve(here, '../../node_modules', dep), lc);
}
const imp = (f) => import(pathToFileURL(path.join(vendorDir, f)).href);
const { CheckBlock } = await imp('checkblock.js');
const { ROW_EDIT_SYSTEM, rowEditUserText, rowEditChannel, editsOf } = await imp('rowedit.js');

// step lines only (POC 2 adapter: ask and send lines out; these two fixtures have no sheet lines)
const stepLines = (prose) => {
  const p = parseSignedText(prose);
  if (!p.ok) throw new Error(p.reds.join('|'));
  const skip = new Set([...p.arbiter.asks.map((a) => a.line), ...p.arbiter.sends.map((s) => s.line)]);
  return p.lines.filter((l) => !skip.has(l.n)).map((l) => ({ n: l.n, text: l.text, rules: l.guardrail ? l.guardrail.split('; ').map((s) => s.trim()).filter(Boolean) : [] }));
};
const rd = (p) => fs.readFileSync(path.join(here, '../f185-block/fixtures', p), 'utf8');
const jobs = [
  { id: 'm14-walk-5', prose: rd('m14-walk-5/prose.txt'), texts: { notes: rd('m14-walk-5/notes.md') }, look: null },
  { id: 'flights', prose: rd('flights/draft-prose.txt'), texts: { flights: rd('flights/flights.txt') }, look: JSON.parse(rd('flights/page-look.json')).look },
];

// the provider exactly as the drafter builds it: the slot is the KEY NAME
const { provider, rates, modelId } = makeProvider('DEEPSEEK_API_KEY', { model: 'deepseek-flash', env: process.env, ...LIVE_PROVIDER_OPTIONS });
console.log(`model ${modelId}; maxTokens ${DRAFT_MAX_TOKENS}; timeoutMs ${LIVE_PROVIDER_OPTIONS.timeoutMs}; thinkingMode off per call`);
const channel = rowEditChannel(false);
const meterings = []; let calls = 0; let unmetered = 0;
const results = [];
// SUPPLEMENT (decides nothing): F187_ASKS=1 builds the block with asks:true and gives the person's typed Agree (no AI) after the reply, m14 only
const ASKS = process.env.F187_ASKS === '1';

for (const j of jobs.filter((x) => !ASKS || x.id === 'm14-walk-5')) for (let i = 1; i <= 5; i += 1) {
  const spent = sumMeterings(meterings).costUsd ?? 0;
  if (spent > CAP - 0.03) { console.log(`STOP: spend ${spent} too near cap`); break; }
  const jobLines = stepLines(j.prose);
  const block = new CheckBlock({ texts: j.texts, labels: Object.keys(j.texts), asks: ASKS, ...(ASKS ? { split: true } : {}) });
  block.fromJob(jobLines);
  block.addLook(j.look?.facts ?? [], j.look?.dropped ?? []);
  block.reconcile();
  const userText = rowEditUserText({ jobLines, look: j.look ? { prose: [], notFound: [], ...j.look } : null, texts: j.texts });
  // the drafter's forced-tool call: capture in execute, HaltError so no wrap-up round; the tool is the channel's own (schema unchanged)
  let captured; const box = { calls: [] };
  const base = channel.tool(box);
  const tool = { ...base, execute: async (a) => { captured = a; throw new HaltError('edits captured', { rule: 'captured' }); } };
  const events = [];
  const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); meterings.push(ev); } });
  calls += 1;
  const t0 = Date.now(); let threw = null; let res;
  try {
    res = await loop.run([{ role: 'system', content: ROW_EDIT_SYSTEM }, { role: 'user', content: userText }], [tool], { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: 'off', toolChoice: { name: base.name } });
  } catch (err) { threw = err; if (events.length === 0) unmetered += 1; }
  const ms = Date.now() - t0;
  const readable = captured && typeof captured === 'object' && Array.isArray(captured.edits) && !(threw && !(threw instanceof HaltError));
  const r = { job: j.id, i, ms, readable: Boolean(readable), why: readable ? '' : (threw ? `threw: ${String(threw.message).slice(0, 80)}` : `no tool call (${JSON.stringify(res?.stopReason ?? res?.finishReason ?? null)})`), tokens: events.map((e) => e.usage ?? e.tokens ?? null) };
  if (readable) {
    const rec = block.applyDelta({ label: `f187-${j.id}-${i}`, edits: editsOf(captured) });
    let close = block.reconcile();
    if (ASKS) { block.drive({ answer: (q) => (q.offers.agree ? { choice: 'agree' } : null) }); close = block.reconcile(); }
    r.ops = rec.edits.map((e) => e.op);
    r.refused = rec.edits.filter((e) => e.accepted !== true).map((e) => ({ op: e.op, why: String(e.refusedBecause).slice(0, 110) }));
    const partOf = (row) => { const m = close.map.find((x) => x.rows.includes(row.key)); return m ? close.parts[m.part] : null; };
    const built = block.rows.filter((x) => x.state === 'built');
    r.pickEdits = rec.edits.filter((e) => e.op === 'pick').map((e) => ({ line: e.line, rules: e.rules, check: e.check, accepted: e.accepted }));
    r.ruleRows = block.rows.filter((x) => x.kind === 'rule').map((x) => `L${x.line} ${x.by} ${x.state} ${x.text}${x.reason ? ' | ' + String(x.reason).slice(0, 70) : ''}`);
    r.rows = built.filter((x) => x.kind !== 'floor').map((x) => ({ line: x.line, by: x.by, kind: x.kind, text: x.text ?? x.name ?? '', part: JSON.stringify(partOf(x) ?? null).slice(0, 160) }));
    if (j.id === 'm14-walk-5') {
      const picks = block.picksOf(close);
      r.picks = picks.map((x) => `L${x.line} ${JSON.stringify(x.part).slice(0, 140)}`);
      const pj = (n) => picks.filter((x) => x.line === n).map((x) => JSON.stringify(x.part));
      r.b1 = pj(3).some((t) => /listItems/.test(t) && /\b3\b/.test(t));
      r.b2 = pj(5).some((t) => /maxWords/.test(t) && /\b80\b/.test(t));
      r.outside = block.rows.filter((x) => x.state === 'built' && x.kind !== 'floor' && x.kind !== 'rule' && x.by !== 'default').map((x) => `L${x.line} ${x.by} ${x.kind} ${x.text ?? x.name}`);
    } else {
      const page = j.texts.flights.toLowerCase();
      const agentBuilt = block.rows.filter((x) => x.by === 'agent' && x.state === 'built' && (x.words ?? []).length > 0 && x.words.every((w) => page.includes(String(w).toLowerCase())));
      r.c1 = agentBuilt.length;
      const rules = block.rows.filter((x) => x.kind === 'rule' && !x.parent);
      r.c2 = rules.length > 0 && rules.every((x) => x.by === 'you');
      r.nRules = rules.length;
    }
  }
  results.push(r);
  console.log(JSON.stringify(r));
}
const m = sumMeterings(meterings);
const readableN = results.filter((r) => r.readable).length;
const m14 = results.filter((r) => r.job === 'm14-walk-5' && r.readable);
const fl = results.filter((r) => r.job === 'flights' && r.readable);
const bA = (ASKS || results.length === 10) && readableN >= 9;
const bB = m14.length > 0 && m14.every((r) => r.b1 && r.b2 && r.outside.length === 0);
const bC = fl.length > 0 && fl.every((r) => r.c1 >= 1 && r.c2);
const bD = m.costUsd !== null && m.costUsd <= CAP && unmetered === 0;
console.log(`\ncalls ${calls}; unmetered ${unmetered}; rounds ${m.rounds}; cost ${m.costUsd}; tokens ${JSON.stringify(m.tokens)}; model ${m.model}`);
console.log(`BAR a readable ${readableN}/${results.length}: ${bA ? 'PASS' : 'FAIL'}`);
console.log(`BAR b m14 (${m14.length} readable; b1 ${m14.filter((r) => r.b1).length}, b2 ${m14.filter((r) => r.b2).length}, outside-rows ${m14.filter((r) => r.outside.length).length}): ${bB ? 'PASS' : 'FAIL'}`);
console.log(`BAR c flights (${fl.length} readable; with agent fact ${fl.filter((r) => r.c1 >= 1).length}, rules all [you] ${fl.filter((r) => r.c2).length}): ${bC ? 'PASS' : 'FAIL'}`);
console.log(`BAR d spend ${m.costUsd} <= ${CAP}, unmetered ${unmetered}: ${bD ? 'PASS' : 'FAIL'}`);
