// borrowed-from: bareloop src/launcher.js@v0.47.1 (704d598)
// Adaptations: fwdloop name, app and ports (4800..4809, not 4700); config home ~/.config/fwdloop (src/config.js) and the node >= 22 check; the run counts read fwdloop's
// `listRuns` rows (`live`, `needs`: the two reads the panel page makes) through `runsListForCount`, no schedules-gave-up part (fwdloop has none); the header version is
// `readOwnVersion`; `start` spawns through src/panel/spawn.js `spawnDetached` (detached = its own session, log opened 0600 and appended) with `--root <flows folder>`;
// install creates the keys file with `createKeysFile`; the silent-port words are M4b am5 item 3's (bareloop 6d10023, unreleased); `launcherMain` is the entry bin/fwdloop calls
// (bareloop's runLauncher in cli.js). M4b am4 + am5.
//
// M4b am4/am5 (bareloop PANEL-BUILD.md addendum 2026-10-24, L) - the `fwdloop` launcher: the bare-`fwdloop` menu and `fwdloop start | stop | restart | status | install`.
//
// No pid file: the panel is FOUND by asking the panel ports 4800..4809 for `GET /api/whoami` (src/panel/server.js), several at once, 2000 ms
// each; a reply with `app === "fwdloop"` is a panel. Every call prints the same two header lines first, from {@link buildHeader}.
// The run counts are the panel's own (`runsListForCount`: the `listRuns` rows' `live` and `needs`, the two reads the page makes for Running now and Needs you) — never a second spelling of "running" or "needs you".
// This file owns no arbiter state: it starts/stops the panel process and reads the run list at $0. Every OS touch (spawn, kill, open,
// port bind, clock, stdin) comes through `deps` so tests inject all of them and never see a real panel.

