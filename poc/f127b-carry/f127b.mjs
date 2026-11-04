// F127b (PAID, pre-registered in docs/logs/FINDINGS.md before any run): carry memo vs today's shape, human answers about LATER work only. Throwaway POC; never imported by src.
// Usage: BASETEN_API_KEY in the environment (never printed). node poc/f127b-carry/f127b.mjs <outDir>   (F127B_FAKE=1 = $0 scripted dry run of this script)
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLiveModelStep } from '../../src/model-step.js';
import { check, factsIn } from './checker.mjs';

const FAKE = process.env.F127B_FAKE === '1';
const here = dirname(fileURLToPath(import.meta.url));
if (!FAKE && (!process.env.BASETEN_API_KEY || process.env.BASETEN_API_KEY.trim() === '')) { console.error('F127b: BASETEN_API_KEY empty. Refused at $0.'); process.exit(2); }
const outDir = resolve(process.argv[2] ?? join(here, 'out'));
mkdirSync(outDir, { recursive: true });
const ledger = join(outDir, 'spend.jsonl');
const resultsFile = join(outDir, 'results.json');
if (existsSync(resultsFile)) { console.error('F127b: results.json exists; use a new out dir.'); process.exit(2); }
const MODEL = 'meta-models/muse-spark-open-1026';
const TRIES = 3; const N = 12; const CAP = 6.0; const MAX_REGEN = 2;
const ANS1 = "For the closing note: address it to Mrs Okafor and sign it 'Kind regards, Tom'.";
const ANS2 = 'The closing note must say the deadline is 14 March.';
const GOALS = {
  A: 'Write a 3-line project summary (three short lines of plain prose) from the project facts.',
  B: 'List the 3 main risks to the project, one line each, from the project facts.',
  C: 'Write the closing note of the project update as exactly 3 bullet points (each line starting with "- "), each bullet under 15 words. Do not use the word "very".',
};
const FACTS = { text: 'Project: Harbour Lane library renovation. Budget 480,000 pounds, 62 percent spent. Builder: Calder & Sons. Phase 1 (roof and windows) finished in September. Phase 2 (reading rooms, new shelving) runs to the end of the project. The children\'s wing stays open throughout. Risks on file: steel delivery for the new staircase is two weeks late; the heating contractor has not confirmed a start date; one listed ceiling may need extra restoration work. Weekly site meeting every Thursday at 9.' };
const BAD_PREFIX = [/Okafor/, /\bTom\b/, /14 March/];

const ledgerTotal = () => (existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd ?? 0), 0) : 0);
let unpriced = false; let provErrs = 0;
class Halt extends Error {}

// fake step for the $0 dry run: scripted, deterministic, tool-call-shaped results
const fakeStep = async ({ goal, reads, gap }) => {
  const memo = reads.carryMemo ?? '';
  const hasHuman = memo.includes('Okafor');
  if (/closing note/.test(goal)) {
    const text = hasHuman ? '- Dear Mrs Okafor, we are on track.\n- Deadline is 14 March.\n- Kind regards, Tom' : `- all fine here${gap ? ' ok' : ''}\n- second\n- third`;
    return { ok: true, artifact: { text, done: true }, costUsd: 0 };
  }
  return { ok: true, artifact: { text: 'fake text for the prefix step', done: true }, costUsd: 0 };
};

