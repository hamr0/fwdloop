// F127 (PAID, pre-registered in docs/logs/FINDINGS.md before any run): carry memo vs today's shape. Throwaway POC; never imported by src.
// Usage: BASETEN_API_KEY in the environment (never printed). node poc/f127-carry/f127.mjs <outDir> <spendLedger>
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLiveModelStep } from '../../src/model-step.js';
import { check, honoursAsk1 } from './checker.mjs';

const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.BASETEN_API_KEY || process.env.BASETEN_API_KEY.trim() === '') { console.error('F127: BASETEN_API_KEY empty. Refused at $0.'); process.exit(2); }
const outDir = resolve(process.argv[2] ?? join(here, 'out'));
const ledger = resolve(process.argv[3] ?? join(outDir, 'spend.jsonl'));
mkdirSync(outDir, { recursive: true });
const resultsFile = join(outDir, 'results.json');
if (existsSync(resultsFile)) { console.error('F127: results.json exists; use a new out dir.'); process.exit(2); }
const MODEL = 'meta-models/muse-spark-open-1026';
const TRIES = 3; const N = 8; const CAP = 1.25; // shared ledger incl. $0.27 of setup-defect calls before the valid start (F127's own spend stays <= $1.00) const TRIES = 3;
const ANS1 = "use British spelling and never use the word 'very'";
const ANS2 = 'keep each section under 120 words';
const GOALS = {
  A: 'Write the opening section of a short note announcing a local bakery\'s new loyalty card: what it is and why customers will like it. About 100 words of plain prose.',
  B: 'Write the second section of the note: how customers earn and spend points with the card. About 100 words of plain prose.',
  C: 'Write the closing section of the note as exactly 4 bullet points (each line starting with "- "), each bullet under 15 words, summing up the offer. Cover: the card color options, how groups can organize orders, picking your favorite loaf, and the new community center collection point.',
};
const BRIEF = { text: 'Sweet Crumb Bakery, a local bakery. New loyalty card: free at the counter from Monday 3 November. One stamp per purchase of 3 dollars or more; 10 stamps earn one free loaf or pastry. Card comes in blue or green. Offices and clubs can place group orders 2 days ahead and earn double stamps. Stamps never expire. The new collection point is in the community hall on Mill Street, Saturdays 8 to 10.' };
const ledgerTotal = () => (existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd ?? 0), 0) : 0);
let unpriced = false; let provErrs = 0;
class Halt extends Error {}
const run = async (tag, goal, reads, gap, attempt) => {
  if (ledgerTotal() >= CAP) throw new Halt(`budget $${CAP} reached`);
  const dir = mkdtempSync(join(tmpdir(), 'f127-'));
  try {
    const step = makeLiveModelStep({ slot: 'BASETEN_API_KEY', model: MODEL, spendPath: join(dir, 'spend.jsonl') });
    const r = await step({ goal, primitives: [], reads, gap, hints: null }, {}, { class: 'softgreen', attempt, step: tag });
    if (typeof r.costUsd !== 'number') unpriced = true;
    appendFileSync(ledger, `${JSON.stringify({ tag, usd: r.costUsd ?? 0, unpriced: typeof r.costUsd !== 'number' })}\n`);
    appendFileSync(join(outDir, 'calls.jsonl'), `${JSON.stringify({ tag, ok: r.ok, red: r.red ?? null, usd: r.costUsd, text: r.artifact?.text?.slice(0, 200) ?? null, done: r.artifact?.done ?? null })}\n`);
    if (!r.ok && (r.transport || /^(provider-red|wall-halt|key|config)/.test(r.red ?? ''))) { provErrs += 1; if (provErrs >= 3) throw new Halt('3 provider errors in a row'); } else provErrs = 0;
    return r;
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
const runP = async (tag, goal, reads, gap, attempt) => { for (let t = 1; t <= 3; t += 1) { const r = await run(`${tag}.${t}`, goal, reads, gap, attempt); if (r.ok) return r; } return null; };
const textOf = (r) => (r && r.ok && typeof r.artifact?.text === 'string' ? r.artifact.text : null);

const memo = (tries) => {
  let t = tries.map((x, i) => `try ${i + 1}: answer:\n${x.text}\n  check: ${x.green ? 'green' : 'red'}; gap: ${x.red || '(none)'}`);
  const head = `Human answers so far (verbatim):\n1. ${ANS1}\n2. ${ANS2}\nEarlier tries of this step:\n`;
  let s = head + t.join('\n');
  let cut = false;
  for (let i = 0; s.length > 4000 && i < tries.length; i += 1) { t[i] = `try ${i + 1}: answer: (cut to fit)\n  check: ${tries[i].green ? 'green' : 'red'}; gap: ${tries[i].red || '(none)'}`; s = head + t.join('\n'); cut = true; }
  return { s, cut };
};

const results = [];
const save = (extra = {}) => writeFileSync(resultsFile, JSON.stringify({ model: MODEL, N, cap: CAP, results, spent: ledgerTotal(), unpriced, ...extra }, null, 1));
let halted = null;
try {
  for (let i = 0; i < N; i += 1) {
    const rec = { run: i + 1, prefix: {}, A: null, B: null };
    const a1 = await runP(`r${i}-A1`, GOALS.A, { brief: BRIEF }, null, 1); const a1t = textOf(a1);
    const a2 = await runP(`r${i}-A2`, GOALS.A, { brief: BRIEF }, ANS1, 1); const a2t = textOf(a2);
    const b1 = await runP(`r${i}-B1`, GOALS.B, { brief: BRIEF, intro: { text: a2t } }, null, 1);
    const b2 = await runP(`r${i}-B2`, GOALS.B, { brief: BRIEF, intro: { text: a2t } }, ANS2, 1); const b2t = textOf(b2);
    rec.prefix = { a1: a1t, a2: a2t, b1: textOf(b1), b2: b2t };
    if (!a2t || !b2t) { rec.prefixFailed = true; results.push(rec); save(); continue; }
    for (const arm of ['A', 'B']) {
      const tries = []; let gap = null; const reads = { brief: BRIEF, intro: { text: a2t }, details: { text: b2t } };
      let memoCut = false;
      for (let k = 1; k <= TRIES; k += 1) {
        const rd = arm === 'B' && k > 0 ? (() => { const m = memo(tries); memoCut = memoCut || m.cut; return { ...reads, carryMemo: m.s }; })() : reads;
        const r = await run(`r${i}-C${arm}${k}`, GOALS.C, rd, gap, k);
        const text = textOf(r);
        if (text === null) { tries.push({ text: '(no answer)', green: false, red: r.red ?? 'no answer', usd: r.costUsd, ok: false }); gap = r.red ?? 'no answer'; continue; }
        const c = check(text);
        tries.push({ text, green: c.green, red: c.red, usd: r.costUsd, ok: true });
        gap = c.red;
        if (c.green) break;
      }
      const last = tries[tries.length - 1];
      rec[arm] = { tries, green: last.green, nTries: tries.length, usd: tries.reduce((s, t) => s + (t.usd ?? 0), 0), honoursAsk1: last.ok ? honoursAsk1(last.text) : false, memoCut };
    }
    results.push(rec); save();
    console.log(`run ${i + 1}: A ${rec.A.green ? 'green' : 'red'}/${rec.A.nTries}  B ${rec.B.green ? 'green' : 'red'}/${rec.B.nTries}  spent $${ledgerTotal().toFixed(4)}`);
  }
} catch (e) { if (e instanceof Halt) { halted = e.message; console.error('HALT:', halted); } else { halted = `error: ${e.message}`; console.error(e); } }
save({ halted });
console.log('DONE', halted ?? 'complete', `spent $${ledgerTotal().toFixed(4)}`);
