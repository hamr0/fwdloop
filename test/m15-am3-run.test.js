// M15 am3 and am3a through a real run ($0, fake model): a sheet job with a count and a sum writes ONE report in the signed layout; Count and Total are code's (equal to a by-hand sum of the rows the
// step named); no file exists before the Accept; the second send the same day lands under -2 and the first file is untouched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow } from '../src/runner.js';
import { sha256Hex, serializeArtifact } from '../src/ask.js';
import { sendViaPrimitive } from '../src/send.js';
import { SEND_DIR } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPENSES = path.join(HERE, 'fixtures', 'm10b-sheets', 'expenses.csv');
const cat = loadCatalogue();
assert.equal(cat.ok, true);

// ---- the truth, by hand (not src/csv.js, not bareguard): the rows whose Amount is over 500, and the sum in cents ----
const cellsOf = (line) => { const out = []; let c = ''; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(c); c = ''; } else c += ch; } out.push(c); return out; };
const sheet = readFileSync(EXPENSES, 'utf8').split('\n').filter((l) => l !== '').map(cellsOf);
const OVER = sheet.map((c, i) => [i + 1, c[2]]).slice(1).filter(([, v]) => Number(v.replaceAll(',', '')) > 500);
const ROWS = OVER.map(([r]) => r);
const CENTS = OVER.reduce((a, [, v]) => a + Math.round(Number(v.replaceAll(',', '')) * 100), 0);
const money = (cents) => `${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;

const WHERE = [{ column: 'Amount', cmp: 'gt', value: 500 }];
const CHECKS = [
  { id: 'over-rows', rule: 'cells', table: 'expenses', op: 'rows', claim: 'expenseRows', covers: [1], where: WHERE },
  { id: 'over-total', rule: 'cells', table: 'expenses', op: 'sumIf', claim: 'expenseTotal', covers: [1], column: 'Amount', where: WHERE },
  { id: 'over-count', rule: 'cells', table: 'expenses', op: 'countIf', claim: 'expenseCount', covers: [1], where: WHERE },
];
const step = (goal, fromLine, emits, reads, close, primitives = []) => ({ goal, primitives, reads, emits, fromLine, close });
const DECL = {
  guardrailClasses: { 2: 'green' }, unjudgeable: {}, refused: [], inputFacts: { expenses: [] },
  steps: [
    step('Read the expenses sheet', 1, 'sheet_read', ['expenses'], { class: 'hitl' }, ['read']),
    step('List every expense over 500, with how many there are and their total', 2, 'large', ['expenses'], { class: 'green', columns: [{ source: 'expenses', column: 'Amount' }], sheet: CHECKS }, ['read']),
    step('check the result with me', 3, 'ask', ['large', 'sheet_read'], { class: 'hitl' }),
    step('write it out', 4, 'out', ['ask'], { class: 'hitl' }, ['write']),
  ],
};
const PROSE = `1. Read the expenses sheet
2. List every expense over 500, with how many there are and their total
   guardrail: Amount over 500
3. ask 1h: check the result with me
4. write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $1 per run
guardrail: send at line 4 to file:${SEND_DIR}
guardrail: source expenses = file:${EXPENSES}
`;
const modelStep = async (ctx) => (ctx.goal === 'Read the expenses sheet'
  ? { ok: true, costUsd: 0.001, artifact: { text: 'The sheet has Date, Description, Amount, Tax.', done: true } }
  // the AI's own count and total ride along: they are right (the check would red otherwise) but the report writes code's
  : { ok: true, costUsd: 0.001, artifact: { expenseRows: { rows: ROWS }, expenseTotal: { value: CENTS / 100 }, expenseCount: { value: ROWS.length }, done: true } });

const world = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am3run-'));
  const w = writeFlow({ root, name: 'expr', proseText: PROSE, declaration: DECL, signedBy: 'hamr', signedAt: '2026-11-18T10:00:00Z', catalogue: cat.primitives });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  const seen = [];
  const run = (runId) => runFlow({
    root, name: 'expr', runId, sources: [{ id: 'expenses', path: EXPENSES }], catalogue: cat.primitives, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-18',
    askStep: async ({ evidence }) => { seen.push(readdirSync(SEND_DIR)); return { decision: 'accept', artifactSha256: sha256Hex(serializeArtifact(evidence.artifact)) }; },
  });
  return { root, run, seen };
};
const bodyOf = (name) => readFileSync(path.join(SEND_DIR, name), 'utf8');
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

test('a sheet job writes one report: layout, Count then Total equal to the by-hand sum, no file before the Accept', async () => {
  const w = world();
  const res = await w.run('run-3');
  assert.equal(res.outcome, 'complete', res.red);
  assert.deepEqual(w.seen, [[]], 'the Ask was shown with the Destination still empty: no file before the accept');
  const files = readdirSync(SEND_DIR);
  assert.deepEqual(files, [`expr-${TODAY}.md`]);
  const got = bodyOf(files[0]);
  const lines = got.split('\n');
  assert.equal(lines[0], '# expr — run-3');
  assert.match(lines[1], /^Passed · \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  const count = lines.indexOf(`- Count: ${ROWS.length}`);
  const total = lines.indexOf(`- Total: ${money(CENTS)}`);
  assert.ok(count > 0 && total > count, `Count then Total: ${count}, ${total}\n${got}`);
  assert.ok(ROWS.length > 1 && CENTS > 0, 'the fixture names several rows');
  assert.ok(got.includes('## 2. List every expense over 500, with how many there are and their total\nRule: Amount over 500\n\n### Checked by code\n- Rows where Amount > 500: ' + ROWS.join(', ')), got);
  assert.ok(got.includes("## 1. Read the expenses sheet\n\n### The AI's answer (not checked — you judge it at Accept)\nThe sheet has Date, Description, Amount, Tax."));
  assert.ok(got.includes('Line 3') === false, 'the last Ask is not a section');
  assert.doesNotMatch(got, /[{}✓✗]/);
});

test('the second send the same day lands under -2, never over the first; the run records both names', async () => {
  const w = world();
  assert.equal((await w.run('run-1')).outcome, 'complete');
  const first = readFileSync(path.join(SEND_DIR, `expr-${TODAY}.md`));
  const again = await w.run('run-2');
  assert.equal(again.outcome, 'complete', again.red);
  assert.deepEqual(readdirSync(SEND_DIR).sort(), [`expr-${TODAY}-2.md`, `expr-${TODAY}.md`]);
  assert.deepEqual(readFileSync(path.join(SEND_DIR, `expr-${TODAY}.md`)), first, 'the first report is untouched');
  assert.match(bodyOf(`expr-${TODAY}-2.md`), /^# expr — run-2\n/);
  const rows = readFileSync(path.join(w.root, 'expr', 'runs', 'run-2', 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const sent = rows.find((r) => r.step === 'out' && r.verdict === 'green');
  assert.equal(sent.sentName, `expr-${TODAY}-2.md`);
  assert.equal(sent.sentTaken, `expr-${TODAY}.md`);
});
