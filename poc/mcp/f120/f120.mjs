// F120 ($0, no model, no pass): the schedule on the New job card (M13 item 7) and the ticket cut (F114f). Pre-registered in docs/logs/FINDINGS.md.
// Run: node poc/mcp/f120/f120.mjs   (repo root). Prints PASS/FAIL per criterion. Exit 0 = every criterion passed.
// HOME is a mkdtemp dir (set before any import); the real ~/.mcp.json, ~/.claude.json and ~/.config/fwdloop are never touched.
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../../../scripts/tmp-track.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FAKE = path.join(REPO, 'test/fixtures/fake-mcp-server.mjs');
const REAL_BIN = path.join(REPO, 'bin/fwdloop');
const fakeHome = mkdtempSync(path.join(tmpdir(), 'f120-home-'));
process.env.HOME = fakeHome;

const { world, until, sleep, reapChildren } = await import(path.join(REPO, 'test/m4e-world.mjs'));
const { appendMcpCheck } = await import(path.join(REPO, 'src/mcp-checks.js'));
const { LIST } = await import(path.join(REPO, 'test/m12-p2-world.mjs'));
const { loadCatalogue } = await import(path.join(REPO, 'src/catalogue.js'));
const { readFlow, writeRunJobCopy } = await import(path.join(REPO, 'src/flow.js'));
const { ledgerOf, readSchedule } = await import(path.join(REPO, 'src/schedule.js'));
const { readRows } = await import(path.join(REPO, 'src/trigger-clock.js'));
const { isFwdloopAlive } = await import(path.join(REPO, 'src/liveness.js'));

const CAT = loadCatalogue().primitives;
const MIN = 60_000;
const WAIT_SAY = 'Schedule waiting for a green run';
const results = [];
const say = (id, pass, line) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${line}`); };
const newestFirst = (n) => Array.from({ length: n }, (_, i) => ({ number: n - i, state: 'OPEN', labels: [] }));

/** a stand-in `fwdloop`: a `run` only records its argv to ARGV_FILE; a `draft` is the real thing */
function echoBin(dir) {
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'fwdloop');
  writeFileSync(f, `import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const a = process.argv.slice(2);
