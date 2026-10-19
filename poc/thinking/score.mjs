#!/usr/bin/env node
// POC (throwaway, never shipped): reads a batch's results.jsonl and prints, per job x arm, passes/n, median cost, median wall,
// median turns, then the F69 verdict by the win rule written in docs/logs/FINDINGS.md (F69), exactly:
//   BUILD `retry` if, on BOTH jobs, retry passes at least as many runs as `on`, AND retry is faster (median wall) or cheaper
//   (median cost) than `on` on at least one job. Otherwise NO BUILD. Turns are reported, they do not decide.
// A median over a cost that is null (unknown) is null, never 0; a verdict that needs it is INCOMPLETE, not a guess.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const F69_JOBS = Object.freeze(['aging-live-4', 'am29-walk-2']);

export function median(xs) {
  if (xs.length === 0 || xs.some((x) => typeof x !== 'number')) return null;
  const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function summarize(rows) {
  const out = {};
  for (const r of rows) {
    const g = (out[r.job] ??= {})[r.arm] ??= { rows: [] };
    g.rows.push(r);
  }
  for (const arms of Object.values(out)) {
    for (const g of Object.values(arms)) {
      g.n = g.rows.length;
      g.passes = g.rows.filter((r) => r.pass === true).length;
      g.medCost = median(g.rows.map((r) => r.costUsd));
      g.medWall = median(g.rows.map((r) => r.wallMs));
      g.medTurns = median(g.rows.map((r) => r.turns));
    }
  }
  return out;
}

/** @returns {{verdict:'BUILD'|'NO BUILD'|'INCOMPLETE', why:string}} */
export function f69Verdict(sum, jobs = F69_JOBS) {
  let better = false;
  for (const j of jobs) {
    const on = sum[j]?.on; const retry = sum[j]?.retry;
    if (!on || !retry) return { verdict: 'INCOMPLETE', why: `no on/retry rows for ${j}` };
    if (retry.passes < on.passes) return { verdict: 'NO BUILD', why: `${j}: retry passes ${retry.passes} < on ${on.passes}` };
    if (retry.medWall === null || on.medWall === null || retry.medCost === null || on.medCost === null) return { verdict: 'INCOMPLETE', why: `${j}: a median is unknown (null cost)` };
    if (retry.medWall < on.medWall || retry.medCost < on.medCost) better = true;
  }
  return better ? { verdict: 'BUILD', why: 'retry passes >= on on both jobs and is faster or cheaper on at least one' }
    : { verdict: 'NO BUILD', why: 'retry is neither faster nor cheaper than on on either job' };
}

export const F70_JOBS = Object.freeze(['m7-walk-2']);

/** F70 rule (FINDINGS F70): BUILD `retry` if it passes at least as many runs as `today` AND its median wall or median cost is lower. */
export function f70Verdict(sum, jobs = F70_JOBS) {
  let better = false;
  for (const j of jobs) {
    const today = sum[j]?.today; const retry = sum[j]?.retry;
    if (!today || !retry) return { verdict: 'INCOMPLETE', why: `no today/retry rows for ${j}` };
    if (retry.passes < today.passes) return { verdict: 'NO BUILD', why: `${j}: retry passes ${retry.passes} < today ${today.passes}` };
    if (retry.medWall === null || today.medWall === null || retry.medCost === null || today.medCost === null) return { verdict: 'INCOMPLETE', why: `${j}: a median is unknown (null cost)` };
    if (retry.medWall < today.medWall || retry.medCost < today.medCost) better = true;
  }
  return better ? { verdict: 'BUILD', why: 'retry passes >= today and is faster or cheaper' }
    : { verdict: 'NO BUILD', why: 'retry is neither faster nor cheaper than today' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--rule');
  const rule = ri >= 0 ? args.splice(ri, 2)[1] : 'f69';
  if (rule !== 'f69' && rule !== 'f70') { process.stderr.write('--rule must be f69 or f70\n'); process.exit(2); }
  const p = args[0];
  if (!p) { process.stderr.write('usage: node poc/thinking/score.mjs <out>/results.jsonl [--rule f69|f70]\n'); process.exit(2); }
  const rows = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const sum = summarize(rows);
  const f = (x, d) => (x === null ? 'unknown' : x.toFixed(d));
  for (const [job, arms] of Object.entries(sum)) {
    for (const [arm, g] of Object.entries(arms)) {
      process.stdout.write(`${job.padEnd(14)} ${arm.padEnd(6)} pass ${g.passes}/${g.n}  median cost $${f(g.medCost, 5)}  wall ${f(g.medWall === null ? null : g.medWall / 1000, 1)}s  turns ${f(g.medTurns, 1)}\n`);
    }
  }
  const v = rule === 'f70' ? f70Verdict(sum) : f69Verdict(sum);
  process.stdout.write(`${rule.toUpperCase()} verdict: ${v.verdict} (${v.why})\n`);
}
