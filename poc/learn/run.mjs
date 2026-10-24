// F79 arm A/B runner. usage: node run.mjs <flowsRoot> <outJson>   $0, no provider call. Output goes OUTSIDE the repo (PII).
import fs from 'node:fs';
import { loadRuns } from './adapter.mjs';
import * as L from './learn.mjs';

const [flowsRoot, outFile] = process.argv.slice(2);
const runs = loadRuns(flowsRoot);
const stats = [];
let ledger = L.emptyLedger();
const allCards = [];
const now = new Date(runs.at(-1).at);
for (const r of runs) {
  const b = L.buildCards({ runid: `${r.wf}/${r.run}`, events: r.events, spec: r.spec, model: r.model, questions: r.failText });
  const fixed = b.cards.filter((c) => c.kind === 'FIXED').length;
  const stuck = b.cards.filter((c) => c.kind === 'NEVER_FIXED').length;
  stats.push({ wf: r.wf, run: r.run, at: r.at, outcome: r.outcome, cards: b.cards.length, fixed, stuck, thin: b.thin, suspect: b.suspect.length, noise: b.noise });
  allCards.push(...b.cards);
  ledger = L.countLedger(ledger, { runid: `${r.wf}/${r.run}`, cards: b.cards, workflow: r.wf, place: L.placeOf(r.spec), specHash: r.specHash, trust: 'deterministic', now: new Date(r.at) });
}
fs.writeFileSync(outFile, JSON.stringify({ stats, cards: allCards, ledger, now }, null, 1));
console.log('runs', runs.length, 'cards', allCards.length);
