// F125 ($0, no model, no network, no pass): M13 am4 — what the server already gives the Job tab / Reuse about Flow type + MCP, and can reuse-check decide on them.
// Pre-registered in docs/logs/FINDINGS.md. Run: timeout 300 node poc/mcp/f125/f125.mjs   (repo root). Exit 0 = every item passed.
// Works ONLY on mkdtemp `cp -a` COPIES of three of ~/.config/fwdloop/flows/*; the originals are read, never written.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../../../scripts/tmp-track.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REAL = path.join(process.env.HOME, '.config/fwdloop');
const fakeHome = mkdtempSync(path.join(tmpdir(), 'f125-home-'));
process.env.HOME = fakeHome;

const { world, reapChildren } = await import(path.join(REPO, 'test/m4e-world.mjs'));
const { flowTypeOf } = await import(path.join(REPO, 'src/declaration.js'));
const { newestMcpChecks } = await import(path.join(REPO, 'src/mcp-checks.js'));

const JOBS = { mcp: ['browse-check', 'run-1'], tickets: ['ticket-triage-5', 'run-1'], plain: ['m7-walk-2', 'run-1'] };
const results = [];
const say = (id, pass, line) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${line}`); };
const info = (line) => console.log(`INFO ${line}`);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

let w;
try {
  w = await world({ limit: 5 });
  copyFileSync(path.join(REAL, 'mcp-checks.jsonl'), path.join(w.home, 'mcp-checks.jsonl'));
  const decl = {}; const jobs = {}; const flowsEntry = {};
  for (const [kind, [flow]] of Object.entries(JOBS)) {
    execFileSync('cp', ['-a', path.join(REAL, 'flows', flow), path.join(w.root, flow)]);
    decl[kind] = readJson(path.join(w.root, flow, 'signed/declaration.json'));
  }
  const flows = (await w.get('/api/author/flows')).json();
  for (const [kind, [flow]] of Object.entries(JOBS)) flowsEntry[kind] = (flows?.flows ?? []).find((f) => f.flow === flow) ?? null;
  info(`flows listed: ${(flows?.flows ?? []).map((f) => f.flow).join(', ')}`);

  // (a1) the /job payload
  const keysOf = (j) => Object.keys(j ?? {});
  const wanted = { mcp: ['flowType', 'mcp'], tickets: ['flowType', 'mcp', 'ticketFilter', 'ticketWatch'] };
  let a1 = true; const a1lines = [];
  for (const [kind, [flow, run]] of Object.entries(JOBS)) {
    const r = await w.get(`/api/runs/${flow}/${run}/job`);
    jobs[kind] = r.json();
    const j = jobs[kind];
    const text = JSON.stringify(j ?? {});
    const hasType = Object.hasOwn(j ?? {}, 'flowType'); const hasMcp = /"mcp"/.test(text) || Object.hasOwn(j ?? {}, 'mcp');
    const hasTools = Array.isArray(j?.mcp?.tools) && j.mcp.tools.every((t) => typeof t?.name === 'string' && 'hint' in t);
    const hasFilter = Object.hasOwn(j ?? {}, 'ticketFilter'); const hasWatch = Object.hasOwn(j ?? {}, 'ticketWatch');
    a1lines.push(`${kind}: status ${r.status}, keys [${keysOf(j).join(',')}]; flowType ${hasType}, mcp-in-payload ${hasMcp}, tools{name,hint} ${hasTools}, ticketFilter ${hasFilter}, ticketWatch ${hasWatch}`);
    if (kind === 'mcp') a1 &&= hasType && hasMcp && hasTools;
    if (kind === 'tickets') a1 &&= hasType && hasMcp && hasTools && hasFilter && hasWatch;
    if (kind === 'plain') a1 &&= !hasType && !hasMcp && !hasFilter && !hasWatch;
  }
  say('a1', a1, a1lines.join(' | '));

  // (a2) the flows list
  let a2 = true; const a2lines = [];
  for (const [kind, [flow]] of Object.entries(JOBS)) {
    const e = flowsEntry[kind];
    const want = { flowType: flowTypeOf(decl[kind]), mcp: decl[kind].mcp?.server ?? null };
    const ok = !!e && e.flowType === want.flowType && e.mcp === want.mcp;
    a2lines.push(`${kind}: ${e ? `listed flowType ${e.flowType} mcp ${e.mcp}` : 'NOT LISTED'} vs signed ${want.flowType}/${want.mcp}`);
    a2 &&= ok;
  }
  say('a2', a2, a2lines.join(' | '));

  // (a3) where each missing item lives
  const signedHint = []; 
  const scan = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== 'runs') scan(p); } else if (/hint/.test(readFileSync(p, 'utf8'))) signedHint.push(path.relative(w.root, p)); } };
  for (const [, [flow]] of Object.entries(JOBS)) scan(path.join(w.root, flow));
  const checks = newestMcpChecks(w.home);
  const hintFor = (server) => [...checks.values()].filter((c) => c.server === server && c.ok === true).map((c) => ({ path: c.path, tools: c.tools?.length, withHint: (c.tools ?? []).filter((t) => t.hint).length }));
  const locs = [];
  for (const kind of ['mcp', 'tickets']) {
    const d = decl[kind];
    locs.push(`${kind}: signed/declaration.json has flowType=${d.flowType} mcp.server=${d.mcp?.server} mcp.tools=${d.mcp?.tools?.length} names${d.ticketFilter ? ` ticketFilter=${JSON.stringify(d.ticketFilter)}` : ''}${d.ticketWatch ? ` ticketWatch=${JSON.stringify(d.ticketWatch)}` : ''}; hints in mcp-checks.jsonl: ${JSON.stringify(hintFor(d.mcp?.server))}`);
  }
  const toolsAreNames = ['mcp', 'tickets'].every((k) => decl[k].mcp.tools.every((t) => typeof t === 'string'));
  const runCopy = ['mcp', 'tickets'].every((k) => existsSync(path.join(w.root, JOBS[k][0], 'runs', JOBS[k][1], 'job', 'declaration.json')));
  say('a3', signedHint.length === 0 && toolsAreNames && ['mcp', 'tickets'].every((k) => hintFor(decl[k].mcp.server).length > 0),
    `signed files containing "hint": ${signedHint.length ? signedHint.join(',') : 'none'}; signed tools are bare names ${toolsAreNames}; run's job copy holds declaration.json ${runCopy}. ${locs.join(' || ')}`);

  // (b) reuse-check
  const bodyFor = (kind, extra = {}) => {
    const e = flowsEntry[kind];
    return { flow: e.flow, job: e.edit.card.job, fromRun: undefined, inputs: Object.entries(e.lastSources ?? {}).map(([role, p]) => ({ role, path: p })), runId: '', ...extra };
  };
  const rc = async (kind, extra) => { const r = await w.post('/api/author/reuse-check', bodyFor(kind, extra)); return { status: r.status, body: r.json() }; };
  let b1 = true; const b1lines = [];
  for (const kind of ['mcp', 'tickets', 'plain']) {
    const e = flowsEntry[kind]; if (!e) { b1 = false; b1lines.push(`${kind}: not listed`); continue; }
    const base = await rc(kind);
    const withFields = await rc(kind, e.flowType === 'plain' ? { flowType: 'plain', mcp: '' } : { flowType: e.flowType, mcp: e.mcp });
    const ok = base.body?.kind === 'run' && withFields.body?.kind === 'run';
    b1lines.push(`${kind}: base ${base.status}/${base.body?.kind ?? JSON.stringify(base.body).slice(0, 120)}; with signed fields ${withFields.status}/${withFields.body?.kind ?? JSON.stringify(withFields.body).slice(0, 120)}`);
    b1 &&= ok;
  }
  say('b1', b1, b1lines.join(' | '));

  const changes = [['mcp', { flowType: 'plain', mcp: '' }, 'mcp->plain'], ['plain', { flowType: 'mcp', mcp: 'barebrowse' }, 'plain->mcp'], ['tickets', { flowType: 'mcp', mcp: 'github' }, 'tickets->mcp'], ['mcp', { flowType: 'mcp', mcp: 'baremobile' }, 'mcp other server']];
  let b2 = true; const b2lines = [];
  for (const [kind, extra, label] of changes) {
    if (!flowsEntry[kind]) { b2 = false; b2lines.push(`${label}: not listed`); continue; }
    const r = await rc(kind, extra);
    const ok = r.body?.kind === 'draft' && new RegExp(`^${flowsEntry[kind].flow.replace(/-\d+$/, '')}-\\d+$`).test(r.body?.suggestedName ?? '');
    b2lines.push(`${label}: ${r.status}/${r.body?.kind ?? JSON.stringify(r.body).slice(0, 100)}${r.body?.suggestedName ? ` ${r.body.suggestedName}` : ''}`);
    b2 &&= ok;
  }
  say('b2', b2, b2lines.join(' | '));

  say('b3', ['mcp', 'tickets', 'plain'].every((k) => flowsEntry[k] && flowsEntry[k].flowType === flowTypeOf(decl[k]) && (flowsEntry[k].mcp ?? null) === (decl[k].mcp?.server ?? null)),
    `signed side readable: ${['mcp', 'tickets', 'plain'].map((k) => `${k} ${flowTypeOf(decl[k])}/${decl[k].mcp?.server ?? null}`).join(', ')} (entryFor reads the same two values from readSigned; reuseCheck already holds \`read\`)`);
} catch (e) {
  console.log(`ERROR ${e?.stack ?? e}`);
  for (const id of ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']) if (!results.find((r) => r.id === id)) say(id, false, `harness error: ${String(e?.message ?? e).slice(0, 200)}`);
} finally {
  try { await w?.h?.close?.(); } catch { /* closed */ }
  try { await reapChildren(); } catch { /* none */ }
  rmSync(fakeHome, { recursive: true, force: true });
  if (w?.work) rmSync(w.work, { recursive: true, force: true });
}
console.log(results.every((r) => r.pass) && results.length === 6 ? 'ALL PASS' : 'NOT ALL PASS');
process.exit(results.every((r) => r.pass) && results.length === 6 ? 0 : 1);
