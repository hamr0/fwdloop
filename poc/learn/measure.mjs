// F79 measures. usage: node measure.mjs <flowsRoot> <variant> <outDir>   variant: A | B1 | B2 (cumulative) ; $0.
// Prints counts only; the per-card dump (real text, PII) goes to <outDir> OUTSIDE the repo.
import fs from 'node:fs';
import path from 'node:path';
import { loadRuns } from './adapter.mjs';
import { makeVariant } from './variants.mjs';

const [flowsRoot, variant = 'A', outDir] = process.argv.slice(2);
const L = await makeVariant(variant);
const runs = loadRuns(flowsRoot);
let ledger = L.emptyLedger();
const rows = []; const cards = []; const dump = [];
for (const r of runs) {
  const b = L.buildCards({ runid: `${r.wf}/${r.run}`, events: r.events, spec: r.spec, model: r.model, questions: r.failText });
  const cand = b.cards.length + b.thin + b.suspect.length;
  rows.push({ wf: r.wf, run: r.run, cards: b.cards.length, fixed: b.cards.filter((c) => c.kind === 'FIXED').length, stuck: b.cards.filter((c) => c.kind === 'NEVER_FIXED').length, thin: b.thin, suspect: b.suspect.length, noise: b.noise, cand });
  for (const c of b.cards) {
    cards.push(c);
    const gap = r.events.filter((e) => e.type === 'exit-eval' && e.results[0].pass === false && e.results[0].type === c.check).map((e) => e.results[0].detail);
    dump.push({ id: c.id, kind: c.kind, kinds: c.kinds, saidLine: L.saidLine(c.said), said: c.said, tokens: c.tokens.length, fixTouched: c.fixTouched, changed: L.changedLines(c.whatChanged).length, firstGap: gap[0], lastGap: gap.at(-1) });
  }
  ledger = L.countLedger(ledger, { runid: `${r.wf}/${r.run}`, cards: b.cards, workflow: r.wf, place: L.placeOf(r.spec), specHash: r.specHash, trust: 'deterministic', now: new Date(r.at) });
}
const pct = (a, b) => (b ? `${a}/${b} = ${Math.round((100 * a) / b)}%` : `${a}/0`);
const cand = rows.reduce((a, r) => a + r.cand, 0);
const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
console.log(`variant ${variant}: runs ${rows.length}; runs with candidates ${rows.filter((r) => r.cand).length}; candidates(FIXED+NEVER+thin+suspect) ${cand}`);
console.log(`(a) cards ${cards.length} (FIXED ${sum('fixed')}, NEVER FIXED ${sum('stuck')}); dropped: thin ${sum('thin')}, suspect ${sum('suspect')}, noise runs ${rows.filter((r) => r.noise).length}`);
console.log(`BAR1 survive: ${pct(cards.length, cards.length + sum('thin'))} (suspect ${sum('suspect')} also dropped)`);
console.log(`(b) kinds ['other']: ${pct(cards.filter((c) => c.kinds[0] === 'other').length, cards.length)}; kinds seen: ${[...new Set(cards.flatMap((c) => c.kinds))].join(' | ')}`);
const flagged = cards.filter((c) => c.said.some((l) => L.flaggedText(l) !== null || L.flaggedText(`close: ${l}`) !== null)).length;
const empty = cards.filter((c) => !c.said.length).length;
console.log(`(c) It said: flaggedText matched ${flagged}, fallback line ${cards.length - flagged - empty}, empty ${empty}`);
const lessons = ledger.rows;
console.log(`(d) ledger rows ${lessons.length}; seen>=2: ${lessons.filter((r) => r.count >= 2).length} [${lessons.filter((r) => r.count >= 2).map((r) => `${r.workflow}:${r.count}`).join(', ')}]; climbed: ${L.climb(lessons).filter((r) => r.level !== 'workflow').length}`);
const redRuns = new Map(); for (const r of rows) if (r.cand) redRuns.set(r.wf, (redRuns.get(r.wf) ?? 0) + 1);
console.log(`    workflows with >=2 red runs: ${[...redRuns].filter(([, n]) => n >= 2).map(([w, n]) => `${w}(${n})`).join(', ')}`);
console.log(`    BAR3: ${lessons.filter((r) => r.count >= 2 && (redRuns.get(r.workflow) ?? 0) >= 2).length} lesson(s) seen>=2 in a workflow with >=2 red runs`);
const fx = cards.filter((c) => c.kind === 'FIXED');
console.log(`(e) Fix touched non-empty ${pct(cards.filter((c) => c.fixTouched.length).length, cards.length)}; What changed non-empty (FIXED) ${pct(fx.filter((c) => L.changedLines(c.whatChanged).length).length, fx.length)}`);
const top = [...redRuns].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
const now = new Date(runs.at(-1).at);
for (const w of top) {
  const h = L.renderHints(ledger, { workflow: w, place: null, now });
  const parsed = L.parseHintBlock(h.text);
  const ok = parsed.length === h.ids.length && parsed.every((p, i) => p.n === i + 1 && p.check && (p.fixed === (lessons.find((r) => r.id === h.ids[i]).sample.kind === 'FIXED')));
  console.log(`(f) ${w}: hints ${h.ids.length}, chars ${h.text.length}, parse round-trip ${h.text ? (ok ? 'ok' : 'FAIL') : 'n/a (empty)'}`);
  if (outDir) fs.writeFileSync(path.join(outDir, `hint-${variant}-${w}.txt`), h.text);
}
if (outDir) { fs.writeFileSync(path.join(outDir, `cards-${variant}.json`), JSON.stringify(dump, null, 1)); fs.writeFileSync(path.join(outDir, `rows-${variant}.json`), JSON.stringify(rows, null, 1)); fs.writeFileSync(path.join(outDir, `ledger-${variant}.json`), JSON.stringify(ledger, null, 1)); }
const aging = cards.filter((c) => /^m10b-aging/.test(c.job));
console.log(`(h) cards for m10b-aging* jobs: ${aging.length}; any mentioning bucket: ${aging.filter((c) => /bucket/i.test(JSON.stringify(c))).length}; runs of m10b-aging* seen: ${rows.filter((r) => /^m10b-aging/.test(r.wf)).length}`);
