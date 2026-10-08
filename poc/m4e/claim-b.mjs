import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { signDraft } from '../../src/authoring.js';
import { readRuns } from '../../src/monthly.js';
import { isFwdloopAlive } from '../../src/liveness.js';
import { makeScratch, keysFile, cli, FAKE_DRAFT, FAKE_STEP, draftArgs, childEnv, cleanup, sleep, HERE, readJson } from './common.mjs';
import { startPanel, kill, ppidpgid, waitFor } from './claim-b-lib.mjs';

const s = makeScratch('b');
keysFile(s, 'sk-not-a-secret-b-poc-0000');
const rows = [];
const rec = (id, failsIf, observed, pass) => { rows.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}\n      fails-if: ${failsIf}\n      observed: ${observed}`); };
const alive = (pid) => isFwdloopAlive(pid, null);
const reattach = (runDir, pidFile) => JSON.parse(spawnSync(process.execPath, [join(HERE, 'reattach.mjs'), runDir, ...(pidFile ? [pidFile] : [])], { encoding: 'utf8' }).stdout);

/** What a reader can tell about a DRAFT dir from files alone (no panel memory). */
function draftState(dir) {
  const real = realpathSync(dir);
  const files = readdirSync(dir).sort();
  const holds = readRuns(s.cfg).filter((r) => r.kind === 'hold' && r.what === 'draft' && r.runDir === real);
  const ended = new Set(readRuns(s.cfg).filter((r) => r.kind !== 'hold').map((r) => r.holdId));
  const h = holds[holds.length - 1];
  const holdSignal = !h ? 'no-hold-row' : ended.has(h.holdId) ? 'hold-settled' : (isFwdloopAlive(h.pid, h.procStart) ? 'hold-open+pid-live' : 'hold-open+pid-dead');
  return { files, pidFileInDraftDir: files.some((f) => /pid/i.test(f)), holdSignal, holdPid: h?.pid ?? null, specHash: files.includes('spec.hash') };
}

try {
  // ---------- B1: draft child survives the panel's SIGKILL ----------
  const d1 = join(s.drafts, 'd1');
  const pf1 = join(s.logs, 'draft1.pid');
  let { panel, pid } = await startPanel(s, { args: draftArgs(s, d1), logPath: join(d1 + '.log'), pidFile: pf1, merge: true }, { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT, POC_DRAFT_MODE: 'slow', POC_DRAFT_SLEEP_MS: '5000' });
  await sleep(700);
  kill(panel.pid, 'SIGKILL');
  await sleep(300);
  const topo = ppidpgid(pid);
  const panelGone = !kill(panel.pid, 0);
  const mid = alive(pid);
  const dsMid = draftState(d1);
  rec('b1a draft child alive 1s after the panel was SIGKILLed, own process group, reparented',
    'child dead / same pgid as the panel / ppid still the dead panel', `panelGone=${panelGone} childAlive=${mid} state=${topo?.state} pgid=${topo?.pgid} (== pid ${pid}: ${topo?.pgid === pid}) ppid=${topo?.ppid} (panel was ${panel.pid})`,
    panelGone && mid === true && topo?.pgid === pid && topo?.ppid !== panel.pid);
  rec('b1b reader mid-draft: dir listing + hold row', 'reader says stopped, or spec.hash already present (timing control)', JSON.stringify(dsMid), dsMid.holdSignal === 'hold-open+pid-live' && !dsMid.specHash);
  const finished = await waitFor(() => existsSync(join(d1, 'spec.hash')), 30_000);
  const dsEnd = draftState(d1);
  rec('b1c draft child finished green after the panel died (spec.hash on disk, hold settled)', 'no spec.hash within 30s', JSON.stringify(dsEnd), !!finished && dsEnd.holdSignal === 'hold-settled');

  // ---------- sign (as the page would) ----------
  const hash = readFileSync(join(d1, 'spec.hash'), 'utf8').trim();
  const sg = signDraft({ dir: d1, approve: hash, signedBy: 'poc', env: {} });
  rec('b2 sign the survived draft', 'ok:false', `ok=${sg.ok}`, sg.ok);

  // ---------- B2: run child survives the panel's SIGKILL, parks at its ask ----------
  const runId = 'r1';
  const runDir = join(s.flows, 'poc-flow', 'runs', runId);
  const pf2 = join(s.logs, 'run1.pid');
  const runArgs = ['run', 'poc-flow', '--root', s.flows, '--source', `resume=${s.inputs}/resume.md`, '--source', `jd=${s.inputs}/jd.md`, '--run-id', runId];
  ({ panel, pid } = await startPanel(s, { args: runArgs, logPath: join(s.logs, 'run1.log'), pidFile: pf2, merge: true }, { FWDLOOP_TEST_MODEL_STEP: FAKE_STEP, POC_STEP_SLEEP_MS: '3000' }));
  await sleep(800);
  kill(panel.pid, 'SIGKILL');
  await sleep(1200); // t ~ 2s after spawn: first model step (3s) not done yet
  const t2 = reattach(runDir, pf2);
  rec('b3a fresh process re-attaches mid-run from files: running', 'runLiveness != running, or ask.json already there (timing control: the run must still be going)',
    `runLiveness=${t2.runLiveness} files=[${t2.files}] state=${t2.state ? JSON.stringify({ phase: t2.state.phase ?? t2.state.status }) : 'none'} ask.json=${t2.askJson ? 'present' : 'absent'} lock=${t2.lock} panelRecordedPid.alive=${t2.panelRecordedPid.alive}`,
    t2.runLiveness === 'running' && !t2.askJson && alive(pid) === true);
  const parked = await waitFor(() => existsSync(join(runDir, 'ask.json')), 40_000);
  await sleep(1500); // let the child exit
  const t3 = reattach(runDir, pf2);
  rec('b3b after the run parks: files say parked (ask.json + state), liveness gone', 'no ask.json within 40s, or runLiveness still running',
    `parked=${!!parked} runLiveness=${t3.runLiveness} childAlive=${alive(pid)} ask.json keys=[${Object.keys(t3.askJson ?? {})}] state.keys=[${Object.keys(t3.state ?? {})}] state.status=${t3.state?.status ?? t3.state?.phase} pids.jsonl rows=${t3.pidsJsonl?.length} legs=${t3.pidsJsonl?.map((r) => r.leg)}`,
    !!parked && t3.runLiveness === 'gone' && t3.askJson !== null);
  // can the two be told apart: running (t2) vs parked (t3)
  rec('b3c running vs parked distinguishable from files+liveness alone', 'identical readings', `t2: liveness=${t2.runLiveness}, ask=${!!t2.askJson}; t3: liveness=${t3.runLiveness}, ask=${!!t3.askJson}`, t2.runLiveness !== t3.runLiveness && !t2.askJson && !!t3.askJson);
  const runLog = readFileSync(join(s.logs, 'run1.log'), 'utf8').trim();
  rec('b3d run child log has its parked line', 'log empty', JSON.stringify(runLog.slice(0, 120)), runLog.startsWith('parked'));

  // ---------- B3: a draft killed from OUTSIDE mid-draft ----------
  const d3 = join(s.drafts, 'd3');
  const pf3 = join(s.logs, 'draft3.pid');
  ({ panel, pid } = await startPanel(s, { args: draftArgs(s, d3, 'flow-killed'), logPath: join(d3 + '.log'), pidFile: pf3, merge: true }, { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT, POC_DRAFT_MODE: 'slow', POC_DRAFT_SLEEP_MS: '20000' }));
  await sleep(1200);
  const before = { alive: alive(pid), ...draftState(d3) };
  rec('b4a control: the slow draft is genuinely running (reader sees live)', 'hold not live (the test could not tell live from dead)', JSON.stringify(before), before.alive === true && before.holdSignal === 'hold-open+pid-live');
  kill(pid, 'SIGKILL'); // the child, from outside
  await sleep(500);
  const after = { alive: alive(pid), ...draftState(d3) };
  rec('b4b killed draft: files after SIGKILL', 'reader still reads live, or the dir holds spec.hash', JSON.stringify(after), after.alive === false && after.holdSignal === 'hold-open+pid-dead' && !after.specHash);
  rec('b4c SIGNAL INVENTORY for a dead draft', 'a pid file in the draft dir would make this PASS-trivial',
    `draft dir has pid file: ${after.pidFileInDraftDir}; dir files=[${after.files}]; only signal is the runs.jsonl hold row (what=draft, runDir, pid, procStart) in the config home, outside the draft dir; spend.jsonl ${after.files.includes('spend.jsonl') ? 'present' : 'ABSENT (a paid round in flight is not booked until it returns)'}`,
    after.pidFileInDraftDir === false);
  const retry = cli(s, draftArgs(s, d3, 'flow-killed'), { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT });
  console.log(`      note: retry with the same --out: exit ${retry.status} ${retry.stderr.trim().slice(0, 140)}`);
  kill(panel.pid, 'SIGKILL');
  rec('b4d a dead draft dir is unusable for a retry (new dir needed)', 'retry exits 0', `exit=${retry.status}`, retry.status !== 0);
} finally { cleanup(s); }
const bad = rows.filter((x) => !x).length;
console.log(`\n(b) ${rows.length - bad}/${rows.length} pass`);
process.exitCode = bad ? 1 : 0;
