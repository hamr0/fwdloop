// Shared by the launcher tests (M4b am4/am5). Scratch dirs only (removed at exit by scripts/tmp-track.mjs), a free port range below the kernel's ephemeral range (never 4800-4809),
// fake panels that answer /api/whoami, a real in-process panel for the probe, and a signed job whose run is parked at its ask (the runs line has
// something to count). Nothing here touches the real HOME, ~/.config/fwdloop, or a real panel.
import {
  mkdirSync, readFileSync, writeFileSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as netServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { readOwnVersion } from '../src/version.js';

export const V = readOwnVersion() ?? 'unknown';
export const VRE = V.replace(/\./g, '\\.');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAT = loadCatalogue().primitives;
export const scratch = (p = 'launcher') => mkdtempSync(path.join(tmpdir(), `fwdloop-${p}-`));

/** @type {(() => Promise<void>)[]} */
export const closers = [];
export async function closeAll() {
  for (const c of closers.splice(0)) { try { await c(); } catch { /* already closed */ } }
}

/** @param {number} port @returns {Promise<boolean>} */
const bindable = (port) => new Promise((res) => { const s = netServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => s.close(() => res(true))); });
/** a base such that base..base+3 are free. Picked below the kernel's ephemeral range (32768-60999) so no other test's outgoing socket or listen(0) can be handed the port between this check and the start; never the panel's own 4800-4809. Copied from bareloop tests/launcher-commands.test.js@v0.48.0 (f1819ca). */
export async function freeBase() {
  for (let i = 0; i < 200; i += 1) {
    const base = 20000 + Math.floor(Math.random() * 12000);
    const all = await Promise.all([0, 1, 2, 3].map((k) => bindable(base + k)));
    if (all.every(Boolean)) return base;
  }
  throw new Error('no free port range');
}
/** hold a port with something that is NOT fwdloop */
export function squat(port) {
  return new Promise((resolve) => {
    const s = httpServer((_q, r) => { r.writeHead(200); r.end('hello'); });
    s.listen(port, '127.0.0.1', () => { const close = () => new Promise((r) => { s.close(() => r(undefined)); }); closers.push(close); resolve(close); });
  });
}
/** a fake fwdloop panel (just /api/whoami) with settable pid/drafts/schedules; returns {port, close} */
export function fakePanel(port, body = {}) {
  return new Promise((resolve) => {
    const s = httpServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ app: 'fwdloop', version: V, pid: 4242, port, drafts: 0, schedules: 0, ...body }));
    });
    s.listen(port, '127.0.0.1', () => { const close = () => new Promise((r) => { s.close(() => r(undefined)); }); closers.push(close); resolve({ port, close }); });
  });
}
/** a server on `port` that takes the connection and never answers (a panel too loaded to reply, or a stuck one) */
export function silentServer(port) {
  return new Promise((resolve) => {
    const socks = new Set();
    const s = httpServer(() => { /* never answers */ });
    s.on('connection', (c) => { socks.add(c); c.on('close', () => socks.delete(c)); });
    s.listen(port, '127.0.0.1', () => {
      const close = () => new Promise((r) => { for (const c of socks) c.destroy(); s.close(() => r(undefined)); });
      closers.push(close);
      resolve(close);
    });
  });
}
/** a config home with the three things "installed" needs (folder 700, config.json, .env 600) */
export function installedHome() {
  const home = path.join(scratch(), 'fl');
  mkdirSync(home, { mode: 0o700 });
  writeFileSync(path.join(home, 'config.json'), '{}');
  writeFileSync(path.join(home, '.env'), '', { mode: 0o600 });
  chmodSync(path.join(home, '.env'), 0o600);
  return home;
}

const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
/**
 * A flows root with ONE signed job (`job2`) whose first run is parked at its ask: the runs list reads it as waiting on you (Needs you: Answer).
 * Same world as test/m11-a-server.test.js `parkedRun` (a fake model step, $0).
 * @returns {Promise<{root: string}>}
 */
export async function parkedRoot() {
  const base = scratch('launcher-run');
  const root = path.join(base, 'flows'); const dest = path.join(base, 'dest'); const src = path.join(base, 'src');
  for (const d of [root, dest, src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${dest}`);
  const decl = JSON.parse(fixture('job2.m1.declaration.json'));
  const r = writeFlow({
    root, name: 'job2', proseText: prose, declaration: decl, signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT,
  });
  if (!r.ok) throw new Error(r.reds.join('\n'));
  const modelStep = async (ctx) => {
    const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
    return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
  };
  const run = await runFlow({
    root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(),
    sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }],
  });
  if (run.outcome !== 'paused') throw new Error(`world did not park: ${run.outcome} ${run.red}`);
  return { root };
}