import {
  existsSync, statSync, mkdirSync, chmodSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { openAsker } from './prompts.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, updateConfig, configPath, defaultFlowsRoot, ConfigError } from './config.js';
import { keysHome, keysFilePath, createKeysFile } from './keysfile.js';
import { openInOs } from './opener.js';
import { PLAIN, makePaint } from './tty-colour.js';
import { readOwnVersion } from './version.js';
import { spawnDetached } from './panel/spawn.js';
import { runsListForCount, panelUrl } from './panel/server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** the first port tried, and how many in a row (4800..4809) */
export const PORT_START = 4800;
export const PORT_COUNT = 10;
const PROBE_TIMEOUT_MS = 2000;
const WAIT_DEADLINE_MS = 10_000;
/** how long `start` keeps asking a TAKEN port that stays silent before it refuses to open another panel next to it */
const SILENT_PORT_WAIT_MS = 10_000;
const POLL_MS = 100;
const MIN_NODE_MAJOR = 22;
const RULE_WIDTH = 56;

/**
 * @typedef {object} Panel one answered probe
 * @property {number} port @property {number} pid @property {string} version @property {number} drafts @property {number} schedules @property {string} [startedAt] ISO, absent on an older panel
 * @property {string} url
 */

/**
 * @typedef {object} LauncherDeps every OS touch, injectable (a test passes all of them)
 * @property {string} [home] the fwdloop config home (`~/.config/fwdloop`, src/config.js `configHome`); undefined = the real one
 * @property {string} [root] the flows folder the runs line reads and `start` hands the panel (`--root`); default `<config home>/flows` (`defaultFlowsRoot`)
 * @property {number} [portStart] @property {number} [portCount]
 * @property {number[]} [ports] an explicit port list (tests); wins over portStart/portCount
 * @property {number} [timeoutMs] probe timeout per port
 * @property {number} [deadlineMs] start/stop wait deadline
 * @property {number} [silentWaitMs] how long start keeps asking a taken, silent port (default 10 s)
 * @property {string} [nodeVersion] default process.versions.node
 * @property {typeof fetch} [fetchImpl]
 * @property {(a: {bin: string, argv: string[], env: Record<string, string|undefined>, logPath: string}) => any} [spawnFn] default src/panel/spawn.js `spawnDetached`
 * @property {(pid: number, sig: string|number) => void} [kill] default process.kill
 * @property {((target: string) => Promise<boolean>)} [open] default the shared OS opener
 * @property {(port: number) => Promise<boolean>} [portFree] default: try to bind 127.0.0.1:port
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {(question: string) => Promise<string>} [ask] the y/N and menu reader
 * @property {string} [fwdloopBin] default bin/fwdloop of this package
 * @property {import('./tty-colour.js').Paint} [paint] colour for stdout lines (default none); {@link makePaint} decides TTY / NO_COLOR / TERM
 * @property {import('./tty-colour.js').Paint} [paintErr] colour for stderr lines (default: `paint`)
 * @property {number} [now] ms clock for the run list's 7-day rule (default: real time); tests pass their own
 * @property {Record<string, string|undefined>} [env] raw env handed to the panel child (default process.env)
 */

/**
 * The run counts, from the panel's own `listRuns` rows - the SAME two reads the page makes (src/panel/index.html: Running now = `live === true`,
 * Needs you = a non-empty `needs`, the tag `needsYouOf` decides, M11 included). A flow with no runs yet (`runId` null) is not a run. A part that is 0 still shows.
 * @param {any[]} rows
 * @returns {{running: number, needYou: number, total: number}}
 */
export function countRuns(rows) {
  let running = 0;
  let needYou = 0;
  let total = 0;
  for (const r of rows) {
    if (!r || r.runId === null || r.runId === undefined) continue;
    total += 1;
    if (r.live === true) running += 1;
    if (typeof r.needs === 'string' && r.needs !== '') needYou += 1;
  }
  return { running, needYou, total };
}

/**
 * "installed ✓" = the folder exists, config.json is there and reads with no problem, `.env` exists with mode 600, node >= 22.
 * Otherwise the FIRST missing thing in plain words.
 * @param {{home?: string, nodeVersion?: string}} o
 * @returns {{ok: boolean, problem: string|null}}
 */
export function installState(o) {
  const dir = keysHome(o.home);
  if (!existsSync(dir)) return { ok: false, problem: 'no fwdloop folder yet' };
  if (!existsSync(configPath(o.home))) return { ok: false, problem: 'no settings file yet' };
  try { readConfig({ home: o.home }); } catch { return { ok: false, problem: 'config.json cannot be read' }; }
  const env = keysFilePath(o.home);
  if (!existsSync(env)) return { ok: false, problem: 'no keys file yet' };
  try {
    if ((statSync(env).mode & 0o077) !== 0) return { ok: false, problem: 'the keys file is readable by other users' };
  } catch { return { ok: false, problem: 'the keys file cannot be read' }; }
  const major = Number((o.nodeVersion ?? process.versions.node).split('.')[0]);
  if (!(major >= MIN_NODE_MAJOR)) return { ok: false, problem: `node ${MIN_NODE_MAJOR} or newer is needed` };
  return { ok: true, problem: null };
}

/**
 * Ask one port for `/api/whoami`. Never throws. `silent` = no reply inside the timeout (a loaded or stuck process may still be a
 * panel); `other` = something replied (or refused) and it is not a fwdloop whoami.
 * @param {{port: number, timeoutMs?: number, fetchImpl?: typeof fetch}} o
 * @returns {Promise<{state: 'panel', panel: Panel}|{state: 'other'}|{state: 'silent'}>}
 */
export async function probePort(o) {
  const f = o.fetchImpl ?? fetch;
  const ms = o.timeoutMs ?? PROBE_TIMEOUT_MS;
  const port = o.port;
  try {
    const res = await f(`${panelUrl(port)}/api/whoami`, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return { state: 'other' };
    const j = /** @type {any} */ (await res.json());
    if (!j || j.app !== 'fwdloop') return { state: 'other' };
    return {
      state: 'panel',
      panel: {
        port,
        pid: Number(j.pid),
        version: String(j.version ?? ''),
        drafts: Number(j.drafts) || 0,
        schedules: Number(j.schedules) || 0,
        ...(typeof j.startedAt === 'string' && j.startedAt !== '' ? { startedAt: j.startedAt } : {}),
        url: panelUrl(port),
      },
    };
  } catch (e) {
    const name = /** @type {any} */ (e)?.name;
    return name === 'TimeoutError' || name === 'AbortError' ? { state: 'silent' } : { state: 'other' };
  }
}

/**
 * Ask 127.0.0.1 across the ports in parallel; a reply with `app === "fwdloop"` is a panel. Never throws.
 * @param {{ports: number[], timeoutMs?: number, fetchImpl?: typeof fetch}} o
 * @returns {Promise<Panel[]>} in port order
 */
export async function probePanels(o) {
  const answers = await Promise.all(o.ports.map((port) => probePort({ port, timeoutMs: o.timeoutMs, fetchImpl: o.fetchImpl })));
  return /** @type {Panel[]} */ (answers.flatMap((a) => (a.state === 'panel' ? [a.panel] : [])));
}

/**
 * The panel's own date style (src/panel/index.html rlShortDate): local `MM/DD HH:MM`; an unparseable stamp is shown raw, never blank.
 * @param {string} iso
 */
export function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const t = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${t(d.getMonth() + 1)}/${t(d.getDate())} ${t(d.getHours())}:${t(d.getMinutes())}`;
}

/** @param {LauncherDeps} d @returns {number[]} */
function portsOf(d) {
  if (d.ports) return d.ports;
  const start = d.portStart ?? PORT_START;
  return Array.from({ length: d.portCount ?? PORT_COUNT }, (_, i) => start + i);
}

/** @param {LauncherDeps} d @returns {Promise<Panel[]>} */
function probeAll(d) {
  return probePanels({ ports: portsOf(d), timeoutMs: d.timeoutMs, fetchImpl: d.fetchImpl });
}

/**
 * The header, ONCE per call: the two lines every `fwdloop` command prints first, plus the panels the probe found (the commands
 * reuse them, so nothing is probed twice).
 * @param {LauncherDeps & {version?: string}} d
 * @returns {Promise<{lines: string[], panels: Panel[]}>}
 */
export async function buildHeader(d) {
  const version = d.version ?? readOwnVersion() ?? 'unknown';
  const panels = await probeAll(d);
  const inst = installState({ home: d.home, nodeVersion: d.nodeVersion });
  const P = d.paint ?? PLAIN;
  const sep = P.grey(' · ');
  const where = panels.length === 0
    ? `panel ${P.grey('not running')}`
    : `panel${panels.length > 1 ? 's' : ''} ${P.green('running')} at ${panels.map((p) => P.cyan(p.url) + (p.startedAt ? P.grey(` · started ${shortDate(p.startedAt)}`) : '') + (p.version !== version ? P.yellow(` (version ${p.version} — stop and start to use ${version})`) : '')).join(', ')}`;
  const state = inst.ok ? P.green('installed ✓') : `${P.red('not installed')} — ${inst.problem}, pick ${P.boldCyan('5')} install`;
  const first = `${P.boldCyan('fwdloop')} ${P.grey(version)}${sep}${state}${sep}${where}`;
  let second;
  try {
    const c = countRuns(runsListForCount({ root: d.root ?? defaultFlowsRoot(d.home), ...(typeof d.now === 'number' ? { now: () => /** @type {number} */ (d.now) } : {}) }));
    second = `${P.grey('runs:')} ${c.running > 0 ? P.green(`${c.running} running`) : P.grey(`${c.running} running`)}${sep}`
      + `${c.needYou > 0 ? P.yellow(`${c.needYou} need you`) : P.grey(`${c.needYou} need you`)}${sep}${c.total} in all`;
  } catch {
    second = `${P.grey('runs:')} the run list could not be read`;
  }
  // the thin rule frames the header only on a colour terminal (plain output keeps exactly the two lines)
  const rule = P.on ? [P.grey('─'.repeat(RULE_WIDTH))] : [];
  return { lines: [...rule, first, second, ...rule], panels };
}

/**
 * @param {LauncherDeps & {version?: string}} d
 * @returns {Promise<string[]>} the two header lines
 */
export async function headerLines(d) {
  return (await buildHeader(d)).lines;
}

/**
 * Print the header unless the caller (the menu) already did; hand back the panels either way.
 * @param {{out: (s: string) => void}} io @param {LauncherDeps & {version?: string}} d @param {{lines: string[], panels: Panel[]}} [shown]
 */
async function headerOnce(io, d, shown) {
  if (shown) return shown;
  const h = await buildHeader(d);
  for (const l of h.lines) io.out(l);
  return h;
}

/** stderr line, red on a colour terminal @param {{err: (s: string) => void}} io @param {LauncherDeps} d @param {string} text */
const fail = (io, d, text) => io.err((d.paintErr ?? d.paint ?? PLAIN).red(text));

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** @param {LauncherDeps} d */
const sleepOf = (d) => d.sleep ?? ((/** @type {number} */ ms) => new Promise((r) => { setTimeout(r, ms); }));

/** @param {number} port @returns {Promise<boolean>} true when nothing holds 127.0.0.1:port */
function bindFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => { s.close(() => resolve(true)); });
  });
}

/**
 * `fwdloop install` — creates only what is missing, never reads a key value.
 * @param {{out: (s: string) => void, err: (s: string) => void}} io @param {LauncherDeps & {version?: string}} d @param {{lines: string[], panels: Panel[]}} [shown]
 * @returns {Promise<number>}
 */
export async function installCmd(io, d, shown) {
  await headerOnce(io, d, shown);
  const major = Number((d.nodeVersion ?? process.versions.node).split('.')[0]);
  if (!(major >= MIN_NODE_MAJOR)) {
    fail(io, d, `fwdloop needs node ${MIN_NODE_MAJOR} or newer; this is node ${d.nodeVersion ?? process.versions.node}. Nothing was changed.`);
    return 1;
  }
  const dir = keysHome(d.home);
  /** @type {string[]} */
  const made = [];
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true, mode: 0o700 }); made.push(`${dir} (only you can open it)`); }
  const envFile = keysFilePath(d.home);
  if (createKeysFile(d.home)) made.push(`${envFile} (the keys file, only you can read it)`);
  else {
    try {
      if ((statSync(envFile).mode & 0o077) !== 0) { chmodSync(envFile, 0o600); made.push(`${envFile} set so only you can read it`); }
    } catch { /* unreadable: the header says so */ }
  }
  if (!existsSync(configPath(d.home))) {
    try { updateConfig({}, { home: d.home }); made.push(`${configPath(d.home)} (your settings)`); } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      fail(io, d, `${e.message}. Install did not touch it.`);
      return 1;
    }
  } else {
    try { readConfig({ home: d.home }); } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      fail(io, d, `${e.message}. Install did not touch it.`);
      return 1;
    }
  }
  if (made.length === 0) { io.out('Already installed, nothing to do.'); return 0; }
  io.out('Installed. Created:');
  for (const m of made) io.out(`  ${m}`);
  return 0;
}

/**
 * `fwdloop status` — the header, then one line per panel (or `Panel not running.`). Exit 0 running, 3 not running; 0 when the menu ran it.
 * @param {{out: (s: string) => void}} io @param {LauncherDeps & {version?: string}} d @param {{lines: string[], panels: Panel[]}} [shown] header the menu already printed
 * @returns {Promise<number>}
 */
export async function statusCmd(io, d, shown) {
  const h = await headerOnce(io, d, shown);
  if (h.panels.length === 0) {
    io.out('Panel not running.');
    // the sub-command's exit says "not running" (3); from the menu the menu itself worked (0)
    return shown ? 0 : 3;
  }
  for (const p of h.panels) {
    const body = `pid ${p.pid} · version ${p.version} · ${plural(p.drafts, 'draft', 'drafts')} open · ${plural(p.schedules, 'schedule', 'schedules')} on${p.startedAt ? ` · started ${shortDate(p.startedAt)}` : ''}`;
    io.out(h.panels.length > 1 ? `${p.url} · ${body}` : body);
  }
  return 0;
}

/**
 * Wait until `port` stops (gone=true) or starts (gone=false) answering whoami as fwdloop.
 * @param {LauncherDeps} d @param {number} port @param {boolean} gone
 * @returns {Promise<boolean>} false when the deadline passed first
 */
async function waitFor(d, port, gone) {
  const sleep = sleepOf(d);
  const deadline = d.deadlineMs ?? WAIT_DEADLINE_MS;
  // real clock time (CLOCK_MONOTONIC): a probe can take up to its whole timeout, so counting POLL_MS a turn would overshoot the deadline many times over
  const t0 = performance.now();
  while (performance.now() - t0 <= deadline) {
    const found = await probePanels({ ports: [port], timeoutMs: d.timeoutMs, fetchImpl: d.fetchImpl });
    if (gone ? found.length === 0 : found.length > 0) return true;
    await sleep(POLL_MS);
  }
  return false;
}

/**
 * A taken port that no probe recognised: ask it again until it answers or ~10 s of real time pass. A fwdloop whoami = a panel;
 * any other reply = not ours (move on); still silent at the end = `silent`.
 * @param {LauncherDeps} d @param {number} port
 * @returns {Promise<{state: 'panel', panel: Panel}|{state: 'other'}|{state: 'silent'}>}
 */
async function askTakenPort(d, port) {
  const sleep = sleepOf(d);
  const limit = d.silentWaitMs ?? SILENT_PORT_WAIT_MS;
  const t0 = performance.now();
  for (;;) {
    const r = await probePort({ port, timeoutMs: d.timeoutMs, fetchImpl: d.fetchImpl });
    if (r.state !== 'silent') return r;
    if (performance.now() - t0 >= limit) return r;
    await sleep(POLL_MS);
  }
}

/**
 * `fwdloop start` — find a running panel first; else start one detached on the first free port 4800..4809, wait until it answers,
 * open the page.
 * @param {{out: (s: string) => void, err: (s: string) => void}} io @param {LauncherDeps & {version?: string}} d @param {{lines: string[], panels: Panel[]}} [shown]
 * @returns {Promise<number>}
 */
export async function startCmd(io, d, shown) {
  const h = await headerOnce(io, d, shown);
  const P = d.paint ?? PLAIN;
  const open = d.open ?? ((/** @type {string} */ t) => openInOs(t));
  /** @param {string} url @param {string} said */
  const finish = async (url, said) => {
    const opened = await open(url);
    io.out(opened ? `${said} — opening the page.` : `${said} — open it in your browser.`);
    return 0;
  };
  /** @param {Panel} found */
  const alreadyRunning = async (found) => {
    const rc = await finish(found.url, `Panel already running at ${P.cyan(found.url)}`);
    const mine = d.version ?? readOwnVersion() ?? 'unknown';
    if (found.version !== mine) io.out(P.yellow(`It is version ${found.version}; this fwdloop is ${mine}. Run fwdloop stop, then fwdloop start, to use ${mine}.`));
    return rc;
  };
  if (h.panels.length > 0) return alreadyRunning(h.panels[0]);
  const free = d.portFree ?? bindFree;
  const ports = portsOf(d);
  /** @type {number|null} */
  let chosen = null;
  for (const p of ports) {
    if (await free(p)) { chosen = p; break; }
    // taken: if it is a loaded panel that missed the probe, a second panel next to it would double every scheduled run
    const verdict = await askTakenPort(d, p);
    if (verdict.state === 'panel') return alreadyRunning(verdict.panel);
    if (verdict.state === 'silent') {
      fail(io, d, `Port ${p} is taken and not answering. To see what holds it: lsof -i :${p}. If it is a stuck fwdloop, end it: kill <pid>`);
      return 1;
    }
  }
  if (chosen === null) {
    fail(io, d, `Every port from ${ports[0]} to ${ports[ports.length - 1]} is taken by something else, so the panel was not started.`);
    return 1;
  }
  if (chosen !== ports[0]) io.out(`${ports[0]} is taken, using ${chosen}.`);
  const dir = keysHome(d.home);
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* the log open below reports it */ }
  const logFile = join(dir, 'panel.log');
  const bin = d.fwdloopBin ?? join(HERE, '..', 'bin', 'fwdloop');
  const argv = ['panel', '--port', String(chosen), '--root', d.root ?? defaultFlowsRoot(d.home)];
  const spawnFn = d.spawnFn ?? spawnDetached;
  try {
    const child = spawnFn({ bin, argv, env: d.env ?? process.env, logPath: logFile });
    if (child && typeof child.once === 'function') child.once('error', () => { /* seen as "never answered" below */ });
    if (child && typeof child.unref === 'function') child.unref();
  } catch (e) {
    fail(io, d, `Could not start the panel: ${/** @type {Error} */ (e).message}`);
    return 1;
  }
  if (!(await waitFor(d, chosen, false))) {
    fail(io, d, `The panel did not answer within ${(d.deadlineMs ?? WAIT_DEADLINE_MS) / 1000} seconds. See ${logFile}.`);
    return 1;
  }
  return finish(panelUrl(chosen), `${P.green('Panel started')} at ${P.cyan(panelUrl(chosen))}`);
}

/**
 * `fwdloop stop [--yes]` — SIGTERM the pid of EVERY panel the probe finds (one panel at a time is the rule; no "which one"), wait until each
 * port stops answering. Drafts are in memory: warn (summed over all found panels) and ask y/N unless `--yes`.
 * @param {string[]} args
 * @param {{out: (s: string) => void, err: (s: string) => void}} io @param {LauncherDeps & {version?: string}} d @param {{lines: string[], panels: Panel[]}} [shown]
 * @returns {Promise<number>}
 */
export async function stopCmd(args, io, d, shown) {
  return (await stopPanels('stop', args, io, d, shown)).rc;
}

/**
 * The one stop: `stopCmd` and `restartCmd` both run it. `stopped` is true only when panels were signalled and are gone (declined, not-running and failed are all
 * false), so `restart` can tell "Not stopped." (exit 0) from a stop that happened.
 * @param {string} verb the word the unknown-option line names (stop | restart)
 * @param {string[]} args @param {{out: (s: string) => void, err: (s: string) => void}} io @param {LauncherDeps & {version?: string}} d @param {{lines: string[], panels: Panel[]}} [shown]
 * @returns {Promise<{rc: number, stopped: boolean, panels: Panel[], shown: {lines: string[], panels: Panel[]}}>}
 */
async function stopPanels(verb, args, io, d, shown) {
  /** @param {number} rc */
  const done = (rc, stopped = false, panels = /** @type {Panel[]} */ ([]), h = shown ?? { lines: [], panels: [] }) => ({ rc, stopped, panels, shown: h });
  const bad = args.find((a) => a !== '--yes');
  if (bad !== undefined) {
    fail(io, d, `Unknown option ${JSON.stringify(bad)} — fwdloop ${verb} takes only --yes. It stops every panel it finds.`);
    return done(1);
  }
  const h = await headerOnce(io, d, shown);
  const yes = args.includes('--yes');
  const panels = h.panels;
  if (panels.length === 0) { io.out('Panel not running.'); return done(0, false, [], h); }
  const ask = d.ask;
  const drafts = panels.reduce((n, p) => n + p.drafts, 0);
  if (drafts > 0 && !yes) {
    io.out(`${drafts === 1 ? '1 draft is' : `${drafts} drafts are`} open in the panel and will be lost.`);
    io.out('Runs keep going. Scheduled runs wait until the panel is started again.');
    const a = ask ? (await ask('Stop the panel? [y/N] ')).trim().toLowerCase() : '';
    if (a !== 'y' && a !== 'yes') { io.out('Not stopped.'); return done(0, false, [], h); }
  }
  const kill = d.kill ?? ((/** @type {number} */ pid, /** @type {string} */ sig) => process.kill(pid, /** @type {NodeJS.Signals} */ (sig)));
  for (const p of panels) {
    if (!Number.isInteger(p.pid) || p.pid <= 1) { fail(io, d, `The panel at ${p.url} reported no usable pid, so it was not stopped.`); return done(1, false, [], h); }
    try { kill(p.pid, 'SIGTERM'); } catch (e) {
      fail(io, d, `Could not stop the panel at ${p.url} (pid ${p.pid}): ${/** @type {Error} */ (e).message}`);
      return done(1, false, [], h);
    }
  }
  // the pid being gone is the truth (signal 0: ESRCH = gone, EPERM = alive); the port going quiet is checked after, for those that went
  const t0 = performance.now();
  const limit = d.deadlineMs ?? WAIT_DEADLINE_MS;
  const sleep = sleepOf(d);
  let pending = panels.slice();
  while (pending.length > 0) {
    pending = pending.filter((p) => {
      try { kill(p.pid, 0); return true; } catch (e) { return /** @type {any} */ (e)?.code !== 'ESRCH'; }
    });
    if (pending.length === 0 || performance.now() - t0 > limit) break;
    await sleep(POLL_MS);
  }
  if (pending.length > 0) {
    for (const p of panels) {
      if (!pending.includes(p)) io.out(`The panel at ${p.url} (pid ${p.pid}) stopped.`);
    }
    for (const p of pending) fail(io, d, `The panel at ${p.url} (pid ${p.pid}) did not stop.`);
    return done(1, false, [], h);
  }
  for (const p of panels) {
    if (!(await waitFor(d, p.port, true))) {
      fail(io, d, `The panel at ${p.url} still answers after ${(d.deadlineMs ?? WAIT_DEADLINE_MS) / 1000} seconds (pid ${p.pid}).`);
      return done(1, false, [], h);
    }
  }
  io.out((d.paint ?? PLAIN).green(panels.length > 1 ? `${panels.length} panels stopped.` : 'Panel stopped.'));
  return done(0, true, panels, h);
}

/**
 * `fwdloop restart [--yes]` (M4b am6 item 2) — the existing stop (same open-drafts warning and question; `--yes` skips it), then the existing start, on the port
 * the panel had when it is free. No panel running: it just starts. A declined or failed stop starts nothing.
 * @param {string[]} args
 * @param {{out: (s: string) => void, err: (s: string) => void}} io @param {LauncherDeps & {version?: string}} d @param {{lines: string[], panels: Panel[]}} [shown]
 * @returns {Promise<number>}
 */
export async function restartCmd(args, io, d, shown) {
  const r = await stopPanels('restart', args, io, d, shown);
  if (r.rc !== 0) return r.rc;
  // the header is already on screen and nothing is running now: start must not see the old panels
  const afterStop = { lines: r.shown.lines, panels: /** @type {Panel[]} */ ([]) };
  if (!r.stopped) return r.shown.panels.length > 0 ? 0 : startCmd(io, d, afterStop); // panels found but not stopped = declined ("Not stopped.")
  const same = r.panels[0].port;
  return startCmd(io, { ...d, ports: [same, ...portsOf(d).filter((p) => p !== same)] }, afterStop);
}

/**
 * The bare `fwdloop` menu: header, the five choices, one question. Runs the chosen command and returns its exit code.
 * @param {{out: (s: string) => void, err: (s: string) => void}} io @param {LauncherDeps & {version?: string}} d
 * @returns {Promise<number>}
 */
export async function menuCmd(io, d) {
  const ask = d.ask;
  const h = await buildHeader(d);
  for (const l of h.lines) io.out(l);
  const P = d.paint ?? PLAIN;
  if (!P.on) io.out('');
  const n = (/** @type {string} */ k) => P.boldCyan(k);
  const items = `${n('1')} start   ${n('2')} stop   ${n('3')} restart   ${n('4')} status   ${n('5')} install   ${n('q')} quit`;
  io.out(P.on ? `  ${items}` : items);
  const choice = ask ? (await ask(`${P.cyan('>')} `)).trim().toLowerCase() : 'q';
  // the header is already on screen: the chosen command reuses it instead of printing it a second time
  if (choice === '1' || choice === 'start') return startCmd(io, d, h);
  if (choice === '2' || choice === 'stop') return stopCmd([], io, d, h);
  if (choice === '3' || choice === 'restart') return restartCmd([], io, d, h);
  if (choice === '4' || choice === 'status') return statusCmd(io, d, h);
  if (choice === '5' || choice === 'install') return installCmd(io, d, h);
  if (choice === '' || choice === 'q' || choice === 'quit') return 0;
  fail(io, d, `unknown choice ${JSON.stringify(choice)} — one of: 1, 2, 3, 4, 5, q`);
  return 1;
}

/**
 * The launcher doors: the bare `fwdloop` menu and `start | stop | restart | status | install` (bin/fwdloop calls this; bareloop's runLauncher in src/cli.js). All logic is above;
 * this only supplies the line reader and the colour. `deps.launcher` is the test seam for every OS touch (ports, spawn, kill, opener, clock).
 * @param {'menu'|'start'|'stop'|'restart'|'status'|'install'} cmd @param {string[]} rest
 * @param {{ stdin?: any, stdout?: any, stderr?: any, home?: string, root?: string, processEnv?: Record<string, string|undefined>, launcher?: LauncherDeps & {version?: string} }} deps
 * @returns {Promise<number>}
 */
export async function launcherMain(cmd, rest, deps) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const io = { out: (/** @type {string} */ s) => stdout.write(`${s}\n`), err: (/** @type {string} */ s) => stderr.write(`${s}\n`) };
  // borrowed-from: bareloop src/prompts.js@1bad2c8 — a line queue, so input that ends during the header's port probe is not dropped
  const { ask, close } = openAsker({ stdin: deps.stdin, stdout });
  const rawEnv = deps.processEnv ?? process.env;
  const d = {
    home: deps.home, root: deps.root, ask, paint: makePaint(stdout, rawEnv), paintErr: makePaint(stderr, rawEnv), ...(deps.launcher ?? {}),
  };
  try {
    if (cmd === 'start') return await startCmd(io, d);
    if (cmd === 'stop') return await stopCmd(rest, io, d);
    if (cmd === 'restart') return await restartCmd(rest, io, d);
    if (cmd === 'status') return await statusCmd(io, d);
    if (cmd === 'install') return await installCmd(io, d);
    return await menuCmd(io, d);
  } finally {
    close();
  }
}
