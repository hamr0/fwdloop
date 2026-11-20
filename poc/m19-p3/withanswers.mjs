// F232 / M19 P3 half 2 ($0): with P2's answers. usage: node poc/m19-p3/withanswers.mjs <p2 answers.json>
// For each answered draft (the file's jobs with `suggestions`): rebuild its block (copy of the draft folder, as P2 does), note every row, apply the saved suggestions through the real
// buildShapes + block.setShape, and compare. Bar: only rows on a line holding a candidate may change; 0 rows change on any other line (a job with no candidate has none, and is not touched).
// Waits for P2: with a file whose jobs hold no suggestions (or no file), it says so and exits 1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebuildBlock } from '../../src/planrebuild.js';
import { blockJobLines } from '../../src/blocklines.js';
import { listLinesOf } from '../../src/checklistsign.js';
import { buildShapes } from '../../src/shapebuild.js';
import { lineRules } from '../../src/pagebits.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log('half 2 waits for P2: no answers file'); process.exit(1); }
const answers = JSON.parse(fs.readFileSync(file, 'utf8'));
const jobs = (answers.jobs ?? []).filter((j) => Array.isArray(j.suggestions));
if (jobs.length === 0) { console.log('half 2 waits for P2: the file holds no answered job'); process.exit(1); }
const FLOWS = path.join(os.homedir(), '.config', 'fwdloop', 'flows', '.drafts');
const WORK = path.join(REPO, '.claude', 'scratch', 'v061', 'p3', 'work2');
fs.rmSync(WORK, { recursive: true, force: true });
const sig = (r) => JSON.stringify({ key: r.key, line: r.line, rule: r.rule, kind: r.kind, state: r.state, reason: r.reason ?? null, by: r.by, can: r.can ?? null, pick: r.pick ?? null, field: r.field ?? null });
let bad = 0; let changedOnCandidateLine = 0;
for (const j of jobs) {
  const dest = path.join(WORK, j.draft.replace('/', '__'));
  fs.cpSync(path.join(FLOWS, j.draft), dest, { recursive: true });
  const prose = fs.readFileSync(path.join(dest, 'prose.txt'), 'utf8');
  let decl = JSON.parse(fs.readFileSync(path.join(dest, 'declaration.json'), 'utf8'));
  if (!Array.isArray(decl.checkList)) {
    decl = { ...decl, checkList: blockJobLines(prose, decl).jobLines.map((l) => ({ line: l.n, kind: 'floor', state: 'built' })) };
    fs.writeFileSync(path.join(dest, 'declaration.json'), JSON.stringify(decl));
  }
  const rb = rebuildBlock({ planDir: dest, asks: true });
  if (!rb.ok) { console.log(`${j.draft}: not rebuilt (${rb.say.slice(0, 80)})`); bad += 1; continue; }
  const block = rb.block;
  const candLines = new Set(block.shapeCandidates().map((c) => c.line));
  const before = new Map(block.rows.map((r) => [r.key, sig(r)]));
  const all = blockJobLines(rb.proseText, undefined, []);
  const tied = all.jobLines.filter((l) => !listLinesOf(rb.declaration).has(l.n)).map((l) => l.n);
  const plan = blockJobLines(rb.proseText, undefined, tied);
  block.setShape(buildShapes({ lines: plan.jobLines.filter((l) => lineRules(l).length > 0 && !block.isSheetLine(l.n)), labels: block.labels, suggestions: j.suggestions }));
  block.reconcile();
  const keysAfter = new Set(block.rows.map((r) => r.key));
  const changed = [];
  for (const r of block.rows) if (before.get(r.key) !== sig(r)) changed.push(r);
  for (const k of before.keys()) if (!keysAfter.has(k)) changed.push({ key: k, line: block.rows.find((r) => r.key === k)?.line ?? Number(/^L(\d+)/.exec(k)?.[1]) });
  const offLine = changed.filter((r) => !candLines.has(r.line));
  changedOnCandidateLine += changed.length - offLine.length;
  if (offLine.length) bad += 1;
  console.log(`${j.draft}: candidate lines [${[...candLines]}], rows changed ${changed.length} (on a candidate line ${changed.length - offLine.length}, elsewhere ${offLine.length}${offLine.length ? `: ${offLine.map((r) => r.key).join(', ')}` : ''})`);
}
fs.rmSync(WORK, { recursive: true, force: true });
console.log(`half 2: ${jobs.length} answered jobs; ${bad} with a row changed off a candidate line or not rebuilt; rows changed on candidate lines ${changedOnCandidateLine}`);
console.log(`half 2 verdict on the letter: ${bad === 0 ? 'PASS' : 'FAIL'}`);
process.exit(bad === 0 ? 0 : 1);
