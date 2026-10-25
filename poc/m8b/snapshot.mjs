// F84 (docs/logs/FINDINGS.md): M8b POC harness. `node poc/m8b/snapshot.mjs <flows-root> <out.json>` writes one canonical JSON "view" of every run folder
// under <flows-root>, taken through the panel's own HTTP routes (the server started in-process on that root) plus the learnings adapter. It reads the same
// before and after the M8b move, so a diff of two outputs is the POC. It only READS <flows-root> (give it a `cp -a` copy, never the real flows/); the panel,
// settings and ledger homes are scratch mkdtemp dirs removed at the end. No model call, $0.
import { mkdtempSync, rmSync, readdirSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPanelServer } from '../../src/panel/server.js';
import { eventsOfRun, seedLedger, readLedger } from '../../src/learnstore.js';

const [, , rootArg, outArg] = process.argv;
if (!rootArg || !outArg) { process.stderr.write('usage: node poc/m8b/snapshot.mjs <flows-root> <out.json>\n'); process.exit(2); }
const ROOT = resolve(rootArg);
const FIXED_NOW = Date.parse('2026-10-24T12:00:00Z');
const scratch = mkdtempSync(join(tmpdir(), 'm8b-snap-'));
const HOME = join(scratch, 'home');
const LEDGER_HOME = join(scratch, 'ledger-home');

// EXCLUSIONS (each with its reason). Nothing else is removed from a view.
//  1. the absolute path of the root and of the scratch dirs  -> '<ROOT>' / '<SCRATCH>': a copy lives in a different temp dir each time.
//  2. the package `version` field of /api/inbox              -> the same package.json both times, but it is read from disk, not from the run folder.
//  3. mtimes: the harness never records a file mtime itself; a field the panel derives from one is compared as the panel shows it (any difference is reported).
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const scrub = (text) => text.replace(new RegExp(esc(ROOT), 'g'), '<ROOT>').replace(new RegExp(esc(scratch), 'g'), '<SCRATCH>');

const h = await createPanelServer({
  port: 0, root: ROOT, settings: { home: HOME }, author: { env: {}, now: () => FIXED_NOW }, scheduler: { intervalMs: 0 },
});
const base = `http://127.0.0.1:${h.port}`;
async function get(path) {
  const res = await fetch(base + path);
  const text = await res.text();
  let body; try { body = JSON.parse(scrub(text)); } catch { body = scrub(text); }
  return { status: res.status, body };
}

const views = {};
views['/api/runs'] = await get('/api/runs');
views['/api/inbox'] = await get('/api/inbox');
if (views['/api/inbox'].body && typeof views['/api/inbox'].body === 'object') delete views['/api/inbox'].body.version; // exclusion 2
views['/api/author/flows'] = await get('/api/author/flows');

const flows = readdirSync(ROOT).filter((f) => { try { return lstatSync(join(ROOT, f, 'runs')).isDirectory(); } catch { return false; } }).sort();
const runs = {};
let count = 0;
for (const flow of flows) {
  for (const runId of readdirSync(join(ROOT, flow, 'runs')).sort()) {
    const runDir = join(ROOT, flow, 'runs', runId);
    if (!lstatSync(runDir).isDirectory()) continue;
    count += 1;
    const q = `flow=${encodeURIComponent(flow)}&runId=${encodeURIComponent(runId)}`;
    const p = `/api/runs/${encodeURIComponent(flow)}/${encodeURIComponent(runId)}`;
    const v = {};
    v.detail = await get(p);
    for (const sub of ['audit', 'job', 'asks', 'result']) v[sub] = await get(`${p}/${sub}`);
    v.resumeForm = await get(`/api/author/resume-form?${q}`);
    v.runAgain = await get(`/api/author/run-again?${q}`);
    let ev = null;
    try { ev = eventsOfRun(runDir, flow); } catch (e) { ev = { threw: String(e?.message ?? e) }; }
    // an event's `ts` comes from the audit rows (kept in the run), so it is compared too
    v.learnEvents = ev && ev.events ? { events: ev.events, questions: [...ev.questions], model: ev.model, source: ev.source } : ev;
    runs[`${flow}/${runId}`] = v;
  }
}
await h.close();

const seed = seedLedger({ root: ROOT, home: LEDGER_HOME });
const ledger = readLedger(LEDGER_HOME);

writeFileSync(outArg, `${JSON.stringify({ runCount: count, views, runs, seed, ledger }, null, 1)}\n`);
rmSync(scratch, { recursive: true, force: true });
process.stdout.write(`snapshot: ${count} runs, ${flows.length} flows -> ${outArg}\n`);
