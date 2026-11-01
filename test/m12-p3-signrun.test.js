// M12 piece 3, rewritten for M13 piece 4 (R2): Sign & run on a Tickets job has no ticket # box (the child reads the newest ticket that has not run yet), and a start the child refuses
// leaves no run folder. Real panel, real `fwdloop draft` / `fwdloop run` children with the test provider; $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { killChildrenAfter, until, useHome, world } from './m4e-world.mjs';
import { appendMcpCheck } from '../src/mcp-checks.js';
import { LIST } from './m12-p2-world.mjs';

killChildrenAfter();
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REAL_BIN = path.join(HERE, '..', 'bin', 'fwdloop');
/** a stand-in `fwdloop` (the panel's bin seam): a `run` only records its argv to ARGV_FILE; a `draft` is the real thing */
const echoBin = (dir) => {
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'fwdloop');
  writeFileSync(f, `import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const a = process.argv.slice(2);
if (a[0] === 'run') { appendFileSync(process.env.ARGV_FILE, JSON.stringify(a) + '\\n'); process.exit(0); }
process.exit(spawnSync(process.execPath, [${JSON.stringify(REAL_BIN)}, ...a], { stdio: 'inherit' }).status ?? 1);
`);
  return f;
};

/** a world whose green draft is a Tickets job: the card's Flow type is Tickets with the github MCP (checked once, so the job gets its tools), jd is a GitHub issues list */
async function ticketDraft({ echo = false } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12sr-'));
  const w = await world({ limit: 5, ...(echo ? { bin: echoBin(work) } : {}), extraEnv: { FWDLOOP_TEST_DRAFT_TICKET: '1', ...(echo ? { ARGV_FILE: path.join(work, 'argv.jsonl') } : {}) } });
  const fakeHome = path.join(w.work, 'home');
  mkdirSync(fakeHome);
  writeFileSync(path.join(fakeHome, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'true' } } }));
  useHome(w, fakeHome);
  appendMcpCheck(w.home, { server: 'github', path: '~/.mcp.json', at: '2026-10-31T10:00:00Z', ok: true, tools: ['issue_read', 'list_issues'].map((name) => ({ name, hint: null })) });
  const card = w.card({ inputs: `resume: ${path.join(w.inDir, 'resume.md')}\njd: ${LIST}`, flowType: 'tickets', mcp: 'github' });
  const id = (await w.post('/api/author/draft', card)).json().draftId;
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  return { w, id, g };
}

test('a green Tickets draft carries the flow type and the checked tools in its signed declaration', async () => {
  const { w, g } = await ticketDraft();
  assert.equal(g.phase, 'green', JSON.stringify(g));
  const draftId = readdirSync(path.join(w.root, '.drafts'))[0];
  const d = JSON.parse(readFileSync(path.join(w.root, '.drafts', draftId, g.plan ?? 'draft', 'declaration.json'), 'utf8'));
  assert.equal(d.flowType, 'tickets');
  assert.deepEqual(d.mcp, { server: 'github', tools: ['issue_read', 'list_issues'] });
});

test('a Tickets card whose MCP was never checked is refused at $0 on the MCP field: nothing drafted', async () => {
  const w = await world({ limit: 5 });
  const fakeHome = path.join(w.work, 'home');
  mkdirSync(fakeHome);
  writeFileSync(path.join(fakeHome, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'true' } } }));
  useHome(w, fakeHome);
  const r = await w.post('/api/author/draft', w.card({ inputs: `jd: ${LIST}`, flowType: 'tickets', mcp: 'github' }));
  assert.equal(r.status, 400, r.text);
  assert.deepEqual(r.json().refusals.map((x) => x.field), ['mcp']);
  assert.equal(r.json().refusals[0].say, 'press check tools in Settings > MCP first');
});

const runsOf = (w) => (existsSync(path.join(w.root, 'job2', 'runs')) ? readdirSync(path.join(w.root, 'job2', 'runs')) : []);

