// PAID; NOT the product. F162: one practice draft on the REAL panel path (repo bin + HTTP API) to check M10 am22 + am23 live.
// Usage: FIREWORKS_API_KEY=... node poc/m10-am23/practice-draft.mjs --out <fresh scratch dir> [--cap <usd, default 0.05>] [--no-counts]
// The key is only checked for emptiness and passed through the parent env; it is never read into a variable that is printed or written.
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4917;
const MODEL = 'accounts/fireworks/models/deepseek-v4p1-flash';
const DEADLINE_MS = 6 * 60 * 1000;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const JOB_LINES = [
  'Read the flights page,',
  'list 3 flights from Madrid to Rome,',
  '~ under $150',
  '~ exactly 3 bullets',
  '~ under 80 words',
  'Ask 30m: check it with me,',
  'and once I accept, write it out.',
];
const URL_FLIGHTS = 'https://www.google.com/travel/flights?q=Flights+from+MAD+to+FCO+on+2026-11-25+one+way&hl=en&curr=USD';

const { values } = parseArgs({ args: process.argv.slice(2), options: { out: { type: 'string' }, cap: { type: 'string' }, 'no-counts': { type: 'boolean' } } });
// --no-counts: comparator, drops exactly the two count guardrail lines; everything else identical
const JOB = (values['no-counts'] ? JOB_LINES.filter((l) => l !== '~ exactly 3 bullets' && l !== '~ under 80 words') : JOB_LINES).join('\n');
const fail = (m) => { process.stderr.write(`practice-draft: ${m}\n`); process.exit(2); };
if (!values.out) fail('--out <fresh scratch dir> is required');
const CAP = values.cap ?? '0.05';
if (!(Number(CAP) > 0)) fail('--cap must be a positive USD number');
const out = path.resolve(values.out);
if (existsSync(out) && readdirSync(out).length > 0) fail(`${out} exists and is not empty; give a fresh dir`);
// $0 refusal before anything starts: emptiness only, the value is never printed
if (!process.env.FIREWORKS_API_KEY || process.env.FIREWORKS_API_KEY.trim() === '') fail('FIREWORKS_API_KEY is empty; nothing started, $0 spent');
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

const tmpBefore = new Set(readdirSync('/tmp').filter((n) => n.startsWith('barebrowse-')));
/** @type {import('node:child_process').ChildProcess | null} */
let panel = null;
let cleaned = false;

