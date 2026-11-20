// F233 / M19 P2: the shape look on fwd's real candidates (PAID, deepseek-flash, cap $0.25). Pre-registration: docs/logs/FINDINGS.md "F233".
// usage: node poc/m19-p2/run.mjs [--dry] [--out <dir>] [--cap 0.25]
//   --dry   fake provider, $0, no key: proves the harness reaches the call and scores (output defaults to .claude/scratch/v061/p2-dry)
//   --preflight  builds the live provider with a dummy key (no call, nothing written) to prove the model and its prices resolve
//   live    key ONLY from env DEEPSEEK_API_KEY (the orchestrator exports it); empty is refused at $0 BEFORE any file is written. The key is never printed or written.
// Real call path copied from src/drafter.js `makeCallModel` (kind shape-map): the hold against the cap, `new Loop({ provider, rates, onLlmResult })`, run([system,user], [], { maxTokens: DRAFT_MAX_TOKENS,
// thinkingMode: attempt 1 'off' (the drafter's default draftThinking), a retry 'on' }), every round metered, a cut-off or thrown round booked. It runs the REAL lookAtShape, buildShapes and the block's setShape.
// Read-only over ~/.config/fwdloop: each draft folder is COPIED to scratch first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Loop } from 'bare-agent';
import { makeProvider, ModelRefusal, sumMeterings, ceilingCostUsd } from '../../src/provider.js';
import { LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';
import { DRAFT_MAX_TOKENS } from '../../src/drafter.js';
import { rebuildBlock } from '../../src/planrebuild.js';
import { blockJobLines } from '../../src/blocklines.js';
import { listLinesOf } from '../../src/checklistsign.js';
import { lookAtShape, SHAPE_SYSTEM, SHAPE_CALL_LABEL } from '../../src/shapelook.js';
import { buildShapes, hasRealBound } from '../../src/shapebuild.js';
import { lineRules } from '../../src/pagebits.js';
import { NEGATING_RE } from '../../src/rubricstep.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const has = (k) => process.argv.includes(`--${k}`);
const dry = has('dry');
const cap = Number(arg('cap', 0.25));
const OUT = path.resolve(REPO, arg('out', dry ? '.claude/scratch/v061/p2-dry' : '.claude/scratch/v061/p2'));
const stop = (m) => { console.error(`STOP: ${m}`); process.exit(1); };
if (!Number.isFinite(cap) || cap <= 0) stop('bad --cap');

// P0's B list (F223b RESULT), one entry per draft folder; `rules` = the rule text(s) the B list names for it
const B_LIST = [
  ['d-00muw963t5-9a4c/draft', '3 sections, all under 600 words'],
  ['d-00muwfs2if-af64/draft', '3 sections, all under 600 words'],
  ['d-00muwz83wl-6ac7/draft', '3 sections, all under 600 words'],
  ['d-00mv548zrh-d6c7/draft', '3 sections, all under 600 words'],
  ['d-00mv1g41wz-2c73/draft', '3 sections, about 180 words each, under 600 words'],
  ['d-00mv548zrh-d6c7/draft-1', '3 sections, all under 600 words'],
  ['d-00mv54iebr-5ec3/draft', '3 sections: Work History, Professional Skills, Soft Skills, all under 600 words'],
  ['d-00mv2588dx-22eb/draft', 'under 100 words'],
  ['d-00mvia7zwl-691f/draft', 'Price over 500'],
  ['d-00mvzr2yug-851a/draft', 'exactly 3 bullets'],
  ['d-00mw0d9wgi-a755/draft', 'under 80 words'],
  ['d-00mw1yp3qj-ad93/draft-3', 'at most 60 words'],
  ['d-00mwgdao99-8d69/draft', 'under $150'],
];

// ---- the prompt is the tag's, byte for byte (asserted before any call, at $0)
{
  const fx = JSON.parse(fs.readFileSync(path.join(REPO, 'test/fixtures/m19-shapelook-tag.json'), 'utf8'));
  const mine = fs.readFileSync(path.join(REPO, 'src/shapelook.js'), 'utf8');
  if (!mine.includes(fx.core)) stop('src/shapelook.js does not hold the tag text of test/fixtures/m19-shapelook-tag.json unchanged: no call made');
  const want = 'You map a person\'s job to the SHAPE of an answer: a list of items, each item with named fields. You never grade and never invent bounds: a bound is only what the person wrote. Reply with JSON only.';
  if (SHAPE_SYSTEM !== want) stop('SHAPE_SYSTEM differs from the tag: no call made');
}

// ---- the provider (before any file is written)
let provider; let rates; let modelId;
if (dry) {
  rates = { in: 0.0003, out: 0.0012 }; modelId = 'fake-deepseek-flash';
  // reads the prompt only to name the rules it is told have no check yet, and gives each a field bounded by the first number of the rule (a stand-in for a model; scores the harness, says nothing about a model)
  provider = {
    async generate(msgs) {
      const u = msgs[msgs.length - 1].content;
      const need = /Only these ~ rules have no check yet: ([^\n]*?)\. Give a field/.exec(u)?.[1] ?? '';
      const shapes = [];
      for (const part of need.split('; ').filter(Boolean)) {
        const m = /^line (\d+) rules? ([\d, ]+)$/.exec(part);
        if (!m) continue;
        const line = Number(m[1]);
        const block = u.split(`LINE ${line}:`)[1]?.split(/\n(?=LINE \d+:)|\n\nTHE INPUTS/)[0] ?? '';
        const fields = [];
        for (const r of m[2].split(',').map((x) => Number(x.trim()))) {
          const text = new RegExp(`~ rule ${r}: (.*)`).exec(block)?.[1] ?? '';
          const n = Number(/\d+/.exec(text)?.[0]);
          fields.push({ name: `f${line}_${r}`, kind: 'text', required: true, bounds: Number.isFinite(n) ? { maxWords: n - 1 } : {}, fromRule: r });
        }
        shapes.push({ line, fields, extraFields: [], itemCountFrom: [] });
      }
      return { text: JSON.stringify({ shapes }), toolCalls: [], usage: { inputTokens: 1500, outputTokens: 200 }, stopReason: 'stop', model: 'fake' };
    },
  };
} else {
  if (!has('preflight') && !(process.env.DEEPSEEK_API_KEY ?? '').trim()) stop('DEEPSEEK_API_KEY is empty: refused at $0, nothing sent, nothing written');
  try { ({ provider, rates, modelId } = makeProvider('DEEPSEEK_API_KEY', { model: 'deepseek-flash', env: has('preflight') ? { DEEPSEEK_API_KEY: 'dummy-preflight' } : process.env, ...LIVE_PROVIDER_OPTIONS })); } catch (e) { stop(`provider: ${e instanceof ModelRefusal ? e.message : e.message}`); }
}
if (!rates || !(rates.in > 0) || !(rates.out > 0)) stop('no price for the model: refused, never priced as 0');

if (has('preflight')) { console.log(`preflight ok: model ${modelId}, rates per 1K in ${rates.in} out ${rates.out}, maxTokens ${DRAFT_MAX_TOKENS}, ${JSON.stringify(LIVE_PROVIDER_OPTIONS)}; no call made, nothing written`); process.exit(0); }

// ---- outputs: a result that already exists is refused, never overwritten
const answersFile = path.join(OUT, 'answers.json');
if (fs.existsSync(answersFile)) stop(`${answersFile} already exists: use --out <new dir>`);
fs.mkdirSync(OUT, { recursive: true });
const WORK = path.join(OUT, 'work');
fs.rmSync(WORK, { recursive: true, force: true });
const verdictLines = [];
const say = (s) => { verdictLines.push(s); console.log(s); };

const FLOWS = path.join(os.homedir(), '.config', 'fwdloop', 'flows', '.drafts');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const rowSig = (r) => JSON.stringify({ key: r.key, line: r.line, rule: r.rule, state: r.state, reason: r.reason ?? null, by: r.by, can: r.can ?? null, pick: r.pick ?? null });

// ---- the one metered ledger (the drafter's `meterings`); one call round = the drafter's makeCallModel body
const meterings = []; let calls = 0; let unmetered = 0; let mapCut = null;
const roundCeiling = ceilingCostUsd(rates);
const spentNow = () => meterings.reduce((s, ev) => s + (ev.costUsd ?? roundCeiling), 0);
const rounds = []; // per-round raw record for the answers file
let currentJob = null;
const callModel = async (content, attempt) => {
  if (spentNow() + ceilingCostUsd(rates, content.length + SHAPE_SYSTEM.length) > cap) { mapCut = 'budget'; return { error: 'the draft budget is spent', budget: true }; }
  const roundEvents = [];
  const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { roundEvents.push(ev); meterings.push(ev); } });
  calls += 1;
  let res; let threw = null;
  try {
    res = await loop.run([{ role: 'system', content: SHAPE_SYSTEM }, { role: 'user', content }], [], { maxTokens: DRAFT_MAX_TOKENS, thinkingMode: attempt === 1 ? 'off' : 'on' });
  } catch (err) { threw = err; if (roundEvents.length === 0) unmetered += 1; }
  const entry = { job: currentJob, kind: SHAPE_CALL_LABEL, attempt, thinkingAsked: attempt === 1 ? 'off' : 'on', costUsd: roundEvents.length ? (roundEvents.every((e) => e.costUsd != null) ? roundEvents.reduce((s, e) => s + e.costUsd, 0) : null) : null, tokens: roundEvents.map((e) => e.usage ?? null) };
  if (res?.thinkingApplied !== undefined) entry.thinkingApplied = res.thinkingApplied;
  if (res?.thinkingStatus !== undefined) entry.thinkingStatus = res.thinkingStatus;
  if (threw) { entry.outcome = `provider-red: ${threw.message}`; rounds.push(entry); mapCut = 'provider-red'; return { error: threw.message, threw }; }
  const cutOff = res?.stopReason === 'max_tokens';
  entry.outcome = cutOff ? 'truncated' : 'answered';
  if (typeof res?.text === 'string' && res.text !== '') entry.rawText = res.text;
  rounds.push(entry);
  if (res?.error && !cutOff) return { error: String(res.error) };
  return { text: res?.text ?? '', cutOff };
};