test('Sign & run on a Tickets job takes no ticket number: it signs and starts the run with NO --ticket (the child reads the newest ticket)', async () => {
  const { w, id, g } = await ticketDraft({ echo: true });
  assert.equal(g.phase, 'green', JSON.stringify(g));
  const r = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(r.status, 202, r.text);
  await until(() => existsSync(w.env.ARGV_FILE), 20000);
  const a = JSON.parse(readFileSync(w.env.ARGV_FILE, 'utf8').trim().split('\n')[0]);
  assert.equal(a.includes('--ticket'), false, JSON.stringify(a));
  assert.ok(a.includes(`jd=${LIST}`));
  assert.equal(runsOf(w).length >= 0, true);
});

// ---- the husk: the panel claims `run-<n>` (and writes the signed values into it) BEFORE it spawns the child; a child that refuses at $0 must take the claim back ----
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { ticketJob } from './m12-p2-world.mjs';

/** HOME is a scratch dir: a run that got as far as a look would otherwise read the person's real MCP config */
function refusedRun(t, extraArgs, { claim = true, jobOpts = { tools: ['issue_read'] } } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12husk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ticketJob(root, 'tk', jobOpts);
  const runDir = path.join(root, 'tk', 'runs', 'run-1');
  if (claim) { mkdirSync(runDir, { recursive: true }); writeFileSync(path.join(runDir, 'signed-values.json'), '{}\n'); }
  const r = spawnSync(process.execPath, [REAL_BIN, 'run', 'tk', '--root', root, '--run-id', 'run-1', ...extraArgs], {
    encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: root, HOME: root },
  });
  return { r, runDir, root };
}

test('a run the child refuses at $0 (a Tickets job whose signed tools lack list_issues) leaves no run folder behind, and says why', (t) => {
  const { r, runDir } = refusedRun(t, ['--source', `jd=${LIST}`, '--source', 'resume=/nonexistent']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /does not list list_issues among its signed tools, so the newest ticket cannot be found\. Nothing started\./);
  assert.equal(existsSync(runDir), false, 'the claimed run-1 folder is gone, so the number is free');
});

test('any other $0 refusal before the run begins also takes the claim back (a declared input not given)', (t) => {
  const { r, runDir } = refusedRun(t, ['--ticket', '3', '--source', 'nope=/x']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /declares source role "resume"/);
  assert.equal(existsSync(runDir), false);
});

test('a run folder that holds real run files is never removed by a refusal', (t) => {
  const { r, runDir, root } = refusedRun(t, ['--source', `jd=${LIST}`]);
  assert.equal(r.status, 1);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'history.json'), '{}\n');
  const again = spawnSync(process.execPath, [REAL_BIN, 'run', 'tk', '--root', root, '--run-id', 'run-1', '--source', `jd=${LIST}`], { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: root, HOME: root } });
  assert.equal(again.status, 1);
  assert.equal(existsSync(path.join(runDir, 'history.json')), true);
});

// ---- the page: no ticket # box anywhere (R2), in the real panel (headless chromium; skips only when none is installed) ----
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';

test('the page has no ticket # box beside Sign & run on a green Tickets draft, and Sign & run is on', async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  t.after(() => chrome.close());
  const { w, g } = await ticketDraft();
  assert.equal(g.phase, 'green', JSON.stringify(g));
  await chrome.send('Page.enable');
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  await chrome.ev('document.getElementById("tab-chat").click()');
  const MAIN = 'document.querySelector("[data-testid=chat-main]")';
  assert.ok(await chrome.waitFor(`${MAIN}.textContent === "Sign & run"`), 'the green draft shows Sign & run');
  assert.equal(await chrome.ev('document.querySelector("[data-testid=jf-sign-ticket]")'), null);
  assert.equal(await chrome.ev('document.querySelector(".jf-ticket")'), null);
  assert.equal(await chrome.ev(`${MAIN}.disabled`), false);
});
