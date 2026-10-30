// M12 piece 3 (hamr 2026-10-29, found in the rehearsal of the exit walk): Sign & run on a ticket job takes the ticket number too, and a start the child refuses
// leaves no run folder. Real panel, real `fwdloop draft` / `fwdloop run` children with the test provider; $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { killChildrenAfter, until, world } from './m4e-world.mjs';
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

/** a world whose green draft reads `jd` as a ticket list; HOME names a github MCP server so the drafter accepts it */
async function ticketDraft({ echo = false } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12sr-'));
  const w = await world({ limit: 5, ...(echo ? { bin: echoBin(work) } : {}), extraEnv: { FWDLOOP_TEST_DRAFT_TICKET: '1', ...(echo ? { ARGV_FILE: path.join(work, 'argv.jsonl') } : {}) } });
  const fakeHome = path.join(w.work, 'home');
  mkdirSync(fakeHome);
  writeFileSync(path.join(fakeHome, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'true' } } }));
  w.env.HOME = fakeHome;
  const card = w.card({ inputs: `resume: ${path.join(w.inDir, 'resume.md')}\njd: ${LIST}` });
  const id = (await w.post('/api/author/draft', card)).json().draftId;
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  return { w, id, g };
}

test('a green ticket draft names its ticket role to the page', async () => {
  const { g } = await ticketDraft();
  assert.equal(g.phase, 'green', JSON.stringify(g));
  assert.equal(g.ticketRole, 'jd');
});

const runsOf = (w) => (existsSync(path.join(w.root, 'job2', 'runs')) ? readdirSync(path.join(w.root, 'job2', 'runs')) : []);

test('Sign & run on a ticket job with no ticket number is refused at $0 before signing: nothing signed, no start, no run folder', async () => {
  const { w, id, g } = await ticketDraft({ echo: true });
  assert.equal(g.phase, 'green', JSON.stringify(g));
  for (const body of [{ hash: g.hash }, { hash: g.hash, ticket: '' }, { hash: g.hash, ticket: 'abc' }, { hash: g.hash, ticket: 0 }]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post(`/api/author/${id}/sign`, body);
    assert.equal(r.status, 400, r.text);
    assert.deepEqual(r.json().refusals.map((x) => x.field), ['ticket']);
    assert.match(r.json().refusals[0].say, /ticket number/);
  }
  assert.equal(existsSync(path.join(w.root, 'job2', 'signature.json')), false, 'nothing signed');
  assert.deepEqual(w.starts(), []);
  assert.deepEqual(runsOf(w), []);
  assert.equal(existsSync(w.env.ARGV_FILE), false, 'no child was started');
});

test('Sign & run with a ticket number starts the run with --ticket N beside the signed list', async () => {
  const { w, id, g } = await ticketDraft({ echo: true });
  const r = await w.post(`/api/author/${id}/sign`, { hash: g.hash, ticket: '7' });
  assert.equal(r.status, 202, r.text);
  await until(() => existsSync(w.env.ARGV_FILE), 20000);
  const a = JSON.parse(readFileSync(w.env.ARGV_FILE, 'utf8').trim().split('\n')[0]);
  assert.equal(a[a.indexOf('--ticket') + 1], '7', JSON.stringify(a));
  assert.ok(a.includes(`jd=${LIST}`));
});

test('Sign & run on a job with no ticket list: a ticket number is refused, naming the box; the page is told there is no ticket role', async () => {
  const w = await world({ limit: 5 });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(g.ticketRole, null);
  const r = await w.post(`/api/author/${id}/sign`, { hash: g.hash, ticket: '3' });
  assert.equal(r.status, 400, r.text);
  assert.deepEqual(r.json().refusals.map((x) => x.field), ['ticket']);
});

// ---- the husk: the panel claims `run-<n>` (and writes the signed values into it) BEFORE it spawns the child; a child that refuses at $0 must take the claim back ----
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { ticketJob } from './m12-p2-world.mjs';