const run = async (tag, goal, reads, gap, attempt) => {
  if (ledgerTotal() >= CAP) throw new Halt(`budget $${CAP} reached`);
  const dir = mkdtempSync(join(tmpdir(), 'f127b-'));
  try {
    const step = FAKE ? fakeStep : makeLiveModelStep({ slot: 'BASETEN_API_KEY', model: MODEL, spendPath: join(dir, 'spend.jsonl') });
    const r = await step({ goal, primitives: [], reads, gap, hints: null }, {}, { class: 'softgreen', attempt, step: tag });
    if (typeof r.costUsd !== 'number') unpriced = true;
    appendFileSync(ledger, `${JSON.stringify({ tag, usd: r.costUsd ?? 0, unpriced: typeof r.costUsd !== 'number' })}\n`);
    appendFileSync(join(outDir, 'calls.jsonl'), `${JSON.stringify({ tag, ok: r.ok, red: r.red ?? null, usd: r.costUsd, text: r.artifact?.text ?? null, done: r.artifact?.done ?? null })}\n`);
    if (!r.ok && (r.transport || /^(provider-red|wall-halt|key|config)/.test(r.red ?? ''))) { provErrs += 1; if (provErrs >= 3) throw new Halt('3 provider errors in a row'); } else provErrs = 0;
    return r;
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
const runP = async (tag, goal, reads, attempt) => { let usd = 0; for (let t = 1; t <= 3; t += 1) { const r = await run(`${tag}.${t}`, goal, reads, null, attempt); usd += r.costUsd ?? 0; if (r.ok) return { r, usd }; } return { r: null, usd }; };
const textOf = (r) => (r && r.ok && typeof r.artifact?.text === 'string' ? r.artifact.text : null);

const HUMAN = `Human answers given in this run (verbatim):\n- ask 1 (after step A): ${ANS1}\n- ask 2 (after step B): ${ANS2}\n`;
const memo = (tries) => {
  const line = (x, i, cutText) => `try ${i + 1}: answer:\n${cutText ? '(answer text cut to fit)' : x.text}\n  check: ${x.green ? 'green' : 'red'}; gap: ${x.red || '(none)'}`;
  const render = (cuts) => `${HUMAN}Earlier tries of this step:\n${tries.length ? tries.map((x, i) => line(x, i, cuts > i)).join('\n') : '(none yet)'}`;
  let cuts = 0; let s = render(0);
  while (s.length > 4000 && cuts < tries.length) { cuts += 1; s = render(cuts); }
  return { s, cut: cuts > 0 };
};

const results = []; const invalid = [];
const save = (extra = {}) => writeFileSync(resultsFile, JSON.stringify({ model: MODEL, N, cap: CAP, results, invalid, spent: ledgerTotal(), unpriced, ...extra }, null, 1));
let halted = null; let regen = 0; let idx = 0;
try {
  while (results.length < N) {
    const i = idx++;
    const a = await runP(`r${i}-A`, GOALS.A, { facts: FACTS }, 1); const at = textOf(a.r);
    const b = await runP(`r${i}-B`, GOALS.B, { facts: FACTS }, 1); const bt = textOf(b.r);
    const prefixUsd = a.usd + b.usd;
    const rec = { run: i, prefix: { a: at, b: bt }, prefixUsd, A: null, B: null };
    if (!at || !bt) { rec.prefixFailed = true; invalid.push({ ...rec, why: 'prefix step gave no answer' }); if ((regen += 1) > MAX_REGEN) throw new Halt('prefix invalid beyond regeneration allowance'); save(); continue; }
    const leak = BAD_PREFIX.filter((re) => re.test(at) || re.test(bt)).map(String);
    if (leak.length) { invalid.push({ ...rec, why: `prefix contains ${leak.join(',')}` }); if ((regen += 1) > MAX_REGEN) throw new Halt('prefix invalid beyond regeneration allowance'); save(); continue; }
    const reads = { facts: FACTS, projectSummary: { text: at }, risks: { text: bt } };
    const order = results.length % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
    for (const arm of order) {
      const tries = []; let gap = null; let memoCut = false;
      for (let k = 1; k <= TRIES; k += 1) {
        let rd = reads;
        if (arm === 'B') { const m = memo(tries); memoCut = memoCut || m.cut; rd = { ...reads, carryMemo: m.s }; }
        const r = await run(`r${i}-C${arm}${k}`, GOALS.C, rd, gap, k);
        const text = textOf(r);
        if (text === null) { tries.push({ text: null, green: false, red: r.red ?? 'no answer', usd: r.costUsd ?? 0, ok: false, textInstead: /returned text instead of the tool/.test(r.red ?? ''), facts: factsIn('') }); gap = r.red ?? 'no answer'; continue; }
        const c = check(text);
        tries.push({ text, green: c.green, red: c.red, usd: r.costUsd ?? 0, ok: true, textInstead: false, facts: factsIn(text) });
        gap = c.red;
        if (c.green) break;
      }
      const first = {}; for (const f of ['okafor', 'tom', 'deadline']) { const j = tries.findIndex((t) => t.facts[f]); first[f] = j < 0 ? null : j + 1; }
      rec[arm] = { tries, green: tries[tries.length - 1].green, nTries: tries.length, usd: tries.reduce((s, t) => s + t.usd, 0), firstFactTry: first, memoCut };
    }
    results.push(rec); save();
    console.log(`valid run ${results.length} (idx ${i}): A ${rec.A.green ? 'green' : 'red'}/${rec.A.nTries}  B ${rec.B.green ? 'green' : 'red'}/${rec.B.nTries}  spent $${ledgerTotal().toFixed(4)}`);
  }
} catch (e) { if (e instanceof Halt) { halted = e.message; console.error('HALT:', halted); } else { halted = `error: ${e.message}`; console.error(e); } }
save({ halted });
console.log('DONE', halted ?? 'complete', `spent $${ledgerTotal().toFixed(4)}`);
