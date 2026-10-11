// M4d amendment 8 (docs/wiki/the-module-ladder.md): a step whose check is green must read an input with cells (a CSV),
// never only a text output of an earlier step. The plan checker refuses it at $0; the drafter is told; a run reads the input.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';
import { buildSystemPrompt } from '../src/drafter.js';
import { writeFlow } from '../src/flow.js';
import { runFlow } from '../src/runner.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const prose = readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.signed.txt'), 'utf8');
const asDrafted = () => JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.declaration.json'), 'utf8'));
const cat = loadCatalogue();
assert.equal(cat.ok, true);
const parsed = parseSignedText(prose);
assert.equal(parsed.ok, true, JSON.stringify(parsed.reds));
const check = (decl, p = parsed) => validateDeclaration(decl, { arbiter: p.arbiter, lines: p.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true });
const SENTENCE = "Line 2's check needs cells, but it reads only aging_text. Line 2 must read aging.";

test('(a) the aging-live-1 plan as drafted (green step reads only a text output) is refused at $0 with the sentence', () => {
  const r = check(asDrafted());
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes(SENTENCE)), JSON.stringify(r.reds));
});

test('(a) a green step that reads nothing is refused too; no cells input signed says what is missing', () => {
  const d = asDrafted(); d.steps[1].reads = [];
  assert.ok(check(d).reds.some((x) => x.includes("Line 2's check needs cells, but it reads nothing. Line 2 must read aging.")));
  const noCsv = parseSignedText(prose.replace(/source aging = file:.*/, 'source aging = file:/tmp/aging.docx'));
  assert.equal(noCsv.ok, true, JSON.stringify(noCsv.reds));
  const r = check(asDrafted(), noCsv);
  assert.ok(r.reds.some((x) => x.includes("Line 2's check needs cells, but it reads only aging_text. Line 2 must read a spreadsheet input, and this job signs none.")), JSON.stringify(r.reds));
});

test('(b) the same plan with step 2 reading `aging` passes the checker', () => {
  const d = asDrafted(); d.steps[1].reads = ['aging']; d.steps[2].reads = ['bucket_assignment']; // am9: the ask reads what it asks about
  const r = check(d);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const d2 = asDrafted(); d2.steps[1].reads = ['aging_text', 'aging']; d2.steps[2].reads = ['bucket_assignment'];
  assert.equal(check(d2).ok, true);
});

test('(b) a read naming an unknown id is still refused; a step output may not share an input id', () => {
  const d = asDrafted(); d.steps[1].reads = ['nope'];
  assert.ok(check(d).reds.some((x) => x.includes('"nope" that no earlier step declared')));
  const e = asDrafted(); e.steps[0].emits = 'aging'; e.steps[1].reads = ['aging'];
  assert.ok(check(e).reds.some((x) => x.includes('"aging" is also a signed input')), JSON.stringify(check(e).reds));
});

test('(c) a run where the green step reads `aging` gets its cells and passes the green close; a bad cite is still red', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am8-'));
  const d = asDrafted(); d.steps[1].reads = ['aging']; d.steps[2].reads = ['bucket_assignment']; // the stop reads what it asks about
  const csv = path.join(root, 'aging.csv');
  writeFileSync(csv, readFileSync(path.join(HERE, '..', 'fixtures', 'ar-aging.csv')));
  const text = sandboxSend(prose.replace('file:/home/hamr/fwdloop-out', 'file:poc/m0/out').replace(/source aging = file:.*/, `source aging = file:${csv}`));
  const w = writeFlow({ root, name: 'aging', proseText: text, declaration: d, signedBy: 'hamr', signedAt: '2026-10-11T00:00:00Z', catalogue: cat.primitives });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  const seen = [];
  const run = async (runId, cite) => runFlow({
    root, name: 'aging', runId, sources: [{ id: 'aging', path: csv }], catalogue: cat.primitives,
    modelStep: async (ctx) => {
      if (ctx.goal.startsWith('Put each')) {
        seen.push(ctx.reads);
        return { ok: true, costUsd: 0.001, artifact: { fields: { inv1: { value: 4200, cite } }, done: true } };
      }
      return { ok: true, costUsd: 0.001, artifact: { text: 'x', done: true } };
    },
    askStep: async () => ({ decision: 'accept' }),
    sendStep: async () => ({ ok: true, bytes: 1 }),
    primitives: {}, businessDate: '2026-10-11',
  });
  const good = await run('run-1', 'aging!E2');
  assert.equal(seen[0].aging.kind, 'cells');
  assert.equal(seen[0].aging.rows[0].cells.E, '4200');
  assert.ok(good.auditRows, JSON.stringify([good.outcome, good.red]));
  assert.notEqual(good.outcome, 'red', good.red);
  assert.ok(good.auditRows.some((r) => r.step === 'bucket_assignment' && r.verdict === 'green'), JSON.stringify(good.auditRows.map((r) => [r.step, r.verdict])));
  const bad = await run('run-2', 'aging!E3');
  assert.equal(bad.outcome, 'struck-out'); // a wrong cite is still caught: the close is not loosened
  assert.match(bad.red, /4200 ≠ cite aging!E3 = 1500/);
});

test('(d) the drafter prompt tells the rule plainly', () => {
  const p = buildSystemPrompt({ menu: cat.primitives.slice(0, 2), lines: parsed.lines, arbiter: parsed.arbiter, factsInfo: [] });
  assert.match(p, /A step whose line has a "green" guardrail must list the CSV input's role in its reads/);
  assert.match(p, /aging/, 'names the cells input(s) this job signs');
});