// ---- per draft folder
const results = [];
const GUARD = { a_realBound: 0, b_inventedSurvived: 0, c_negatingShaped: 0, d_truthTakenTouched: 0 };
let nCalled = 0;
for (const [name, bRule] of B_LIST) {
  const src = path.join(FLOWS, name);
  const row = { draft: name, bRule, status: null };
  results.push(row);
  const prose = fs.existsSync(path.join(src, 'prose.txt')) ? fs.readFileSync(path.join(src, 'prose.txt'), 'utf8') : null;
  let decl = readJson(path.join(src, 'declaration.json'));
  if (prose === null || !decl) { row.status = 'draft folder not readable (no prose or declaration)'; say(`${name}: ${row.status}`); continue; }
  const dest = path.join(WORK, name.replace('/', '__'));
  fs.cpSync(src, dest, { recursive: true });
  // the same shim as F223b for a draft with no checkList (pre-M16): a list on every non-Ask/send/sheet line, so today's rebuild runs unchanged
  if (!Array.isArray(decl.checkList)) {
    const bj = blockJobLines(prose, decl);
    if (!bj.ok || bj.jobLines.length === 0) { row.status = 'prose does not parse today or has no block line'; say(`${name}: ${row.status}`); continue; }
    decl = { ...decl, checkList: bj.jobLines.map((l) => ({ line: l.n, kind: 'floor', state: 'built' })) };
    fs.writeFileSync(path.join(dest, 'declaration.json'), JSON.stringify(decl));
  }
  let rb;
  try { rb = rebuildBlock({ planDir: dest, asks: true }); } catch (e) { rb = { ok: false, say: `builder threw: ${String(e?.message).slice(0, 80)}` }; }
  if (!rb.ok) { row.status = `not rebuilt: ${rb.say.slice(0, 100)}`; say(`${name}: ${row.status}`); continue; }
  const block = rb.block;
  const cands = block.shapeCandidates();
  const candRules = cands.map((c) => ({ ...c, text: block.rows.find((r) => r.kind === 'rule' && r.line === c.line && r.rule === c.rule)?.text }));
  row.candidates = candRules;
  if (cands.length === 0) { row.status = 'no candidate today (shapeCandidates empty)'; say(`${name}: ${row.status}`); continue; }
  // the jobLines as the drafter's blockPlan.jobLines (every non-Ask/send/sheet line)
  const all = blockJobLines(rb.proseText, undefined, []);
  const tied = all.jobLines.filter((l) => !listLinesOf(rb.declaration).has(l.n)).map((l) => l.n);
  const plan = blockJobLines(rb.proseText, undefined, tied);
  const lineNums = [...new Set(cands.map((x) => x.line))].sort((a, b) => a - b);
  const left = lineNums.map((n) => ({ line: n, rules: cands.filter((x) => x.line === n).map((x) => x.rule) }));
  // d) before: every rule row that is NOT a candidate (a truth check or an answer took it, or it is negating/ask/sheet)
  const candKey = new Set(cands.map((c) => `${c.line}:${c.rule}`));
  const beforeOther = new Map(block.rows.filter((r) => r.kind === 'rule' && !candKey.has(`${r.line}:${r.rule}`)).map((r) => [r.key, rowSig(r)]));
  currentJob = name;
  const roundsBefore = rounds.length;
  const got = await lookAtShape({ texts: block.texts, jobLines: plan.jobLines, lineNums, left, ceilingUsd: cap, callModel });
  nCalled += 1;
  row.attempts = got.attempts;
  row.rawTexts = rounds.slice(roundsBefore).map((r) => r.rawText ?? null);
  if (!got.ok) { row.status = `look not usable: ${got.reason}`; row.ok = false; say(`${name}: ${row.status}`); if (mapCut === 'budget') break; continue; }
  row.ok = true;
  row.suggestions = got.shapes;
  const built = buildShapes({ lines: plan.jobLines.filter((l) => lineRules(l).length > 0 && !block.isSheetLine(l.n)), labels: block.labels, suggestions: got.shapes });
  block.setShape(built);
  block.reconcile();
  // scoring
  const score = { realBoundFields: [], inventedSurvived: [], negatingShaped: [], truthTakenTouched: [], offeredNonCandidate: [] };
  // (d, offered) the prompt names only the candidates
  const rulesOfLineN = (n) => lineRules(plan.jobLines.find((l) => l.n === n) ?? {});
  for (const l of left) for (const r of l.rules) if (!candKey.has(`${l.line}:${r}`)) score.offeredNonCandidate.push(`${l.line}:${r}`);
  for (const [k, b] of Object.entries(built.built)) {
    for (const f of b.fields) {
      if (f.by !== 'you' || f.rule === null) continue;
      const text = rulesOfLineN(Number(k))[f.rule - 1] ?? '';
      const isCand = candKey.has(`${k}:${f.rule}`);
      if (hasRealBound(f.bounds) && isCand) score.realBoundFields.push({ line: Number(k), rule: f.rule, text, name: f.name, kind: f.kind, bounds: f.bounds });
      if (!isCand) score.truthTakenTouched.push(`${k}:${f.rule} "${text}" got a built field though it is not a candidate`);
      // (b) an independent plain match: every number (or the number plus one) and every value of a surviving bound is written in the rule
      const said = new Set((String(text).match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(',', '.'))));
      const low = String(text).toLowerCase();
      const walk = (bounds) => {
        for (const [bk, bv] of Object.entries(bounds)) {
          if (bk === 'of' && bv && typeof bv === 'object') { walk(bv); continue; }
          if (!['min', 'max', 'gt', 'lt', 'minChars', 'maxChars', 'minWords', 'maxWords', 'minEntries', 'maxEntries', 'values'].includes(bk)) continue;
          if (bk === 'minChars' && bv === 1 && f.required) continue;
          const ok = bk === 'values' ? bv.every((x) => low.includes(String(x).toLowerCase())) : (typeof bv === 'number' && (said.has(bv) || said.has(bv + 1)));
          if (!ok) score.inventedSurvived.push({ line: Number(k), rule: f.rule, bound: bk, value: bv, rule_text: text });
        }
      };
      walk(f.bounds);
    }
  }
  // (c) a negating rule that code let take a shape field
  for (const r of block.rows.filter((x) => x.kind === 'rule' && NEGATING_RE.test(String(x.text)))) if (block.takesShape(r) !== null) score.negatingShaped.push(`${r.line}:${r.rule} "${r.text}"`);
  // (d, changed) a non-candidate rule row after setShape differs from before
  for (const r of block.rows.filter((x) => x.kind === 'rule' && !candKey.has(`${x.line}:${x.rule}`))) if (beforeOther.get(r.key) !== rowSig(r)) score.truthTakenTouched.push(`${r.key} changed by the shape`);
  row.score = score;
  row.builtRefused = built.refused;
  row.notChecked = built.notChecked;
  row.status = 'looked';
  GUARD.a_realBound += score.realBoundFields.length;
  GUARD.b_inventedSurvived += score.inventedSurvived.length;
  GUARD.c_negatingShaped += score.negatingShaped.length;
  GUARD.d_truthTakenTouched += score.truthTakenTouched.length + score.offeredNonCandidate.length;
  say(`${name}: candidates ${cands.map((c) => `${c.line}:${c.rule}`).join(',')}; attempts ${got.attempts}; real-bound fields ${score.realBoundFields.length}${score.realBoundFields.map((f) => ` [${f.name} ${JSON.stringify(f.bounds)}]`).join('')}; invented ${score.inventedSurvived.length}; negating shaped ${score.negatingShaped.length}; truth-taken offered/changed ${score.truthTakenTouched.length + score.offeredNonCandidate.length}`);
  if (mapCut === 'budget') break;
}

