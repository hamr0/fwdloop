// F237 harness ($0, no AI, no key, no network): the report body of a job with no signed Ask.
// Usage: node poc/walk-bugs/f237-noask-report.mjs [--candidate]
//   no flag    = today's `sendBodyOf` (src/whole-job.js) only (the baseline column)
//   --candidate = also the candidate defined below (a copy inside poc/; nothing under src/ changes)
// Everything under ~/.config/fwdloop/flows and .claude/scratch/m19-walk-YBSm/flows is read only; (d) works on a scratch copy.
import { readFileSync, readdirSync, existsSync, mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { sendBodyOf, wholeJobAskIndex, reportContextOf, wholeJobText } from '../../src/whole-job.js';
import { readArtifactResult } from '../../src/runner.js';
import { parseSignedText } from '../../src/signed-text.js';

const CAND = process.argv.includes('--candidate');
const ROOTS = [join(homedir(), '.config/fwdloop/flows'), resolve('.claude/scratch/m19-walk-YBSm/flows')];

/**
 * The candidate: the same body as today when the plan has a signed Ask (whole-job or pre-am9); with no signed Ask, every step before the send through the
 * line loop of `wholeJobText` (an unsigned hitl step is a work step), the step right before the send read from the accepted `content`.
 */
function sendBodyCandidate(p) {
  const { content, wholeIdx, steps, sendIndex, askLines, context, runDir } = p;
  if (wholeIdx >= 0 || askLines.size > 0) return sendBodyOf(p);
  const before = steps[sendIndex - 1];
  const r = wholeJobText({
    steps, askLines, lastAskIndex: sendIndex, context,
    readResult: (id) => (before && id === before.emits ? { ok: true, value: content } : readArtifactResult(runDir, id)),
  });
  return r.ok ? { ok: true, body: r.value.text } : r;
}

const sections = (b) => (b.match(/^## /gm) ?? []).length;
const bytes = (b) => Buffer.byteLength(b, 'utf8');

/** every run folder that has the job copy and a send artifact */
function runs() {
  const out = [];
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const f of readdirSync(root)) {
      if (f.startsWith('.')) continue;
      const rd = join(root, f, 'runs');
      if (!existsSync(rd)) continue;
      for (const r of readdirSync(rd)) out.push({ root, flow: f, run: r, dir: join(rd, r) });
    }
  }
  return out;
}

/** load one run into the inputs `sendBodyOf` takes, or null with the reason it is skipped */
function load(run) {
  const prose = join(run.dir, 'job/prose.txt');
  const decl = join(run.dir, 'job/declaration.json');
  if (!existsSync(prose) || !existsSync(decl)) return { skip: 'no job copy' };
  let signed; let declaration;
  try { signed = parseSignedText(readFileSync(prose, 'utf8')); declaration = JSON.parse(readFileSync(decl, 'utf8')); } catch (e) { return { skip: `unreadable: ${e.message}` }; }
  if (!signed.ok) return { skip: 'job text does not parse' };
  const steps = declaration.steps;
  const sends = signed.arbiter.sends ?? [];
  if (!Array.isArray(steps) || sends.length !== 1) return { skip: 'no single send' };
  const sendIndex = steps.findIndex((s) => s.fromLine === sends[0].line);
  if (sendIndex < 1) return { skip: 'send step not found' };
  const art = readArtifactResult(run.dir, steps[sendIndex].emits);
  if (!art.ok) return { skip: 'the run never wrote its send artifact' };
  const askLines = new Map((signed.arbiter.asks ?? []).map((a) => [a.line, a]));
  const sendLines = new Map(sends.map((s) => [s.line, s]));
  const wholeIdx = wholeJobAskIndex({ steps, askLines, sendLines });
  return { signed, declaration, steps, sendIndex, content: art.value, askLines, wholeIdx, runDir: run.dir, hasAsk: askLines.size > 0 };
}

function bodies(L) {
  const mk = () => reportContextOf({ runDir: L.runDir, steps: L.steps, jobLines: L.signed.lines, checkList: L.declaration.checkList });
  const p = { content: L.content, wholeIdx: L.wholeIdx, steps: L.steps, sendIndex: L.sendIndex, askLines: L.askLines, context: mk(), runDir: L.runDir };
  const wrap = (f) => { try { return f(p); } catch (e) { return { threw: e.message }; } };
  return { today: wrap(sendBodyOf), cand: CAND ? wrap(sendBodyCandidate) : null };
}

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
say(`F237 harness, mode: ${CAND ? 'today + candidate' : 'today only (baseline)'}`);

const all = runs();
const loaded = all.map((r) => ({ r, L: load(r) }));
const skipped = loaded.filter((x) => x.L.skip);
const usable = loaded.filter((x) => !x.L.skip);
say(`run folders ${all.length}; usable ${usable.length}; skipped ${skipped.length} (${[...new Set(skipped.map((x) => x.L.skip))].join('; ')})`);

// (a)
const rt = usable.find((x) => x.r.flow === 'research-tracker' && x.r.run === 'run-1' && x.r.root.includes('m19-walk'));
if (!rt) say('(a) research-tracker run-1 not found');
else {
  const b = bodies(rt.L);
  const step2 = readArtifactResult(rt.r.dir, rt.L.steps[1].emits).value;
  const titles = [...String(step2.text).matchAll(/^\d+\.\s+(.+?)\s+—/gm)].map((m) => m[1]);
  say(`(a) step 2 titles read from its saved text: ${JSON.stringify(titles)}`);
  say(`(a) today body: ${bytes(b.today.body ?? '')} bytes, ok=${b.today.ok}, empty=${(b.today.body ?? '') === ''}`);
  if (CAND) {
    const cb = b.cand.body ?? '';
    const hit = titles.filter((t) => cb.includes(t));
    say(`(a) candidate body: ${bytes(cb)} bytes, ${sections(cb)} sections, titles found ${hit.length} of ${titles.length}`);
    say(`(a) ${titles.length === 4 && hit.length === 4 && (b.today.body ?? '') === '' ? 'PASS' : 'FAIL'}`);
  }
}

// (b) and (c)
const withAsk = usable.filter((x) => x.L.hasAsk);
const noAsk = usable.filter((x) => !x.L.hasAsk);
let diffB = 0; let threwB = 0;
const wholeCount = withAsk.filter((x) => x.L.wholeIdx >= 0).length;
for (const x of withAsk) {
  const b = bodies(x.L);
  if (b.today.threw) threwB += 1;
  if (CAND && JSON.stringify(b.today) !== JSON.stringify(b.cand)) { diffB += 1; say(`(b) DIFF ${x.r.flow}/${x.r.run}`); }
}
say(`(b) runs with a signed Ask compared: ${withAsk.length} (whole-job ${wholeCount}, pre-am9 or other ${withAsk.length - wholeCount}); today threw ${threwB}${CAND ? `; byte-identical ${withAsk.length - diffB}, differing ${diffB} -> ${diffB === 0 ? 'PASS' : 'FAIL'}` : ''}`);

let threw = 0; let refused = 0; let changed = 0;
say(`(c) runs with no signed Ask: ${noAsk.length}`);
for (const x of noAsk) {
  const b = bodies(x.L);
  const t = b.today.ok ? `${bytes(b.today.body)}B/${sections(b.today.body)}sec` : (b.today.threw ? 'THREW' : 'refused');
  let c = '-';
  if (CAND) {
    if (b.cand.threw) { threw += 1; c = 'THREW'; } else if (!b.cand.ok) { refused += 1; c = `refused: ${b.cand.red}`; if (b.today.ok) changed += 1; } else { c = `${bytes(b.cand.body)}B/${sections(b.cand.body)}sec`; if (b.cand.body !== b.today.body) changed += 1; }
  }
  say(`  ${x.r.flow}/${x.r.run}  today ${t}  candidate ${c}`);
}
if (CAND) say(`(c) threw ${threw}; refused ${refused}; body changed (or refused where today had a body) ${changed} of ${noAsk.length} -> ${threw === 0 ? 'PASS' : 'FAIL'}`);

// (d)
if (rt && CAND) {
  const tmp = mkdtempSync(join(tmpdir(), 'f237-'));
  try {
    const copy = (name) => { const d = join(tmp, name); cpSync(rt.r.dir, d, { recursive: true }); return d; };
    const run = (dir, label) => {
      const L = load({ ...rt.r, dir });
      if (L.skip) { say(`(d) ${label}: skipped ${L.skip}`); return null; }
      return bodies(L);
    };
    const d1 = copy('missing');
    rmSync(join(d1, 'artifacts', `${rt.L.steps[1].emits}.json`));
    const r1 = run(d1, 'd1 deleted'); say(`(d1) step 2 artifact deleted: today ${JSON.stringify(r1.today).slice(0, 160)}; candidate ${JSON.stringify(r1.cand).slice(0, 200)}`);
    const d1b = copy('badjson');
    writeFileSync(join(d1b, 'artifacts', `${rt.L.steps[1].emits}.json`), '{not json');
    const r1b = run(d1b, 'd1 bad json'); say(`(d1b) step 2 artifact not JSON: today ${JSON.stringify(r1b.today).slice(0, 160)}; candidate ${JSON.stringify(r1b.cand).slice(0, 200)}`);
    const d2 = copy('notdone');
    writeFileSync(join(d2, 'artifacts', `${rt.L.steps[1].emits}.json`), JSON.stringify({ done: false, blocker: 'x' }));
    const r2 = run(d2, 'd2'); say(`(d2) step 2 = {done:false}: today body ${JSON.stringify(r2.today.body)}; candidate body ${JSON.stringify(r2.cand.body)}`);
    const refusesNamed = (r) => r.ok === false && /missing|not valid JSON/.test(r.red) && r.red.includes(rt.L.steps[1].emits);
    say(`(d1) candidate refuses naming the step: deleted ${refusesNamed(r1.cand)}, bad json ${refusesNamed(r1b.cand)}`);
    say(`(d2) no invented text: candidate body has "Passed" ${/Passed/.test(r2.cand.body ?? '')}; no heading for the not-done step (it has no text/results/claims) ${!/## 2\./.test(r2.cand.body ?? '')}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const out = join(process.cwd(), '.claude/scratch/walk-bugs');
try { mkdtempSync; } catch { /* noop */ }
import('node:fs').then(({ mkdirSync, writeFileSync: w }) => { mkdirSync(out, { recursive: true }); w(join(out, CAND ? 'f237-candidate.txt' : 'f237-baseline.txt'), `${lines.join('\n')}\n`); });