function drafts() { return path.join(flows, '.drafts'); }
function killListedChildren(signal) {
  const dd = drafts();
  if (!existsSync(dd)) return;
  for (const id of readdirSync(dd)) {
    try {
      const p = JSON.parse(readFileSync(path.join(dd, id, 'pid.json'), 'utf8'));
      if (Number.isInteger(p.pid) && p.pid > 1) process.kill(-p.pid, signal);
    } catch { /* none, or already gone */ }
  }
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

const report = { bars: {}, questions: [], answers: [] };
const say = (s) => process.stdout.write(`${s}\n`);

async function main() {
  const log = openSync(path.join(out, 'panel.out'), 'w');
  panel = spawn(process.execPath, [path.join(REPO, 'bin', 'fwdloop'), 'panel', '--port', String(PORT), '--root', flows], {
    cwd: REPO, env: { ...process.env, HOME: home }, stdio: ['ignore', log, log],
  });
  closeSync(log);
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    if (panel.exitCode !== null) throw new Error(`panel exited early (code ${panel.exitCode}); see ${path.join(out, 'panel.out')}`);
    try { up = (await rq('GET', '/api/author/flows')).status === 200; } catch { await sleep(500); }
  }
  if (!up) throw new Error('panel did not come up on the port');

  const card = {
    flowName: 'practice-am23', job: JOB, capUsd: CAP, askWait: '30m', destination: send,
    provider: 'FIREWORKS_API_KEY', model: MODEL, inputs: `flights: ${URL_FLIGHTS}`,
  };
  const start = await rq('POST', '/api/author/draft', card);
  if (start.status !== 202 && start.status !== 200) throw new Error(`draft refused: ${start.status} ${start.text.slice(0, 600)}`);
  const id = start.json?.draftId;
  if (!id) throw new Error(`no draftId: ${start.text.slice(0, 300)}`);
  say(`draft ${id} started`);

  const t0 = Date.now();
  const answered = new Set();
  /** @type {any} */
  let st = null;
  while (Date.now() - t0 < DEADLINE_MS) {
    await sleep(2000);
    st = (await rq('GET', `/api/author/${id}`)).json;
    if (!st) continue;
    if (['green', 'red', 'stopped'].includes(st.phase)) break;
    if (st.phase === 'questions-open' && !answered.has(`${st.plan}#${st.openK}`)) {
      const q = st.questions.find((x) => x.k === st.openK);
      say(`\nQUESTION k=${q.k} line=${q.line} source=${q.source ?? 'pick'}:\n${q.question}`);
      report.questions.push({ k: q.k, line: q.line, source: q.source ?? null, question: q.question });
      const answer = /I can't check/.test(q.question) ? 'drop it' : 'agree';
      for (let tries = 0; tries < 15; tries++) {
        const r = await rq('POST', `/api/author/${id}/answer`, { k: q.k, answer });
        if (r.status === 202 || r.status === 200) { say(`  answered: ${answer}`); report.answers.push({ k: q.k, answer }); answered.add(`${st.plan}#${st.openK}`); break; }
        if (r.json?.refused === 'draft-live') { await sleep(2000); continue; }
        throw new Error(`answer refused: ${r.status} ${r.text.slice(0, 400)}`);
      }
    }
  }
  if (!st || !['green', 'red', 'stopped'].includes(st.phase)) throw new Error(`deadline: last phase ${st?.phase}`);
  say(`\nPHASE: ${st.phase}`);
  report.phase = st.phase;
  if (st.reds) { report.reds = st.reds; say(`REDS: ${JSON.stringify(st.reds)}`); }
  if (st.say) { report.say = st.say; say(`SAY: ${st.say}`); }

  // wait for the child to be gone so the spend files are final
  for (let i = 0; i < 40; i++) {
    let alive = false;
    try { const p = JSON.parse(readFileSync(path.join(drafts(), id, 'pid.json'), 'utf8')); process.kill(p.pid, 0); alive = true; } catch { /* gone */ }
    if (!alive) break;
    await sleep(1000);
  }

  const dd = path.join(drafts(), id);
  const planRel = st.plan ?? 'draft';
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const decl = readJson(path.join(dd, planRel, 'declaration.json'));
  const step2 = decl?.steps?.find((s) => s.fromLine === 2) ?? null;
  report.line2Step = step2;
  report.line2Close = step2?.close ?? null;
  say(`\nLINE 2 STEP CLOSE: ${JSON.stringify(step2?.close ?? null)}`);
  report.readout = st.readout ?? null;
  report.checked = st.checked ?? null;
  report.notChecked = st.notChecked ?? null;
  report.stepList = st.stepList ?? null;
  report.answersOnState = st.answers ?? null;
  say('\nPLAN READOUT:');
  say(st.readout ?? '(none)');
  say('\nCHECKED / NOT CHECKED (plan card):');
  say(JSON.stringify({ checked: st.checked ?? null, notChecked: st.notChecked ?? null }, null, 1));

  // spend and model: every plan folder's draft-spend.json and model.json under the draft
  let spent = 0; let complete = true; const models = new Set(); const perPlan = {};
  for (const sub of readdirSync(dd)) {
    if (sub !== 'draft' && !/^draft-\d+$/.test(sub)) continue;
    const sp = readJson(path.join(dd, sub, 'draft-spend.json'));
    const md = readJson(path.join(dd, sub, 'model.json'));
    if (sp) { perPlan[sub] = sp.costUsd; if (typeof sp.costUsd === 'number') spent += sp.costUsd; else complete = false; if (sp.spendComplete === false) complete = false; if (sp.model) models.add(sp.model); }
    if (md?.model) models.add(md.model);
  }
  report.spend = { totalUsd: spent, perPlan, complete };
  report.models = [...models];
  say(`\nSPEND: $${spent.toFixed(4)} (complete: ${complete}) per plan ${JSON.stringify(perPlan)}; MODEL: ${[...models].join(', ')}`);

  if (values['no-counts']) {
    const cls = step2?.close?.class ?? 'none';
    const cited = /cited/i.test(JSON.stringify(step2?.close ?? {}));
    report.comparator = { class: cls, cited };
    say(`COMPARATOR: line 2 close class=${cls} cited=${cited ? 'yes' : 'no'}`);
    return;
  }
  // bars
  const qs = report.questions.filter((q) => q.line === 2).map((q) => q.question).join('\n');
  report.bars.a = /exactly 3 bullets/i.test(qs) && /under 80 words/i.test(qs);
  const closeJson = JSON.stringify(step2?.close ?? {});
  report.bars.b = st.phase === 'green' && step2?.close?.class === 'green' && /cited/i.test(closeJson) && step2?.close?.picked !== undefined && JSON.stringify(step2.close.picked).length > 2;
  const text = `${st.readout ?? ''}\n${JSON.stringify(st.checked ?? '')}\n${JSON.stringify(st.stepList ?? '')}`;
  report.bars.c = text.includes('[agent]') && (text.match(/\[you picked\]/g) ?? []).length >= 2;
  report.bars.d = spent <= 0.05 && complete && models.size > 0 && [...models].every((m) => m === MODEL);
  say('\nBARS:');
  for (const [k, v] of Object.entries(report.bars)) say(`  (${k}) ${v ? 'ok' : 'FAIL'}`);
  say('  (a bar judged by this script on strings and JSON; read the readout above before calling it)');
}

let code = 0;
try {
  await main();
} catch (e) {
  code = 1;
  report.error = String(e?.message ?? e);
  process.stderr.write(`practice-draft: ${report.error}\n`);
} finally {
  try { writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); } catch { /* ignore */ }
  await cleanup();
}
process.exit(code);
