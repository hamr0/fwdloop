// F192 POC ($0): `node poc/f192-revise/run.mjs` -> per-bar lines on stdout (tee into result-1.log). Bars are read in docs/logs/FINDINGS.md "F192 PRE-REGISTERED", not here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTrees } from './overlay.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const scratch = fs.mkdtempSync(path.join(process.env.F192_TMP ?? os.tmpdir(), 'f192-trees-'));
const say = (s) => console.log(s);
const trees = buildTrees(ROOT, scratch);
const run = (tree, job) => JSON.parse(execFileSync('node', [path.join(HERE, 'chain.mjs'), tree, job], { encoding: 'utf8', timeout: 150000, env: { ...process.env, F192_TMP: scratch } }).trim().split('\n').pop());
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const WANT = { 3: { rule: 'listItems', value: 3 }, 5: { rule: 'maxWords', value: 80 } };
const results = {};
try {
  const out = {};
  for (const job of ['walk-m16-m14', 'm14-walk-5', 'live-failure']) for (const t of ['current', 'ported']) { out[`${job}/${t}`] = run(trees[t], job); }
  for (const [k, r] of Object.entries(out)) {
    say(`\n## ${k}${r.error ? `  ERROR ${r.error}` : ''}`);
    if (r.error) continue;
    say(`  stage 1: stop ${r.stage1.stop}; asked ${JSON.stringify(r.stage1.asked.map((q) => `L${q.line} "${q.ruleText}" -> ${q.proposal}`))}; suggest call ${r.stage1.suggestCalled}`);
    say(`  stage 2 (Agree): answers ${r.stage2.answers}; ~ per line card0 ${JSON.stringify(r.tilde0)} -> grown ${JSON.stringify(r.stage2.tilde)}; picks ${JSON.stringify(r.stage2.picks.map((p) => `L${p.line}.${p.rule} ${JSON.stringify(p.check)}${p.added ? ` added "${p.added}"` : ''}`))}`);
    say(`  stage 2 grown job:\n${r.stage2.job.split('\n').map((l) => `    | ${l}`).join('\n')}`);
    say(`  stage 3 (redraft): stop ${r.stage3.stop}; record ${JSON.stringify(r.stage3.recordPicks.map((e) => `"${e.ruleText}"${e.added ? ` + "${e.added}"` : ''} ${JSON.stringify(e.check)}`))}`);
    say(`  negative control (Revise with no carried picks): asked lines ${JSON.stringify(r.negControl.asked)}; suggest call ${r.negControl.suggestCalled}`);
    say(`  stage 4 (Revise): stop ${r.stage4.stop}; asked ${JSON.stringify(r.stage4.asked.map((q) => `L${q.line} "${q.ruleText}"`))}; suggest call ${r.stage4.suggestCalled}; kept ${JSON.stringify(r.stage4.kept.map((x) => `L${x.line}.${x.rule} "${x.ruleText}" ${JSON.stringify(x.check)}`))}; ~ per line after ${JSON.stringify(r.stage4.tildeAfter)}`);
  }
  const negOk = ['walk-m16-m14', 'm14-walk-5'].every((j) => ['current', 'ported'].every((t) => out[`${j}/${t}`].negControl && (out[`${j}/${t}`].negControl.asked.some((n) => n === 3 || n === 5) || out[`${j}/${t}`].negControl.suggestCalled)));
  say(`  report-only sanity, not a pre-registered gate: a Revise with no carry asks on line 3/5 or calls the suggestion, every job and tree (so bar 1 can fail): ${negOk}`);
  const bars = (tree) => {
    const b = { 1: true, 2: true, 3: true };
    const why = [];
    let reached = true;
    for (const job of ['walk-m16-m14', 'm14-walk-5']) {
      const r = out[`${job}/${tree}`];
      if (r.error || !r.stage1 || r.stage1.asked.filter((q) => q.ask === 'check' && (q.line === 3 || q.line === 5)).length !== 2) { reached = false; why.push(`${job}: stage 1 did not ask the two check questions`); continue; }
      const s4 = r.stage4;
      if (s4.asked.some((q) => q.line === 3 || q.line === 5) || s4.suggestCalled) { b[1] = false; why.push(`${job}: Revise asked ${JSON.stringify(s4.asked.map((q) => q.line))} / suggest call ${s4.suggestCalled}`); }
      for (const n of [3, 5]) { const k = s4.kept.find((x) => x.line === n); if (!k || !same(k.check, WANT[n])) { b[2] = false; why.push(`${job}: line ${n} pick not kept as ${JSON.stringify(WANT[n])}`); } }
      if (!same(r.stage2.tilde, r.tilde0) || !same(s4.tildeAfter, r.tilde0)) { b[3] = false; why.push(`${job}: ~ per line ${JSON.stringify(r.tilde0)} -> ${JSON.stringify(r.stage2.tilde)}`); }
    }
    return { b, why, reached };
  };
  const cur = bars('current');
  const port = bars('ported');
  say('\n== BARS (PORTED), CONTROL (CURRENT)');
  for (const n of [1, 2, 3]) say(`  bar ${n}: PORTED ${port.b[n] ? 'pass' : 'FAIL'}; CURRENT ${cur.b[n] ? 'pass' : 'FAIL'}`);
  say(`  PORTED reasons: ${port.why.join(' | ') || 'none'}`);
  say(`  CURRENT reasons: ${cur.why.join(' | ') || 'none'}`);
  const verdict = (n, name) => {
    if (!port.reached) return 'INCONCLUSIVE (stage 1 did not reach the Agree)';
    if (n === 3 && cur.b[3]) return `INCONCLUSIVE (CURRENT does not fail bar 3, so it cannot fail on this data)${port.b[3] ? '' : '; PORTED fails'}`;
    return port.b[n] ? 'PASS' : 'FAIL';
  };
  for (const n of [1, 2, 3]) { results[n] = verdict(n); say(`BAR ${n}: ${results[n]}`); }
  say('  note: bar 3 second half (the Revise changes no ~ line) holds by construction: the Revise child is handed the grown job unchanged; the count is read from that job.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
say(`\nSUMMARY ${JSON.stringify(results)}`);
