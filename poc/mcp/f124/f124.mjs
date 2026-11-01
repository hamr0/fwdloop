// F124 ($0, no model, no network, no pass): M13 am3 — can the existing real start path run a NAMED skipped ticket with anyway:true while the schedule is off?
// Pre-registered in docs/logs/FINDINGS.md. Run: timeout 300 node poc/mcp/f124/f124.mjs   (repo root). Exit 0 = every lettered criterion passed.
// Works ONLY on a mkdtemp `cp -a` copy of ~/.config/fwdloop/flows/ticket-triage-5; the original is read, never written. HOME is a mkdtemp dir.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../../../scripts/tmp-track.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ORIGINAL = path.join(process.env.HOME, '.config/fwdloop/flows/ticket-triage-5');
const fakeHome = mkdtempSync(path.join(tmpdir(), 'f124-home-'));
process.env.HOME = fakeHome;

const { world, until, sleep, reapChildren } = await import(path.join(REPO, 'test/m4e-world.mjs'));
const { createStarter } = await import(path.join(REPO, 'src/panel/authorstart.js'));
const { keysForDoor } = await import(path.join(REPO, 'src/keysfile.js'));
const { ledgerOf, readSchedule } = await import(path.join(REPO, 'src/schedule.js'));
const { readRows } = await import(path.join(REPO, 'src/trigger-clock.js'));
const { readHistory } = await import(path.join(REPO, 'src/books.js'));
const { writeModelRecord } = await import(path.join(REPO, 'src/flowmodel.js'));

