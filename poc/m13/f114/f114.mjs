// F114: a schedule that waits for a green run, and the ticket starting point (M13 items 6, 7). $0, no model, no network, no src edit.
// Run: node poc/m13/f114/f114.mjs   (from the repo root). Prints PASS/FAIL per criterion with one line of evidence.
// The ONLY new logic is `armHook` below (the arm hook). Everything else is the real src modules.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../../../src/catalogue.js';
import { readFlow, writeRunJobCopy } from '../../../src/flow.js';
import { ledgerOf, readSchedule, writeSchedule, sigOf, isArmed } from '../../../src/schedule.js';
import { triggerHash } from '../../../src/trigger-line.js';
import { readRows } from '../../../src/trigger-clock.js';
import { readSeen } from '../../../src/trigger-files.js';
import { lookTickets } from '../../../src/trigger-tickets.js';
import { createTriggerDoor, armFor, hasGreenRunForJob, readOutcomes } from '../../../src/panel/authortrigger.js';
import { createScheduler } from '../../../src/panel/scheduler.js';
import { ticketJob, LIST } from '../../../test/m12-p2-world.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FAKE = path.join(REPO, 'test/fixtures/fake-mcp-server.mjs');
const CAT = loadCatalogue().primitives;
const MIN = 60_000;
const T0 = new Date(2026, 9, 13, 8, 0, 0).getTime();
const issue = (n) => ({ number: n, state: 'OPEN', labels: [] });
const newestFirst = (n) => Array.from({ length: n }, (_, i) => issue(n - i));
const results = [];
const roots = [];
const say = (id, pass, line) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${line}`); };

/** hook modes: 'real' = hasGreenRunForJob; 'off' = never arms; 'lax' = any `complete` history row (job copy check bypassed) */
function laxGreen(flowDir) {
  try { return readFileSync(path.join(flowDir, 'history.jsonl'), 'utf8').split('\n').filter(Boolean).some((l) => JSON.parse(l).outcome === 'complete'); } catch { return false; }
}

function world({ hook = 'real', lookWrap = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'f114-'));
  roots.push(dir);
  const root = path.join(dir, 'flows'); mkdirSync(root);
  ticketJob(root, 'tk');
  const flowDir = path.join(root, 'tk');
  const listFile = path.join(dir, 'list.json'); const calls = path.join(dir, 'calls.jsonl'); const config = path.join(dir, 'mcp.json');
  const resume = path.join(dir, 'resume.md'); writeFileSync(resume, 'resume');
  writeFileSync(listFile, JSON.stringify(newestFirst(5)));
  writeFileSync(config, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { FAKE_MCP_SERVER: '1', FAKE_LIST: listFile, FAKE_CALLS: calls } } } }));
  const clock = { t: T0 };
  const starts = [];
  const door = createTriggerDoor({
    root,
    flowsDoor: { scheduleBusy: () => null, lastSourcesOf: () => ({ sources: { resume } }), editBlock: () => null },
    starter: { canStart: () => null, start: (req) => { starts.push(req.sources.find((s) => s.ticket !== undefined)?.ticket ?? null); return { status: 202, body: { runId: `run-s${starts.length}`, startId: `s${starts.length}` } }; } },
    loadEnv: () => ({ ok: true, env: {}, keyNames: [] }),
    monthlyClaim: () => null, modelRefusal: () => [], now: () => clock.t,
  });
  const s = createScheduler({ door, now: () => clock.t, intervalMs: 0, mcpConfig: config, ...(lookWrap ? { look: lookWrap } : {}) });
  const w = {
    dir, root, flowDir, clock, starts, door, listFile,
    setList: (n) => writeFileSync(listFile, JSON.stringify(newestFirst(n))),
    lookCalls: () => { try { return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } },
    armed: () => { const sc = readSchedule(flowDir); return sc === null ? [] : readRows(ledgerOf(flowDir), sc.sig).filter((r) => r.kind === 'armed'); },
    seen: (kind) => { const sc = readSchedule(flowDir); return sc === null ? [] : readSeen(ledgerOf(flowDir), sc.sig).filter((r) => r.kind === kind); },
    armCalls: 0,
  };
  /** the signed-but-not-armed schedule: written directly (narrowest bypass of the `no-green-run` refusal, authortrigger.js:192); no armed row, no baseline */
  w.sign = () => {
    const sigFile = JSON.parse(readFileSync(path.join(flowDir, 'signature.json'), 'utf8'));
    const base = { flow: 'tk', flowSignatureHash: sigFile.flow, trigger: { kind: 'new-ticket', role: 'jd', list: LIST, server: 'github', tool: 'list_issues' }, model: null, destination: null, inputs: null, plan: null };
    const bound = triggerHash(base);
    writeSchedule(flowDir, { v: 1, ...base, bound, sig: sigOf(bound, new Date(clock.t).toISOString()), signedBy: 'hamr', signedAt: new Date(clock.t).toISOString(), from: null });
  };
  /** a run written the way seedGreen does: its own job copy + one history row; `mutate` changes the run's job/ copy afterwards */
  let n = 0;
  w.run = (outcome, { mutate = false } = {}) => {
    const runId = `run-${++n}`; const runDir = path.join(flowDir, 'runs', runId); mkdirSync(runDir, { recursive: true });
    const read = readFlow({ root, name: 'tk', catalogue: CAT });
    const c = writeRunJobCopy(flowDir, runDir, read.signature.flow); if (!c.ok) throw new Error(c.red);
    if (mutate) appendFileSync(path.join(runDir, 'job', 'prose.txt'), '\n# changed after this run\n');
    writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ inputs: [] }));
    appendFileSync(path.join(flowDir, 'history.jsonl'), `${JSON.stringify({ runId, at: new Date(clock.t).toISOString(), outcome, spentUsd: 0.01, spendComplete: true, capUsd: 0.25, wallMs: 1000, signatureHash: read.signature.flow })}\n`);
  };
  /** THE NEW CODE (the arm hook): for a signed-but-not-armed schedule whose job has a green run, call armFor once. */
  const armHook = () => {
    if (hook === 'off') return;
    const sc = readSchedule(flowDir);
    if (sc === null || isArmed(flowDir, sc.sig)) return;
    const green = hook === 'lax' ? laxGreen(flowDir) : hasGreenRunForJob(flowDir);
    if (!green) return;
    w.armCalls++;
    armFor(flowDir, sc, clock.t);
  };
  w.tick = async (adv = 15 * MIN) => { clock.t += adv; armHook(); s.tick(); await s.settled(); s.tick(); await s.settled(); s.tick(); };
  w.ticks = async (k, adv) => { for (let i = 0; i < k; i++) await w.tick(adv); };
  w.started = () => readOutcomes(flowDir).filter((r) => r.outcome === 'started').map((r) => r.ticket);
  return w;
}

// (a)
{
  const w = world(); w.sign();
  await w.ticks(5);
  say('a', w.starts.length === 0 && w.armed().length === 0 && w.lookCalls() === 0, `5 ticks: fires ${w.starts.length}, armed rows ${w.armed().length}, look calls ${w.lookCalls()}, armFor calls ${w.armCalls}`);
}
// (b), (c), (e) in one world
let c;
{
  const w = world(); w.sign();
  w.run('not-done'); await w.ticks(3);
  const b1 = [w.starts.length, w.armed().length];
  w.run('cap-halt'); await w.ticks(3);
  const b2 = [w.starts.length, w.armed().length];
  say('b', b1.join() === '0,0' && b2.join() === '0,0', `after not-done: fires ${b1[0]} armed ${b1[1]}; after cap-halt: fires ${b2[0]} armed ${b2[1]}; look calls ${w.lookCalls()}`);
  w.run('complete'); await w.tick();
  const c1 = w.armed().length; const callsAfterFirst = w.armCalls;
  await w.ticks(4);
  c = { armed1: c1, armed2: w.armed().length, armCalls: w.armCalls, base: w.seen('baseline').map((r) => r.number).sort((x, y) => x - y), fires: w.starts.length, callsAfterFirst };
  say('c', c.armed1 === 1 && c.armed2 === 1 && c.armCalls === 1 && c.fires === 0, `armed rows after next tick ${c.armed1}, after 4 more ticks ${c.armed2}, armFor calls ${c.armCalls}; first look baselined [${c.base}], fires ${c.fires}`);
  w.setList(6); await w.tick(); await w.ticks(4);
  say('e', w.starts.join() === '6' && w.started().join() === '6', `queued after arming: stub starts [${w.starts}], triggers.jsonl started rows for tickets [${w.started()}]`);
}
// (d)
{
  const w = world(); w.sign();
  w.run('complete', { mutate: true });
  const realGreen = hasGreenRunForJob(w.flowDir);
  await w.ticks(5);
  say('d', !realGreen && w.armed().length === 0 && w.starts.length === 0, `hasGreenRunForJob ${realGreen}; 5 ticks: armed rows ${w.armed().length}, fires ${w.starts.length}`);
}
// (g1) hook disabled: (c) must go red
{
  const w = world({ hook: 'off' }); w.sign(); w.run('complete'); await w.ticks(5);
  const red = w.armed().length !== 1;
  say('g1', red, `hook off: (c) would read armed rows ${w.armed().length} (needs exactly 1) -> (c) is ${red ? 'RED' : 'still green (check cannot fail)'}`);
}
// (g2) job-copy check bypassed: (d) must go red
{
  const w = world({ hook: 'lax' }); w.sign(); w.run('complete', { mutate: true }); await w.ticks(5);
  const red = w.armed().length !== 0;
  say('g2', red, `job/ copy check bypassed: (d) would read armed rows ${w.armed().length} (needs 0) -> (d) is ${red ? 'RED' : 'still green (check cannot fail)'}`);
}
// (f) item 6 timing on today's baseline logic; (f2) counterfactual with the first look cut at the number read at T0
async function timing(lookWrap) {
  const w = world({ lookWrap }); w.sign();
  const t0 = w.clock.t; const n0 = 5;               // first run starts at T0 and reads the newest ticket, #5 (= A). Not recorded anywhere in src today.
  w.run('not-done');                                // (the first run is red first, as item 7 waits through red)
  w.clock.t = t0 + 10 * MIN; w.setList(6);          // #B = #6 arrives after T0, before the arm
  await w.ticks(2, 5 * MIN);                        // red run, schedule not armed: nothing looks
  w.clock.t = t0 + 30 * MIN; w.run('complete');     // the green happens later
  await w.tick(0); await w.ticks(5);
  return { w, t0, n0 };
}
{
  const { w, t0 } = await timing(null);
  const base = w.seen('baseline').map((r) => r.number).sort((x, y) => x - y);
  const armedAt = w.armed()[0]?.at;
  const a = w.starts.includes(5), b = w.starts.filter((x) => x === 6).length;
  say('f', !a && b === 1, `T0 ${new Date(t0).toISOString()}; armed at ${armedAt ? new Date(armedAt).toISOString() : 'never'}; baseline rows [${base}] written at the first look after the arm; fires [${w.starts}]; #A(5) ran ${a}, #B(6) ran ${b}x -> #B was baselined, never ran (expected FAIL on today's code)`);
}
{
  const N0 = 5;
  let firstDone = false;
  const cut = async (o) => {
    const r = await lookTickets(o);
    if (r.ok && r.first && !firstDone) { firstDone = true; return { ...r, found: r.found.filter((t) => t.number <= N0) }; }
    return r;
  };
  const { w } = await timing(cut);
  const a = w.starts.includes(5), b = w.starts.filter((x) => x === 6).length;
  say('f2', !a && b === 1, `counterfactual (wrapper, not src): first look keeps only number <= ${N0}; baseline [${w.seen('baseline').map((r) => r.number).sort((x, y) => x - y)}]; fires [${w.starts}]; #A ran ${a}, #B ran ${b}x`);
}
for (const d of roots) rmSync(d, { recursive: true, force: true });
console.log(`SUMMARY ${results.map((r) => `${r.id}=${r.pass ? 'PASS' : 'FAIL'}`).join(' ')}`);
