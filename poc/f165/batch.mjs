// PAID; NOT the product. F165: do count guardrails on the flights fact line make the drafter drop line 2's cited price check?
// Usage: DEEPSEEK_API_KEY=... node poc/f165/batch.mjs --out <fresh dir> [--n <drafts per arm, default 10>]
// One panel (port 4918, HOME=<out>/home) for the whole batch; drafts interleaved A,B,A,B...; hard cap: no new draft once spend >= $0.35.
// The key is only checked for emptiness and passed through the parent env; it is never read into a printed or written value.
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4918;
const PROVIDER = 'DEEPSEEK_API_KEY';
const MODEL = 'deepseek-flash';
const DEADLINE_MS = 6 * 60 * 1000;
const STOP_NEW_AT = 0.35;
const HARD_CAP = 0.40;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const LINES_A = ['Read the flights page,', 'list 3 flights from Madrid to Rome,', '~ under $150', '~ nonstop', 'Ask 30m: check it with me,', 'and once I accept, write it out.'];
const LINES_B = ['Read the flights page,', 'list 3 flights from Madrid to Rome,', '~ under $150', '~ nonstop', '~ exactly 3 bullets', '~ under 80 words', 'Ask 30m: check it with me,', 'and once I accept, write it out.'];
const JOBS = { A: LINES_A.join('\n'), B: LINES_B.join('\n') };
const URL_FLIGHTS = 'https://www.google.com/travel/flights?q=Flights+from+MAD+to+FCO+on+2026-11-25+one+way&hl=en&curr=USD';

const { values } = parseArgs({ args: process.argv.slice(2), options: { out: { type: 'string' }, n: { type: 'string' } } });
const fail = (m) => { process.stderr.write(`f165: ${m}\n`); process.exit(2); };
if (!values.out) fail('--out <fresh dir> is required');
const N = values.n === undefined ? 10 : Number(values.n);
if (!Number.isInteger(N) || N < 1 || N > 10) fail('--n must be an integer 1..10');
const out = path.resolve(values.out);
if (existsSync(path.join(out, 'results.jsonl'))) fail('results.jsonl exists; never overwritten, give a fresh dir');
if (existsSync(out) && readdirSync(out).length > 0) fail(`${out} exists and is not empty; give a fresh dir`);
// $0 refusal before anything starts: emptiness only, the value is never printed
if (!process.env[PROVIDER] || process.env[PROVIDER].trim() === '') fail(`${PROVIDER} is empty; nothing started, $0 spent`);
const realCfg = path.join(os.homedir(), '.config', 'fwdloop', 'config.json');
if (!existsSync(realCfg)) fail(`no ${realCfg} to copy`);

const flows = path.join(out, 'flows');
const send = path.join(out, 'send');
const home = path.join(out, 'home');
const cfgDir = path.join(home, '.config', 'fwdloop');
mkdirSync(flows, { recursive: true });
mkdirSync(send, { recursive: true });
mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
copyFileSync(realCfg, path.join(cfgDir, 'config.json'));
const resultsPath = path.join(out, 'results.jsonl');

const tmpBefore = new Set(readdirSync('/tmp').filter((n) => n.startsWith('barebrowse-')));
/** @type {import('node:child_process').ChildProcess | null} */
let panel = null;
let cleaned = false;

const draftsDir = () => path.join(flows, '.drafts');
function killChild(id, signal) {
  try {
    const p = JSON.parse(readFileSync(path.join(draftsDir(), id, 'pid.json'), 'utf8'));
    if (Number.isInteger(p.pid) && p.pid > 1) process.kill(-p.pid, signal);
  } catch { /* none, or already gone */ }
}
function killListedChildren(signal) {
  if (!existsSync(draftsDir())) return;
  for (const id of readdirSync(draftsDir())) killChild(id, signal);
}
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  killListedChildren('SIGTERM');
  if (panel?.pid) { try { process.kill(panel.pid, 'SIGTERM'); } catch { /* gone */ } }
  await sleep(1500);
  killListedChildren('SIGKILL');
  if (panel?.pid) { try { process.kill(panel.pid, 'SIGKILL'); } catch { /* gone */ } }
  for (const n of readdirSync('/tmp')) {
    if (n.startsWith('barebrowse-') && !tmpBefore.has(n)) { try { rmSync(path.join('/tmp', n), { recursive: true, force: true }); } catch { /* ignore */ } }
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup().finally(() => process.exit(130)); });