const LIST = 'https://github.com/hamr0/hol-guard/issues';
const results = [];
const say = (id, pass, line) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${line}`); };
const info = (line) => console.log(`INFO ${line}`);

writeFileSync(path.join(fakeHome, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [path.join(REPO, 'test/fixtures/fake-mcp-issue.mjs')], env: { FAKE_MCP_SERVER: '1', FAKE_ISSUE: JSON.stringify({ number: 15, title: 'fwdloop test: not P1 again', state: 'open', labels: ['P3'] }) } } } }));

let w;
try {
  let clock = Date.now();
  w = await world({ limit: 5, step: path.join(REPO, 'poc/mcp/f124/stub-step.mjs'), extraEnv: { HOME: fakeHome }, authorOpts: { now: () => clock }, scheduler: { intervalMs: 0 } });
  const flow = 'ticket-triage-5';
  const flowDir = path.join(w.root, flow);
  execFileSync('cp', ['-a', ORIGINAL, flowDir]);
  rmSync(path.join(flowDir, 'model.json'), { force: true });
  writeModelRecord(flowDir, { slot: 'DEEPSEEK_API_KEY', model: 'fake-ticked' });   // the COPY only: the world's ticked fake model
  const sc = readSchedule(flowDir);
  const armedRows = () => { const s = readSchedule(flowDir); return s === null ? [] : readRows(ledgerOf(flowDir), s.sig).filter((r) => r.kind === 'armed'); };
  const tick = async () => { clock += 15 * 60_000; w.h.tick(); await sleep(600); };
  const card = async () => { const j = (await w.get('/api/author/flows')).json(); const f = (j?.flows ?? []).find((x) => x.name === flow || x.flow === flow); return f?.trigger ?? f ?? null; };

  // baseline (informational): today's door
  const post = await w.post('/api/author/ticket-anyway', { flow, runId: 'run-1', number: 15, reason: 'F124 baseline' });
  info(`baseline: POST ticket-anyway for #15 -> ${post.status} ${JSON.stringify(post.json()).slice(0, 200)}; armed rows ${armedRows().length}; schedule sig ${sc?.sig?.slice(0, 8)}`);
  await tick();
  info(`baseline card: ${JSON.stringify(await card()).slice(0, 300)}`);

  // the start: the existing real path, by hand, the named ticket, anyway:true
  const starter = createStarter({ root: w.root, bin: path.join(REPO, 'bin/fwdloop') });
  const loaded = keysForDoor({ env: w.env, keysHome: w.home });
  info(`keys load ok=${loaded.ok}`);
  const started = starter.start({ kind: 'run', flow, runId: '', sources: [{ role: 'issues', path: LIST, ticket: 15, anyway: true }] }, loaded);
  info(`start -> ${started.status} ${JSON.stringify(started.body).slice(0, 300)}`);
  const runId = started.body?.runId;
  let rec = null; let hist = null;
  if (started.status === 202 && runId) {
    const runDir = path.join(flowDir, 'runs', runId);
    await until(() => { hist = readHistory(flowDir).find((h) => h.runId === runId); return hist; }, 90_000).catch(() => null);
    try { rec = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf8')); } catch { rec = null; }
    const startDir = path.join(w.root, '.starts');
    for (const d of existsSync(startDir) ? readdirSync(startDir) : []) { try { info(`child.log ${d}: ${readFileSync(path.join(startDir, d, 'child.log'), 'utf8').slice(0, 400)}`); } catch { /* none */ } }
    const inp = rec?.inputs?.[0];
    let shaOk = false; let bytes = 0;
    if (inp?.frozen && existsSync(inp.frozen)) { const b = readFileSync(inp.frozen); bytes = b.length; shaOk = bytes > 0 && createHash('sha256').update(b).digest('hex') === inp.sha256; }
    say('a', started.status === 202 && inp?.ticket?.number === 15 && /^[0-9a-f]{64}$/.test(inp?.sha256 ?? '') && shaOk && inp?.source === `${LIST}/15`,
      `status ${started.status}; ticket ${JSON.stringify(inp?.ticket)}; sha256 ${inp?.sha256?.slice(0, 12)} matches frozen bytes ${shaOk} (${bytes} bytes); source ${inp?.source}`);
    const spendRows = (() => { try { return readFileSync(path.join(runDir, 'spend.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length; } catch { return readdirSync(runDir).filter((f) => /spend/.test(f)).length; } })();
    const f = inp?.filter;
    say('b', JSON.stringify(f) === JSON.stringify({ outcome: 'anyway', was: { outcome: 'skip', reason: 'priority P3, not P1' } }) && hist?.outcome !== 'skipped' && hist !== null && spendRows >= 1,
      `filter ${JSON.stringify(f)}; history outcome ${hist?.outcome}; spend rows ${spendRows}; files ${readdirSync(runDir).join(',')}`);
    await tick(); await tick(); await tick();
    const line2 = async (id) => (await w.get(`/api/runs/${flow}/${id}`)).json()?.summary?.schedule?.line2 ?? null;   // the Run card's own schedule line (F120's reader of waiting/armed)
    const l2 = await line2(runId);
    say('c', armedRows().length === 0 && l2 === 'Schedule waiting for a green run',
      `armed rows ${armedRows().length}; Run card schedule line2 ${JSON.stringify(l2)} (the read(flow) armed/waiting fields are read through this line; /api/author/flows card is ${JSON.stringify(await card())})`);
    appendFileSync(path.join(flowDir, 'history.jsonl'), `${JSON.stringify({ runId, at: new Date(clock).toISOString(), outcome: 'complete', spentUsd: 0.001, spendComplete: true, capUsd: 0.4945, wallMs: 1000, signatureHash: hist.signatureHash })}\n`);
    await tick();
    const rows = armedRows();
    const l2d = await line2(runId);
    say('d', rows.length === 1 && rows[0].ticketN === 15 && l2d !== 'Schedule waiting for a green run', `armed rows ${rows.length}, ticketN ${rows[0]?.ticketN}, line2 ${JSON.stringify(l2d)} (synthetic complete row appended; the existing arming path)`);
  } else {
    say('a', false, `start refused: ${JSON.stringify(started.body).slice(0, 300)}`);
    say('b', false, 'no run'); say('c', false, 'no run'); say('d', false, 'no run');
  }
} catch (e) {
  console.log(`ERROR ${e?.stack ?? e}`);
  for (const id of ['a', 'b', 'c', 'd']) if (!results.find((r) => r.id === id)) say(id, false, `harness error: ${String(e?.message ?? e).slice(0, 200)}`);
} finally {
  try { await w?.h?.close?.(); } catch { /* closed */ }
  try { await reapChildren(); } catch { /* none */ }
  rmSync(fakeHome, { recursive: true, force: true });
  if (w?.work) rmSync(w.work, { recursive: true, force: true });
}
console.log(results.every((r) => r.pass) && results.length === 4 ? 'ALL PASS' : 'NOT ALL PASS');
process.exit(results.every((r) => r.pass) && results.length === 4 ? 0 : 1);
