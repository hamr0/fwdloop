// F157 POC (PAID, pre-registered in docs/logs/FINDINGS.md): does the carry memo's `result: hitl` make the model remark on a disagreement, and does the fixed line stop it?
// The real model step (makeLiveModelStep) for walk-11 run-2's step `week_jobs`, BASELINE memo (as told then) vs AFTER memo (the fixed buildMemo on a copy of that run's record). Interleaved, N each.
// usage: FIREWORKS_API_KEY=... F157_OUT=<new dir> [F157_N=10] node poc/memo-hitl/f157.mjs
// The read tool here is a stand-in that serves the frozen notes (the run's own primitives need a signed flow); everything else is the runner's call.
import {
  existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { makeLiveModelStep } from '../../src/model-step.js';
import { buildMemo } from '../../src/memo.js';

const RUN = join(homedir(), '.config', 'fwdloop', 'flows', 'walk-11', 'runs', 'run-2');
const MODEL = 'accounts/fireworks/models/deepseek-v4p1-flash';
const SLOT = 'FIREWORKS_API_KEY';
const GUARD = 0.10;
const WORRY = /hitl|status line|ask record|which one holds|confirm(ing)? which/i;
const BASELINE = 'What happened so far in this run (written by code, from the record)\nask 1 (after step garden_lines): accept\nlast try: step garden_lines try 1 — result: hitl';

const out = process.env.F157_OUT;
const n = Number(process.env.F157_N ?? 10);
if (!process.env[SLOT]) { console.error(`refused at $0: ${SLOT} is empty`); process.exit(2); }
if (!out) { console.error('refused at $0: F157_OUT (a new folder) is not set'); process.exit(2); }
if (existsSync(out)) { console.error(`refused at $0: ${out} already exists`); process.exit(2); }
if (!Number.isInteger(n) || n < 1 || n > 20) { console.error('refused at $0: F157_N must be 1..20'); process.exit(2); }
mkdirSync(out, { recursive: true });

// the record as it stood when week_jobs started: run-2 copied, the audit cut before the first week_jobs row
const rec = join(out, 'record');
cpSync(RUN, rec, { recursive: true });
const rows = readFileSync(join(RUN, 'audit.jsonl'), 'utf8').split('\n').filter(Boolean);
const cut = rows.findIndex((l) => JSON.parse(l).step === 'week_jobs');
writeFileSync(join(rec, 'audit.jsonl'), rows.slice(0, cut).map((l) => `${l}\n`).join(''));
// ask 2 (after week_jobs) did not exist yet when week_jobs started: take its two files out of the copy
const ASK2 = '88432107-6781-4ed0-9900-7f403f566c98';
unlinkSync(join(rec, 'asks', `${ASK2}.json`));
unlinkSync(join(rec, `answer.${ASK2}.consumed.json`));
const AFTER = buildMemo(rec, { step: 'week_jobs' });
const asTold = AFTER.replace('result: done, for you to check at the Ask', 'result: hitl');
if (asTold !== BASELINE) { console.error(`refused at $0: the rebuilt record does not give the baseline text\n${asTold}`); process.exit(2); }
if (AFTER === BASELINE) { console.error('refused at $0: the fix is not in src/memo.js (AFTER equals BASELINE)'); process.exit(2); }

const notes = readFileSync(join(RUN, 'inputs', 'notes.md'), 'utf8');
const readTool = {
  name: 'read',
  description: 'Read an input by role. Available roles: notes.',
  parameters: { type: 'object', properties: { role: { type: 'string' }, path: { type: 'string' } }, additionalProperties: false },
  execute: async () => notes,
};
const GOAL = 'List 3 jobs for this week from the notes';

let spent = 0;
let unknownCost = false;
const results = [];
outer: for (let i = 1; i <= n; i += 1) {
  for (const [arm, memo] of [['baseline', BASELINE], ['after', AFTER]]) {
    if (spent >= GUARD) { console.log(`guard $${GUARD} reached before ${arm} ${i}; stopping`); break outer; }
    const dir = join(out, `${arm}-${i}`);
    mkdirSync(dir);
    const step = makeLiveModelStep({ slot: SLOT, model: MODEL, spendPath: join(dir, 'spend.jsonl') });
    const r = await step(
      { goal: GOAL, primitives: ['read'], reads: {}, gap: null, hints: null, memo },
      { read: readTool },
      { class: 'hitl', attempt: 1, step: 'week_jobs', thinkingMode: 'off' },
    );
    const text = JSON.stringify(r.artifact ?? r.red ?? '');
    const cost = typeof r.costUsd === 'number' ? r.costUsd : null;
    if (cost === null) unknownCost = true; else spent += cost;
    const row = { arm, i, ok: r.ok, worries: WORRY.test(text), done: r.artifact?.done ?? null, costUsd: cost, first200: text.slice(0, 200) };
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ ...row, result: r }, null, 1));
    results.push(row);
    console.log(`${arm} ${i}: worries=${row.worries ? 'y' : 'n'} done=${row.done} cost=${cost === null ? 'unknown' : cost.toFixed(5)} ${row.first200}`);
  }
}
const sum = (arm) => { const a = results.filter((x) => x.arm === arm); return { tries: a.length, worries: a.filter((x) => x.worries).length }; };
const b = sum('baseline'); const a = sum('after');
const verdict = b.worries < 2 ? 'INCONCLUSIVE (baseline worries < 2: cause not shown)' : (a.worries === 0 ? 'PASS' : 'FAIL');
console.log(`\nbaseline worries ${b.worries}/${b.tries}; after worries ${a.worries}/${a.tries}; spent ${unknownCost ? 'at least ' : ''}$${spent.toFixed(4)}\nF157 verdict on the letter: ${verdict}`);
writeFileSync(join(out, 'summary.json'), JSON.stringify({ baseline: b, after: a, spent, unknownCost, verdict, results }, null, 1));
