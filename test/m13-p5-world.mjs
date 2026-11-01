// Shared by the M13 piece 5 tests: a signed Tickets job in a scratch root, its schedule signed OFF through the trigger door (`signSchedule`, what the New job card's sign calls), the real
// scheduler with the real ticket look against the fake MCP server, an injected clock, a stub starter that records the ticket each start reads. Runs are written as files
// (job copy, run.json, history rows) the way test/m9-trigger-world.mjs `seedGreen` does it. $0, no model.
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { loadCatalogue } from '../src/catalogue.js';
import { readFlow, writeRunJobCopy } from '../src/flow.js';
import { ledgerOf, readSchedule } from '../src/schedule.js';
import { readRows } from '../src/trigger-clock.js';
import { readSeen } from '../src/trigger-files.js';
import { createTriggerDoor, readOutcomes } from '../src/panel/authortrigger.js';
import { createScheduler } from '../src/panel/scheduler.js';
import { LIST, ticketJob } from './m12-p2-world.mjs';

export const MIN = 60_000;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const FAKE = path.join(HERE, 'fixtures', 'fake-mcp-server.mjs');
const CAT = loadCatalogue().primitives;
export const T0 = new Date(2026, 10, 2, 8, 0, 0).getTime();
export const newestFirst = (n) => Array.from({ length: n }, (_, i) => ({ number: n - i, state: 'OPEN', labels: [] }));

/** @param {{trigger?: object, listSize?: number}} [o] */
export function p5World({ trigger = { kind: 'new-ticket', role: 'jd', list: LIST, server: 'github', tool: 'list_issues' }, listSize = 5 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p5w-'));
  const root = path.join(dir, 'flows');
  mkdirSync(root);
  ticketJob(root, 'tk');
  const flowDir = path.join(root, 'tk');
  const listFile = path.join(dir, 'list.json');
  const calls = path.join(dir, 'calls.jsonl');
  const config = path.join(dir, 'mcp.json');
  const resume = path.join(dir, 'resume.md');
  writeFileSync(resume, 'resume');
  writeFileSync(listFile, JSON.stringify(newestFirst(listSize)));
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
  const sched = createScheduler({ door, now: () => clock.t, intervalMs: 0, mcpConfig: config });
  const sigHash = () => JSON.parse(readFileSync(path.join(flowDir, 'signature.json'), 'utf8')).flow;
  const w = {
    dir, root, flowDir, clock, starts, door, sched, listFile,
    sign: () => door.signSchedule({ flow: 'tk', flowSignatureHash: sigHash(), trigger, from: null, signedBy: 'hamr' }),
    setList: (n) => writeFileSync(listFile, JSON.stringify(newestFirst(n))),
    lookCalls: () => { try { return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } },
    armed: () => { const sc = readSchedule(flowDir); return sc === null ? [] : readRows(ledgerOf(flowDir), sc.sig).filter((r) => r.kind === 'armed'); },
    seen: (kind) => { const sc = readSchedule(flowDir); return sc === null ? [] : readSeen(ledgerOf(flowDir), sc.sig).filter((r) => r.kind === kind); },
    started: () => readOutcomes(flowDir).filter((r) => r.outcome === 'started').map((r) => r.ticket),
    /** a run written as files; `rows` = [[outcome, atMs], ...]; `mutate` changes the run's job copy afterwards */
    run(runId, { ticket, rows, mutate = false }) {
      const runDir = path.join(flowDir, 'runs', runId);
      const read = readFlow({ root, name: 'tk', catalogue: CAT });
      if (!existsSync(runDir)) {   // a later row of a run already written (a resume that ends) adds only its history row
        mkdirSync(runDir, { recursive: true });
        const c = writeRunJobCopy(flowDir, runDir, read.signature.flow);
        if (!c.ok) throw new Error(c.red);
        if (mutate) appendFileSync(path.join(runDir, 'job', 'prose.txt'), '\n# changed after this run\n');
        writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ inputs: [{ id: 'jd', ...(ticket ? { ticket: { number: ticket } } : {}) }] }));
      }
      for (const [outcome, at] of rows) {
        appendFileSync(path.join(flowDir, 'history.jsonl'), `${JSON.stringify({ runId, at: new Date(at).toISOString(), outcome, spentUsd: 0.01, spendComplete: true, capUsd: 0.25, wallMs: 1000, signatureHash: read.signature.flow })}\n`);
      }
    },
    async tick(adv = 15 * MIN) { clock.t += adv; sched.tick(); await sched.settled(); sched.tick(); await sched.settled(); sched.tick(); },
    async ticks(k, adv) { for (let i = 0; i < k; i++) await w.tick(adv); },
  };
  return w;
}