function rq(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = { host: `127.0.0.1:${PORT}` };
    if (method === 'POST') { headers.origin = `http://127.0.0.1:${PORT}`; headers['content-type'] = 'application/json'; }
    if (data !== undefined) headers['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: url, headers, agent: false }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const text = Buffer.concat(ch).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}

const say = (s) => process.stdout.write(`${s}\n`);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Spend of one draft: every plan folder's draft-spend.json. Incomplete spend is flagged, never counted as 0. */
function spendOf(id) {
  const dd = path.join(draftsDir(), id);
  let usd = 0; let complete = true; let seen = false;
  if (!existsSync(dd)) return { usd, complete: false };
  for (const sub of readdirSync(dd)) {
    if (sub !== 'draft' && !/^draft-\d+$/.test(sub)) continue;
    const sp = readJson(path.join(dd, sub, 'draft-spend.json'));
    if (!sp) continue;
    seen = true;
    if (typeof sp.costUsd === 'number') usd += sp.costUsd; else complete = false;
    if (sp.spendComplete === false) complete = false;
  }
  return { usd, complete: complete && seen };
}

async function oneDraft(arm, i) {
  const flowName = `f165-${arm}-${i}`;
  const row = { flowName, arm, i, phase: null, line2Class: null, cited: null, picks: null, unjudgeable2: null, spendUsd: 0, spendComplete: false, model: null, questions: 0 };
  const card = { flowName, job: JOBS[arm], capUsd: '0.5', askWait: '30m', destination: send, provider: PROVIDER, model: MODEL, inputs: `flights: ${URL_FLIGHTS}` };
  const start = await rq('POST', '/api/author/draft', card);
  const id = start.json?.draftId;
  if (!(start.status === 202 || start.status === 200) || !id) { row.phase = 'refused'; row.error = `${start.status} ${start.text.slice(0, 300)}`; return row; }
  row.draftId = id;
  const t0 = Date.now();
  const answered = new Set();
  let st = null;
  while (Date.now() - t0 < DEADLINE_MS) {
    await sleep(2000);
    st = (await rq('GET', `/api/author/${id}`)).json;
    if (!st) continue;
    if (['green', 'red', 'stopped'].includes(st.phase)) break;
    if (st.phase === 'questions-open' && !answered.has(`${st.plan}#${st.openK}`)) {
      const q = st.questions.find((x) => x.k === st.openK);
      const answer = /I can't check/.test(q.question) ? 'drop it' : 'agree';
      for (let tries = 0; tries < 15; tries++) {
        const r = await rq('POST', `/api/author/${id}/answer`, { k: q.k, answer });
        if (r.status === 202 || r.status === 200) { row.questions++; answered.add(`${st.plan}#${st.openK}`); break; }
        if (r.json?.refused === 'draft-live') { await sleep(2000); continue; }
        row.error = `answer refused: ${r.status} ${r.text.slice(0, 200)}`; break;
      }
    }
  }
  if (!st || !['green', 'red', 'stopped'].includes(st.phase)) {
    row.phase = 'timeout'; row.lastPhase = st?.phase ?? null;
    killChild(id, 'SIGTERM'); await sleep(1500); killChild(id, 'SIGKILL');
  } else {
    row.phase = st.phase;
    if (st.reds) row.reds = st.reds;
    for (let k = 0; k < 40; k++) { // wait for the child to be gone so the spend files are final
      let alive = false;
      try { process.kill(readJson(path.join(draftsDir(), id, 'pid.json')).pid, 0); alive = true; } catch { /* gone */ }
      if (!alive) break;
      await sleep(1000);
    }
  }
  const dd = path.join(draftsDir(), id);
  const decl = readJson(path.join(dd, st?.plan ?? 'draft', 'declaration.json'));
  const step2 = decl?.steps?.find((s) => s.fromLine === 2) ?? null;
  const close = step2?.close ?? null;
  row.line2Class = close?.class ?? null;
  row.cited = /cited/i.test(JSON.stringify(close ?? {}));
  row.picks = close?.picked !== undefined && JSON.stringify(close.picked).length > 2;
  row.unjudgeable2 = decl?.unjudgeable?.['2'] ?? decl?.unjudgeable?.[2] ?? null;
  const sp = spendOf(id);
  row.spendUsd = sp.usd; row.spendComplete = sp.complete;
  row.model = readJson(path.join(dd, st?.plan ?? 'draft', 'model.json'))?.model ?? null;
  return row;
}

let code = 0;
const rows = [];
try {
  const log = openSync(path.join(out, 'panel.out'), 'w');
  panel = spawn(process.execPath, [path.join(REPO, 'bin', 'fwdloop'), 'panel', '--port', String(PORT), '--root', flows], {
    cwd: REPO, env: { ...process.env, HOME: home }, stdio: ['ignore', log, log],
  });
  closeSync(log);
  let up = false;
  for (let k = 0; k < 60 && !up; k++) {
    if (panel.exitCode !== null) throw new Error(`panel exited early (code ${panel.exitCode}); see ${path.join(out, 'panel.out')}`);
    try { up = (await rq('GET', '/api/author/flows')).status === 200; } catch { await sleep(500); }
  }
  if (!up) throw new Error('panel did not come up on the port');

  let spent = 0;
  let cut = false;
  outer: for (let i = 1; i <= N; i++) {
    for (const arm of ['A', 'B']) {
      if (spent >= STOP_NEW_AT) { cut = true; say(`spend $${spent.toFixed(4)} >= $${STOP_NEW_AT}: no new draft`); break outer; }
      const row = await oneDraft(arm, i);
      spent += row.spendUsd;
      rows.push(row);
      appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
      say(`${row.flowName}: ${row.phase} line2=${row.line2Class} cited=${row.cited} picks=${row.picks} $${row.spendUsd.toFixed(4)}${row.spendComplete ? '' : ' (INCOMPLETE)'} total $${spent.toFixed(4)}`);
    }
  }
  const G = (arm) => rows.filter((r) => r.arm === arm && r.phase === 'green' && r.line2Class === 'green' && r.cited).length;
  const count = (arm, f) => rows.filter((r) => r.arm === arm && f(r)).length;
  const gA = G('A'); const gB = G('B');
  const nA = count('A', () => true); const nB = count('B', () => true);
  let verdict = Math.abs(gA - gB) <= 2 ? 'NO-DIFFERENCE' : (gA - gB >= 3 ? 'COUNTS-HURT' : 'COUNTS-HELP');
  if (cut || nA !== N || nB !== N) verdict = `INCONCLUSIVE (cut batch; letter would read ${verdict})`;
  const summary = {
    G_A: gA, G_B: gB, draftsA: nA, draftsB: nB, verdict, totalSpendUsd: spent, spendComplete: rows.every((r) => r.spendComplete), overHardCap: spent > HARD_CAP,
    redA: count('A', (r) => r.phase === 'red'), redB: count('B', (r) => r.phase === 'red'),
    stoppedA: count('A', (r) => r.phase === 'stopped'), stoppedB: count('B', (r) => r.phase === 'stopped'),
    timeoutA: count('A', (r) => r.phase === 'timeout'), timeoutB: count('B', (r) => r.phase === 'timeout'),
    unjudgeable2: { A: rows.filter((r) => r.arm === 'A').map((r) => r.unjudgeable2), B: rows.filter((r) => r.arm === 'B').map((r) => r.unjudgeable2) },
  };
  writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  say(JSON.stringify(summary, null, 2));
} catch (e) {
  code = 1;
  process.stderr.write(`f165: ${String(e?.message ?? e)}\n`);
} finally {
  await cleanup();
}
process.exit(code);
