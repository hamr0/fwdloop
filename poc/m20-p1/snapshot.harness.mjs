// M20 P1: $0 snapshot of every panel answer for every run of a flows-root COPY.
// usage: node poc/m20-p1/snapshot.harness.mjs <rootCopy> <out.json>
// Calls the panel's own getters the way src/panel/server.js does. Nothing is dropped from the answers.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listFlowNames, listRunIds } from '../../src/flow.js';
import {
  listRuns, getRunDetail, getRunAudit, getRunJob, getRunAsks, getRunResult, listStops,
} from '../../src/panel/data.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { newestMcpChecks } from '../../src/mcp-checks.js';

const [rootArg, outArg] = process.argv.slice(2);
if (!rootArg || !outArg) { console.error('usage: snapshot.harness.mjs <rootCopy> <out.json>'); process.exit(2); }
const root = resolve(rootArg);
const home = process.env.HOME;
if (/\/\.config\/fwdloop\/flows\/?$/.test(root) && root.startsWith(`/home/${process.env.USER}/.config`)) {
  console.error('refusing: this is the real root; pass a copy'); process.exit(2);
}
const FIXED = 1795000000000; // pinned now (ms)
const now = () => FIXED;
const loaded = loadCatalogue();
if (!loaded.ok) { console.error(`catalogue failed: ${loaded.reds.join('; ')}`); process.exit(1); }
const catalogue = loaded.primitives;
const resumeAttempt = () => null; // no panel process: no resume attempts, as after a restart
const startingRun = () => false;
const triggerRead = () => null;   // server passes opts.author.trigger.facts; no author here
const mcpChecks = () => newestMcpChecks(home);

const out = {};
const rec = (key, fn) => {
  try { out[key] = fn(); } catch (e) { out[key] = { __threw: String(e && e.stack ? e.stack.split('\n')[0] : e) }; }
};
rec('_/_/listRuns', () => listRuns({ root, catalogue, resumeAttempt, startingRun, now }));
rec('_/_/listStops', () => listStops({ root, resumeAttempt, catalogue }));
let runs = 0;
const flows = listFlowNames(root);
for (const flow of flows) {
  for (const runId of listRunIds(`${root}/${flow}`)) {
    runs += 1;
    const k = `${flow}/${runId}`;
    rec(`${k}/detail`, () => getRunDetail({ root, flow, runId, catalogue, resumeAttempt, startingRun, triggerRead, now }));
    rec(`${k}/audit`, () => getRunAudit({ root, flow, runId, scheduleRead: triggerRead, catalogue, resumeAttempt, startingRun, now }));
    rec(`${k}/job`, () => getRunJob({ root, flow, runId, catalogue, scheduleRead: triggerRead, mcpChecks }));
    rec(`${k}/asks`, () => getRunAsks({ root, flow, runId, catalogue, resumeAttempt, now }));
    rec(`${k}/result`, () => getRunResult({ root, flow, runId, catalogue, resumeAttempt, now }));
  }
}
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
writeFileSync(outArg, `${JSON.stringify(sorted, null, 2)}\n`);
const threw = Object.values(sorted).filter((v) => v && typeof v === 'object' && '__threw' in v).length;
console.log(`flows=${flows.length} runs=${runs} keys=${Object.keys(sorted).length} threw=${threw}`);
