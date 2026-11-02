import { readFileSync } from 'node:fs';
const R = JSON.parse(readFileSync(new URL('./out/results.json', import.meta.url)));
const rs = R.results; const out = { n: rs.length, invalid: R.invalid.length, spent: R.spent, halted: R.halted ?? null, unpriced: R.unpriced };
const prefix = rs.reduce((s, r) => s + r.prefixUsd, 0) + R.invalid.reduce((s, r) => s + r.prefixUsd, 0);
for (const arm of ['A', 'B']) {
  const x = rs.map((r) => r[arm]); const g = x.filter((a) => a.green);
  const all3 = (t) => t && t.facts.okafor && t.facts.tom && t.facts.deadline;
  const per = (k) => [1, 2, 3].map((n) => ({ try: n, reached: x.filter((a) => a.tries[n - 1]).length, ...Object.fromEntries(['okafor', 'tom', 'deadline'].map((f) => [f, x.filter((a) => a.tries[n - 1]?.facts[f]).length])) }));
  out[arm] = {
    green: `${g.length}/${x.length}`, try1Green: `${x.filter((a) => a.tries[0].green).length}/${x.length}`,
    triesPerGreen: g.length ? +(g.reduce((s, a) => s + a.nTries, 0) / g.length).toFixed(2) : null,
    usdC: +x.reduce((s, a) => s + a.usd, 0).toFixed(4), usdPerGreen: g.length ? +(x.reduce((s, a) => s + a.usd, 0) / g.length).toFixed(4) : null,
    try1AllThreeFacts: `${x.filter((a) => all3(a.tries[0])).length}/${x.length}`,
    factsPerTry: per(), firstFactTry: x.map((a) => a.firstFactTry),
    textInstead: x.reduce((s, a) => s + a.tries.filter((t) => t.textInstead).length, 0), noAnswerTries: x.reduce((s, a) => s + a.tries.filter((t) => !t.ok).length, 0),
    memoCuts: x.filter((a) => a.memoCut).length,
  };
}
out.prefixUsd = +prefix.toFixed(4);
console.log(JSON.stringify(out, null, 1));