function refusedRun(t, extraArgs, { claim = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12husk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ticketJob(root, 'tk');
  const runDir = path.join(root, 'tk', 'runs', 'run-1');
  if (claim) { mkdirSync(runDir, { recursive: true }); writeFileSync(path.join(runDir, 'signed-values.json'), '{}\n'); }
  const r = spawnSync(process.execPath, [REAL_BIN, 'run', 'tk', '--root', root, '--run-id', 'run-1', ...extraArgs], {
    encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: root },
  });
  return { r, runDir, root };
}

test('a run the child refuses at $0 (no ticket number) leaves no run folder behind, and says why', (t) => {
  const { r, runDir } = refusedRun(t, ['--source', `jd=${LIST}`, '--source', 'resume=/nonexistent']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /pick the ticket with --ticket <number>\. Nothing started\./);
  assert.equal(existsSync(runDir), false, 'the claimed run-1 folder is gone, so the number is free');
});

test('any other $0 refusal before the run begins also takes the claim back (a declared input not given)', (t) => {
  const { r, runDir } = refusedRun(t, ['--ticket', '3', '--source', 'nope=/x']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /declares source role "resume"/);
  assert.equal(existsSync(runDir), false);
});

test('a run folder that holds real run files is never removed by a refusal', (t) => {
  const { r, runDir } = refusedRun(t, ['--source', `jd=${LIST}`]);
  assert.equal(r.status, 1);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'history.json'), '{}\n');
  const again = spawnSync(process.execPath, [REAL_BIN, 'run', 'tk', '--root', path.dirname(path.dirname(path.dirname(runDir))), '--run-id', 'run-1', '--source', `jd=${LIST}`], { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, NODE_ENV: 'test' } });
  assert.equal(again.status, 1);
  assert.equal(existsSync(path.join(runDir, 'history.json')), true);
});

// ---- the page: the ticket # box beside Sign & run, in the real panel (headless chromium; skips only when none is installed) ----
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';

test('the page shows a ticket # box beside Sign & run on a green ticket draft; the button stays off until a whole number is in it', async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  t.after(() => chrome.close());
  const { w, g } = await ticketDraft();
  assert.equal(g.phase, 'green', JSON.stringify(g));
  await chrome.send('Page.enable');
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  await chrome.ev('document.getElementById("tab-chat").click()');
  const BOX = 'document.querySelector("[data-testid=jf-sign-ticket]")';
  const MAIN = 'document.querySelector("[data-testid=chat-main]")';
  assert.ok(await chrome.waitFor(`!!${BOX} && !${BOX}.hidden && ${MAIN}.textContent === "Sign & run"`), 'the green draft shows the box and Sign & run');
  assert.equal(await chrome.ev(`${BOX}.placeholder`), 'ticket #');
  assert.equal(await chrome.ev(`${MAIN}.disabled`), true, 'off with an empty box');
  for (const bad of ['abc', '0', '1.5']) {
    // eslint-disable-next-line no-await-in-loop
    await chrome.ev(`${BOX}.value = ${JSON.stringify(bad)}; ${BOX}.dispatchEvent(new Event("input", {bubbles: true}))`);
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await chrome.ev(`${MAIN}.disabled`), true, `off with ${bad}`);
  }
  await chrome.ev(`${BOX}.value = "7"; ${BOX}.dispatchEvent(new Event("input", {bubbles: true}))`);
  assert.equal(await chrome.ev(`${MAIN}.disabled`), false, 'on with 7');
});

test('the page shows no ticket # box on a green draft that has no ticket list', async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  t.after(() => chrome.close());
  const w = await world({ limit: 5 });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  await until(async () => (await w.get(`/api/author/${id}`)).json()?.phase === 'green');
  await chrome.send('Page.enable');
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  await chrome.ev('document.getElementById("tab-chat").click()');
  assert.ok(await chrome.waitFor('document.querySelector("[data-testid=chat-main]").textContent === "Sign & run"'));
  assert.equal(await chrome.ev('document.querySelector("[data-testid=jf-sign-ticket]").hidden'), true);
  assert.equal(await chrome.ev('document.querySelector("[data-testid=chat-main]").disabled'), false);
});