if (a[0] === 'run') { appendFileSync(process.env.ARGV_FILE, JSON.stringify(a) + '\\n'); process.exit(0); }
process.exit(spawnSync(process.execPath, [${JSON.stringify(REAL_BIN)}, ...a], { stdio: 'inherit' }).status ?? 1);
`);
  return f;
}

/** a world with a green Tickets draft whose card carries `schedule`, signed through the panel's own sign door */
async function signed(schedule, t0) {
  const clock = { t: t0 };
  const work = mkdtempSync(path.join(tmpdir(), 'f120-'));
  const argv = path.join(work, 'argv.jsonl');
  const listFile = path.join(work, 'list.json');
  writeFileSync(listFile, JSON.stringify(newestFirst(5)));
  writeFileSync(path.join(fakeHome, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { FAKE_MCP_SERVER: '1', FAKE_LIST: listFile, FAKE_CALLS: path.join(work, 'calls.jsonl') } } } }));
  const w = await world({
    limit: 5, bin: echoBin(work), extraEnv: { FWDLOOP_TEST_DRAFT_TICKET: '1', ARGV_FILE: argv, HOME: fakeHome }, authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 },
  });
  appendMcpCheck(w.home, { server: 'github', path: '~/.mcp.json', at: '2026-10-31T10:00:00Z', ok: true, tools: ['issue_read', 'list_issues'].map((name) => ({ name, hint: null })) });
  const card = w.card({ inputs: `resume: ${path.join(w.inDir, 'resume.md')}\njd: ${LIST}`, flowType: 'tickets', mcp: 'github', ...(schedule ? { schedule } : {}) });
  const d = await w.post('/api/author/draft', card);
  const id = d.json()?.draftId;
  if (!id) return { w, clock, refused: d.text, argv, listFile, work };
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  const pid = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8'));
  await until(() => isFwdloopAlive(pid.pid, pid.procStart) !== true);
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  const flowDir = path.join(w.root, 'job2');
  const o = {
    w, clock, g, s, flowDir, argv, listFile, work,
    schedule: () => readSchedule(flowDir),
    scheduleFile: () => existsSync(path.join(flowDir, 'schedule.json')),
    armed: () => { const sc = readSchedule(flowDir); return sc === null ? [] : readRows(ledgerOf(flowDir), sc.sig).filter((r) => r.kind === 'armed'); },
    setList: (n) => writeFileSync(listFile, JSON.stringify(newestFirst(n))),
    lookCalls: () => { try { return readFileSync(path.join(work, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } },
    tickets: () => (existsSync(argv) ? readFileSync(argv, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.includes('--ticket')).map((a) => a[a.indexOf('--ticket') + 1]) : []),
    tick: async (adv = 15 * MIN) => { clock.t += adv; w.h.tick(); await sleep(900); w.h.tick(); await sleep(900); w.h.tick(); await sleep(300); },
    /** a run written as files: its own job copy, run.json (the ticket it read), one history row per entry of `rows` ([outcome, at]) */
    run(runId, { ticket, rows, mutate = false }) {
      const runDir = path.join(flowDir, 'runs', runId);
      mkdirSync(runDir, { recursive: true });
      const read = readFlow({ root: w.root, name: 'job2', catalogue: CAT });
      const c = writeRunJobCopy(flowDir, runDir, read.signature.flow);
      if (!c.ok) throw new Error(c.red);
      if (mutate) appendFileSync(path.join(runDir, 'job', 'prose.txt'), '\n# changed after this run\n');
      writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ inputs: [{ id: 'resume', source: path.join(w.inDir, 'resume.md') }, { id: 'jd', source: LIST, ...(ticket ? { ticket: { number: ticket } } : {}) }] }));
      for (const [outcome, at] of rows) {
        appendFileSync(path.join(flowDir, 'history.jsonl'), `${JSON.stringify({ runId, at: new Date(at).toISOString(), outcome, spentUsd: 0.01, spendComplete: true, capUsd: 0.25, wallMs: 1000, signatureHash: read.signature.flow })}\n`);
      }
    },
    line2: async (runId) => (await w.get(`/api/runs/job2/${runId}`)).json()?.summary?.schedule?.line2 ?? null,
  };
  return o;
}

const T0 = Date.now();

// (a)
{
  const o = await signed({ kind: 'new-ticket' }, T0);
  const sc = o.schedule && o.schedule();
  const okSign = o.s?.status === 202;
  await o.tick?.(); await o.tick?.(); await o.tick?.();
  say('a', !!o.refused === false && okSign && sc !== null && sc?.trigger?.kind === 'new-ticket' && sc.trigger.list === LIST && sc.trigger.server === 'github' && sc.trigger.tool === 'list_issues' && o.armed().length === 0 && o.lookCalls() === 0,
    `${o.refused ? `draft refused: ${o.refused.slice(0, 120)}` : `sign ${o.s?.status}; schedule.json ${o.scheduleFile?.()} trigger ${JSON.stringify(sc?.trigger ?? null).slice(0, 140)}; armed rows ${o.armed?.().length}; look calls ${o.lookCalls?.()}`}`);
}
// (b) and (c) in one world: red, cap-halt, then green
{
  const o = await signed({ kind: 'new-ticket' }, T0);
  if (o.refused) { say('b', false, `draft refused: ${o.refused.slice(0, 120)}`); say('c', false, 'no world'); } else {
    o.run('first-a', { ticket: 5, rows: [['not-done', o.clock.t]] });
    await o.tick(); await o.tick(); await o.tick();
    o.run('first-b', { ticket: 5, rows: [['cap-halt', o.clock.t]] });
    await o.tick(); await o.tick(); await o.tick();
    const wait1 = await o.line2('first-a');
    say('b', o.armed().length === 0 && o.tickets().length === 0 && o.lookCalls() === 0 && wait1 === WAIT_SAY, `after not-done and cap-halt: armed rows ${o.armed().length}, fires ${o.tickets().length}, look calls ${o.lookCalls()}, Run card line2 ${JSON.stringify(wait1)}`);
    o.run('first-c', { ticket: 5, rows: [['complete', o.clock.t]] });
    await o.tick();
    const armed1 = o.armed().length;
    await o.tick(); await o.tick(); await o.tick(); await o.tick();
    const wait2 = await o.line2('first-c');
    say('c', armed1 === 1 && o.armed().length === 1 && wait2 !== WAIT_SAY, `after a complete run: armed rows ${armed1} after the next tick, ${o.armed().length} after 4 more; Run card line2 ${JSON.stringify(wait2)}`);
  }
}
// (d) the F114f timing
async function timing(withTicket) {
  const o = await signed({ kind: 'new-ticket' }, T0);
  if (o.refused) return { o, refused: o.refused };
  const t0 = o.clock.t;
  o.run('first-a', { ticket: withTicket ? 5 : undefined, rows: [['not-done', t0 + 5 * MIN]] });   // the first run read #5 at T0; red at T0+5
  o.clock.t = t0 + 10 * MIN; o.setList(6);                                                         // #6 arrives at T0+10, before the turn-on
  await o.tick(0); await o.tick(5 * MIN);
  o.clock.t = t0 + 30 * MIN;
  appendFileSync(path.join(o.flowDir, 'history.jsonl'), `${JSON.stringify({ runId: 'first-a', at: new Date(o.clock.t).toISOString(), outcome: 'complete', spentUsd: 0.01, spendComplete: true, capUsd: 0.25, wallMs: 1000, signatureHash: JSON.parse(readFileSync(path.join(o.flowDir, 'signature.json'), 'utf8')).flow })}\n`);   // the resume ended green
  await o.tick(0); await o.tick(); await o.tick(); await o.tick(); await o.tick();
  return { o };
}
{
  const { o, refused } = await timing(true);
  if (refused) say('d', false, `draft refused: ${refused.slice(0, 120)}`); else {
    const t = o.tickets();
    say('d', t.filter((x) => x === '6').length === 1 && t.every((x) => x === '6'), `stub bin --ticket values [${t}] (needs exactly ["6"]); armed rows ${o.armed().length}`);
  }
}
// (e) a daily card
{
  const day = new Date(); day.setHours(8, 0, 0, 0);
  const o = await signed({ kind: 'daily', hour: 9, minute: 0 }, day.getTime());
  if (o.refused) say('e', false, `draft refused: ${o.refused.slice(0, 120)}`); else {
    const sc = o.schedule();
    await o.tick(65 * MIN);                                  // 09:05, no green run yet
    const early = o.tickets().length + (existsSync(o.argv) ? readFileSync(o.argv, 'utf8').trim().split('\n').filter((l) => l.includes('"trigger"')).length : 0);
    const argvRuns = () => (existsSync(o.argv) ? readFileSync(o.argv, 'utf8').trim().split('\n').filter(Boolean).length : 0);
    const before = argvRuns();                               // the sign's own first run is already one line
    o.run('first-a', { rows: [['complete', o.clock.t]] });
    await o.tick(5 * MIN);                                   // 09:10 arms
    const armed = o.armed().length;
    await o.tick(24 * 60 * MIN);                             // next day 09:10: the 09:00 slot is due
    const fires = argvRuns() - before;
    say('e', sc !== null && sc.trigger.kind === 'daily' && sc.trigger.hour === 9 && sc.trigger.minute === 0 && early === 0 && armed === 1 && fires === 1,
      `trigger ${JSON.stringify(sc?.trigger ?? null)}; fires before a green run ${early}; armed rows ${armed}; scheduled starts after the turn-on ${fires}`);
  }
}
// (f1) a complete row whose job copy differs
{
  const o = await signed({ kind: 'new-ticket' }, T0);
  if (o.refused) say('f1', false, `draft refused: ${o.refused.slice(0, 120)}`); else {
    o.run('first-a', { ticket: 5, rows: [['complete', o.clock.t]], mutate: true });
    for (let i = 0; i < 5; i++) await o.tick(); // eslint-disable-line no-await-in-loop
    say('f1', o.scheduleFile() && o.armed().length === 0, `job copy changed: schedule.json ${o.scheduleFile()}, armed rows ${o.armed().length} after 5 ticks (needs file present, 0 armed)`);
  }
}
// (f2) no ticket number on the first run
{
  const { o, refused } = await timing(false);
  if (refused) say('f2', false, `draft refused: ${refused.slice(0, 120)}`); else {
    const t = o.tickets();
    say('f2', o.scheduleFile() && t.length === 0, `first run holds no ticket number: stub bin --ticket values [${t}] (needs none: #6 baselined, never ran); armed rows ${o.armed().length}`);
  }
}
await reapChildren();
rmSync(fakeHome, { recursive: true, force: true });
console.log(`SUMMARY ${results.map((r) => `${r.id}=${r.pass ? 'PASS' : 'FAIL'}`).join(' ')}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