const m = sumMeterings(meterings);
const priced = unmetered === 0 && m.costUsd !== null;
const spent = spentNow();
const pass = GUARD.a_realBound >= 1 && GUARD.b_inventedSurvived === 0 && GUARD.c_negatingShaped === 0 && GUARD.d_truthTakenTouched === 0;
say(`${dry ? 'DRY (fake provider; scores the harness, not a model) ' : ''}model ${modelId}; drafts looked at ${nCalled} of ${B_LIST.length}; calls ${calls}; spend $${spent.toFixed(4)}${priced ? '' : ' (at least: a round was unmetered)'} of cap $${cap}${mapCut ? `; STOPPED: ${mapCut}` : ''}`);
say(`bar (a) at least one candidate rule gets a built field with a real bound: ${GUARD.a_realBound >= 1 ? 'PASS' : 'FAIL'} (${GUARD.a_realBound})`);
say(`bar (b) 0 invented bounds survive code: ${GUARD.b_inventedSurvived === 0 ? 'PASS' : 'FAIL'} (${GUARD.b_inventedSurvived})`);
say(`bar (c) 0 negating rules shaped: ${GUARD.c_negatingShaped === 0 ? 'PASS' : 'FAIL'} (${GUARD.c_negatingShaped})`);
say(`bar (d) 0 rules a truth check already took are offered or changed: ${GUARD.d_truthTakenTouched === 0 ? 'PASS' : 'FAIL'} (${GUARD.d_truthTakenTouched})`);
say(`P2 VERDICT on the letter: ${pass ? 'PASS' : 'FAIL'} (n = ${nCalled}: UNDERPOWERED, a PASS shows it can work, not its rate)`);
fs.writeFileSync(answersFile, `${JSON.stringify({ tag: 'F233', dry, model: modelId, cap, spendUsd: spent, spendComplete: priced, promptSha256: createHash('sha256').update(SHAPE_SYSTEM).digest('hex').slice(0, 16), jobs: results, rounds, guard: GUARD, pass }, null, 1)}\n`);
fs.writeFileSync(path.join(OUT, 'verdict.txt'), `${verdictLines.join('\n')}\n`);
fs.rmSync(WORK, { recursive: true, force: true });
