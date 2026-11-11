// F176 study script (throwaway, $0). Usage:
//   node poc.mjs dump <codeRoot> <out.json>   build setup rows for every corpus session with that code
//   node poc.mjs compare <main.json> <cand.json>   bars 3
//   node poc.mjs bars <codeRoot>   bars 1/2/4 against that code (prints JSON; shapes and counts only)
import { readdirSync, writeFileSync, readFileSync, mkdtempSync, cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const HOME = process.env.HOME;
const SC = '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/bacc1500-09a3-4575-90fd-670b7893e350/scratchpad';
const CORPORA = [join(HOME, '.config/fwdloop/flows/.drafts'), ...['f162-1', 'f165-1', 'f168-1', 'f170-1', 'f172-1', 'f173-1'].map((d) => join(SC, d, 'flows/.drafts'))];
const REAL = join(HOME, '.config/fwdloop/flows/.drafts/d-00mv5hai9f-6c7b');
const imp = (root, f) => import(pathToFileURL(resolve(root, f)).href);
const A = { hash: 'h'.repeat(64), signedBy: 'poc', signedAt: '2026-01-01T00:00:00.000Z' };

function sessions() {
  const out = [];
  for (const c of CORPORA) { if (!existsSync(c)) continue; for (const d of readdirSync(c)) out.push(join(c, d)); }
  return out;
}
const build = (bsr, dir) => { try { return { rows: bsr({ sessionDir: dir, planDir: join(dir, 'draft'), ...A }) }; } catch (e) { return { err: e.code ?? e.name }; } };
const humans = (rows) => rows.filter((r) => r.kind === 'human');

const [mode, a, b] = process.argv.slice(2);
if (mode === 'dump') {
  const { buildSetupRows } = await imp(a, 'src/setup.js');
  const res = {};
  for (const d of sessions()) res[d] = build(buildSetupRows, d);
  writeFileSync(b, JSON.stringify(res));
  const n = Object.values(res);
  console.log(JSON.stringify({ sessions: n.length, built: n.filter((x) => x.rows).length, errors: n.filter((x) => x.err).length }));
} else if (mode === 'compare') {
  const m = JSON.parse(readFileSync(a, 'utf8')); const c = JSON.parse(readFileSync(b, 'utf8'));
  let looksCompared = 0; let looksDiff = 0; let added = 0; let addedSessions = 0; let otherDiff = 0; let errDiff = 0; let nonLookInMain = 0;
  for (const k of Object.keys(m)) {
    if (!m[k].rows || !c[k].rows) { if (JSON.stringify(m[k]) !== JSON.stringify(c[k])) errDiff += 1; continue; }
    const isLook = (r) => r.kind === 'human' && r.source === 'look';
    const ml = m[k].rows.filter(isLook).map((r) => JSON.stringify(r)); const cl = c[k].rows.filter(isLook).map((r) => JSON.stringify(r));
    looksCompared += ml.length;
    if (JSON.stringify(ml) !== JSON.stringify(cl)) looksDiff += 1;
    nonLookInMain += m[k].rows.filter((r) => r.kind === 'human' && r.source !== 'look').length;
    // candidate minus added non-look human rows must equal main (order preserved), except human row n for kept rows is shifted by added rows
    const strip = (rows) => rows.filter((r) => !(r.kind === 'human' && r.source !== 'look')).map((r) => (r.kind === 'human' ? { ...r, n: undefined } : r)).map((r) => JSON.stringify(r));
    if (JSON.stringify(strip(m[k].rows)) !== JSON.stringify(strip(c[k].rows))) otherDiff += 1;
    const add = c[k].rows.filter((r) => r.kind === 'human' && r.source !== 'look').length;
    if (add > 0) { added += add; addedSessions += 1; }
  }
  console.log(JSON.stringify({ sessions: Object.keys(m).length, looksCompared, sessionsWithLookDiff: looksDiff, nonLookRowsInMain: nonLookInMain, nonLookRowsAdded: added, sessionsWithAdded: addedSessions, otherDiffSessions: otherDiff, errDiff }));
} else if (mode === 'bars') {
  const { buildSetupRows, writeSetup } = await imp(a, 'src/setup.js');
  const { getDraftBlock } = await imp(a, 'src/panel/data.js');
  const real = build(buildSetupRows, REAL).rows;
  const h = humans(real);
  const out = { realHumanRows: h.length, realHumanShapes: h.map((r) => Object.keys(r).join(',')), realOrder: real.map((r) => r.kind).join('>') };
  // render through the Audit's row builder: write setup.jsonl, read it back via getDraftBlock
  const flow = mkdtempSync(join(tmpdir(), 'f176-flow-')); const run = mkdtempSync(join(tmpdir(), 'f176-run-'));
  try {
    const w = writeSetup({ flowDir: flow, sessionDir: REAL, planDir: join(REAL, 'draft'), ...A });
    const blk = getDraftBlock(flow, run);
    const rend = blk.rows.filter((r) => String(r.action).startsWith('you were asked: '));
    out.write = w.ok; out.rendered = rend.map((r) => ({ actionPrefixOk: r.action.startsWith('you were asked: '), gapPrefixOk: String(r.gap).startsWith('you said: '), pickedLabel: /picked/i.test(String(r.gap)), pos: blk.rows.indexOf(r), step: r.step }));
    out.rowKindsOrder = blk.rows.length;
  } finally { rmSync(flow, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
  // bar 4: planted copy with an extra unanswered non-look question
  const tmp = mkdtempSync(join(tmpdir(), 'f176-plant-'));
  try {
    const cp = join(tmp, 's'); cpSync(REAL, cp, { recursive: true });
    const base = humans(build(buildSetupRows, cp).rows).length;
    const qf = join(cp, 'draft/questions.json'); const j = JSON.parse(readFileSync(qf, 'utf8'));
    j.questions.push({ line: 1, question: 'planted unanswered' }); writeFileSync(qf, JSON.stringify(j));
    const after = humans(build(buildSetupRows, cp).rows).length;
    out.bar4 = { before: base, afterUnansweredAdded: after, addsNoRow: after === base };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  console.log(JSON.stringify(out));
}
