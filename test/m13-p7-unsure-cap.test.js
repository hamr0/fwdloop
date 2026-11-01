// M13 piece 7, hamr 2026-11-01. 9.4 "Run it, flag it": an `unsure` filter verdict never skips; the Result grid row wears a grey `unsure` mark; a job with an ask says
// `the filter was unsure about this ticket` on the ask page; a job with no ask shows the grid mark only. 9.7: ONE cap on a ticket number (10 digits) at every door.
// Must fail when: an unsure verdict skips; the mark or the ask line is not drawn (or is drawn for a sure ticket); a no-ask job shows an ask line; a 10-digit number is
// refused at a door; an 11-digit number is accepted at a door; the mark spills the page sideways at 1280, 390 or 320.
import assert from 'node:assert/strict';
import { test, describe, after } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { freezeInputs } from '../src/runner.js';
import { decideTicket, filterUnsure } from '../src/ticket-labels.js';
import { TICKET_MAX, isTicketNumber } from '../src/ticket-shape.js';
import { readTicketMcp } from '../src/ticket-mcp.js';
import { lookTickets, recordLook } from '../src/trigger-tickets.js';
import { readSeen } from '../src/trigger-files.js';
import { ticketAnyway } from '../src/panel/tickets.js';
import { buildJobGrid } from '../src/panel/jobgrid.js';
import { buildWorld } from './m4d-am29-world.mjs';
import { skippedWorld } from './m12-p3-world.mjs';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const FAKE = path.join(HERE, 'fixtures', 'fake-mcp-server.mjs');
const LIST = 'https://github.com/flutter/flutter/issues';
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const tmp = (t, n) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-${n}-`)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

describe('9.4 unsure runs, it is never skipped', () => {
  const ticket = (labels) => JSON.stringify({ number: 5, state: 'open', title: 'T', labels });
  const filter = { priority: ['P1'] };
  test('Must fail: an off-scale label (priority/important-soon) is outcome run with an unsure reason, not skip', () => {
    const v = decideTicket({ text: ticket(['priority/important-soon']), filter });
    assert.equal(v.outcome, 'run');
    assert.equal(typeof v.unsure, 'string');
  });
  test('a definite miss still skips (the unsure reading did not widen the skip)', () => {
    assert.equal(decideTicket({ text: ticket(['P3']), filter }).outcome, 'skip');
  });
  test('freezeInputs: the unsure ticket is not skipped and the input record keeps the verdict; filterUnsure reads it', async (t) => {
    const dir = tmp(t, 'unsure');
    const r = await freezeInputs(path.join(dir, 'run-1'), [{ id: 'issues', path: LIST, ticket: { number: 5 } }], {
      mcp: { server: 'github', tools: ['issue_read'] }, ticketFilter: filter, ticketRead: async () => ({ ok: true, text: ticket(['priority/important-soon']), url: `${LIST}/5`, record: { server: 'github', exposed: [], missing: [], calls: [] } }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.skip, null, 'an unsure ticket is never skipped');
    assert.equal(filterUnsure(r.manifest[0]), true);
  });
  test('filterUnsure is false for a sure run, for a skip-less entry, and for junk', () => {
    assert.equal(filterUnsure({ filter: { outcome: 'run' } }), false);
    assert.equal(filterUnsure({}), false);
    assert.equal(filterUnsure(null), false);
    assert.equal(filterUnsure({ filter: { outcome: 'anyway', was: { outcome: 'skip', reason: 'x' } } }), false);
    assert.equal(filterUnsure({ filter: { outcome: 'anyway', was: { outcome: 'run', unsure: 'x' } } }), true);
  });
  test('the grid row carries unsure only when the run says so', () => {
    const base = { glyph: '[✓]', at: 1, history: { spentUsd: 0, spendComplete: true, wallMs: 1 }, spendRows: [], diary: [], steps: [], reason: null };
    const g = buildJobGrid({ runs: [{ ...base, runId: 'run-1', ticket: 5, unsure: true }, { ...base, runId: 'run-2', ticket: 6, unsure: false }, { ...base, runId: 'run-3', ticket: 7 }] });
    const by = Object.fromEntries(g.groups.flatMap((x) => x.rows).map((r) => [r.runId, r.unsure]));
    assert.deepEqual(by, { 'run-1': true, 'run-2': false, 'run-3': false });
  });
});

describe('9.7 one cap on a ticket number: 10 digits', () => {
  test('the constant and the checker', () => {
    assert.equal(TICKET_MAX, 9999999999);
    assert.equal(isTicketNumber(1), true);
    assert.equal(isTicketNumber(9999999999), true);
    assert.equal(isTicketNumber(10000000000), false);
    for (const bad of [0, -1, 1.5, '5', NaN, null, undefined, 2 ** 53]) assert.equal(isTicketNumber(bad), false, String(bad));
  });
  const mcp = { server: 'github', tools: ['issue_read'] };
  test('door: readTicketMcp refuses 11 digits by name before it starts anything; 10 digits gets past the number check', async () => {
    const no = await readTicketMcp({ listUrl: LIST, number: 10000000000, mcp, configPath: '/nonexistent' });
    assert.equal(no.ok, false);
    assert.match(no.error, /ticket number 10000000000 is not a whole number from 1 to 9,999,999,999/);
    const yes = await readTicketMcp({ listUrl: LIST, number: 9999999999, mcp, configPath: '/nonexistent' });
    assert.equal(yes.ok, false);
    assert.doesNotMatch(yes.error, /is not a whole number from 1 to/, 'the 10-digit number was not refused as a number');
  });
  test('door: Run it anyway (ticketAnyway) refuses 11 digits as a bad request; 10 digits reaches the skipped-row check', () => {
    const listOf = () => ({ groups: [{ key: 'skip', rows: [{ number: 9999999999 }, { number: 10000000000 }] }] });
    let queued = null;
    const queue = { arriveAnyway: (a) => { queued = a.number; return { ok: true }; } };
    const go = (number) => ticketAnyway({ body: { flow: 'f', runId: 'run-1', number, reason: 'why' }, listOf, queue });
    assert.equal(go(10000000000).status, 400);
    assert.equal(queued, null);
    assert.equal(go(9999999999).status, 202);
    assert.equal(queued, 9999999999);
  });
  test('door: the CLI --ticket refuses 11 digits by name at $0 and takes 10 (it gets past the number check)', async (t) => {
    const w = await skippedWorld(t);
    const run = (n) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'fwdloop'), 'run', 'tick', '--root', w.root, '--ticket', n], { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', HOME: w.home } });
    const no = run('10000000000');
    assert.match(no.stderr + no.stdout, /--ticket "10000000000" is not a ticket number \(a whole number from 1 to 9,999,999,999\)\. Nothing started/);
    const yes = run('9999999999');
    assert.doesNotMatch(yes.stderr + yes.stdout, /is not a ticket number/);
  });
  describe('door: a listed ticket number (the look)', () => {
    const issue = (number) => ({ number, state: 'OPEN', labels: [], created_at: '2026-10-10T00:00:00Z' });
    function look(t, issues) {
      const dir = tmp(t, 'cap-look');
      const listFile = path.join(dir, 'list.json');
      const configPath = path.join(dir, 'mcp.json');
      writeFileSync(listFile, JSON.stringify(issues));
      writeFileSync(configPath, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { FAKE_MCP_SERVER: '1', FAKE_LIST: listFile } } } }));
      return { dir, run: () => lookTickets({ listUrl: LIST, mcp: { server: 'github', tool: 'list_issues' }, configPath, seen: new Set([1]), last: new Map(), watch: [], perPage: 10 }) };
    }
    test('a 10-digit ticket arrives; an 11-digit one is ignored with ONE recorded reason, no crash', async (t) => {
      const w = look(t, [issue(10000000000), issue(9999999999), issue(2)]);
      const r = await w.run();
      assert.equal(r.ok, true);
      assert.deepEqual(r.found.map((f) => f.number).sort((a, b) => a - b), [2, 9999999999]);
      assert.deepEqual(r.ignored, [10000000000]);
      const ledger = path.join(w.dir, 'ledger.jsonl');
      const out = recordLook(ledger, 'sig', r, 1000);
      assert.deepEqual(out.arrived.sort((a, b) => a - b), [2, 9999999999]);
      const notes = readSeen(ledger, 'sig').filter((x) => x.why);
      assert.equal(notes.length, 1);
      assert.match(notes[0].why, /ignored 1 ticket number over 9,999,999,999: 10000000000/);
    });
  });
});

// ---- the real panel -----------------------------------------------------------------------------------------------------------------------------------

/** put a ticket input with a filter verdict into a run's run.json */
function setVerdict(runDir, number, filter) {
  const f = path.join(runDir, 'run.json');
  const rec = JSON.parse(readFileSync(f, 'utf8'));
  rec.inputs = [...(rec.inputs ?? []), { id: 'issues', source: LIST, ticket: { number, title: 'A ticket' }, ...(filter ? { filter } : {}) }];
  writeFileSync(f, JSON.stringify(rec));
}

/** job2 parked at its (real) ask via the CLI's fake model step, the pattern of test/m4d-ask-scroll.test.js; $0 */
function parked() {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-unsure-ask-'));
  const root = path.join(base, 'flows');
  const src = path.join(base, 'src');
  const home = path.join(base, 'cfg', 'fwdloop');
  for (const d of [root, src, home]) mkdirSync(d, { recursive: true });
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')),
    signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: loadCatalogue().primitives,
  });
  assert.equal(w.ok, true);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, DEEPSEEK_API_KEY: 'test-key-not-real', FWDLOOP_TEST_MODEL_STEP: path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs') };
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'fwdloop'), 'run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'run-1'], { env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  return { root, home, runDir: path.join(root, 'job2', 'runs', 'run-1'), base };
}

async function panel(root, home) {
  delete process.env.FWDLOOP_CONFIG_HOME;
  const h = remember(await createPanelServer({ port: 0, root, settings: { home, env: {} }, scheduler: { intervalMs: 0 } }));
  CLOSERS.push(async () => h.close());
  return h;
}
const j = async (h, p) => (await fetch(`http://127.0.0.1:${h.port}${p}`)).json();

test('API: the grid row and the ask carry the unsure flag; a sure ticket carries neither', async () => {
  const w = parked();
  const h = await panel(w.root, w.home);
  assert.equal((await j(h, '/api/runs/job2/run-1/asks')).asks.some((a) => a.filterUnsure), false, 'no ticket, no flag');
  setVerdict(w.runDir, 7, { outcome: 'run' });
  assert.equal((await j(h, '/api/runs/job2/run-1/asks')).asks.some((a) => a.filterUnsure), false, 'a sure ticket: no flag');
  assert.equal((await j(h, '/api/runs/job2/run-1/grid')).groups.flatMap((g) => g.rows).some((r) => r.unsure), false);
  setVerdict(w.runDir, 8, { outcome: 'run', unsure: 'a priority label is not on the P0-P3 scale, or two priorities are present' });
  const asks = await j(h, '/api/runs/job2/run-1/asks');
  assert.equal(asks.asks.length > 0 && asks.asks.every((a) => a.filterUnsure === true), true);
});

// M13 am2: the grid is only for a Tickets MCP job and these worlds are plain ones, so their run detail is answered as a ticket job's; the grid renderer under test is the same
async function asTicketJob(chrome) {
  await chrome.send('Page.enable');
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){ var f = window.fetch; window.fetch = function(u){ var s = String(u);
      if(/\\/api\\/runs\\/[^/]+\\/[^/]+$/.test(s)) return f.apply(this, arguments).then(function(r){ return r.json().then(function(d){ return new Response(JSON.stringify(Object.assign(d, {hasGrid: true, resultTab: true})), {status: 200, headers: {"content-type": "application/json"}}); }); });
      return f.apply(this, arguments); }; })()`,
  });
}

for (const width of [1280, 390, 320]) {
  test(`browser ${width}: the grey unsure mark is on the unsure row only, the ask page says the one line, nothing spills sideways`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = parked();
    setVerdict(w.runDir, 9999999999, { outcome: 'run', unsure: 'x' });
    const h = await panel(w.root, w.home);
    await asTicketJob(chrome);
    await chrome.open(`http://127.0.0.1:${h.port}/`, width);
    assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden', 20000));
    await chrome.ev('document.getElementById("tab-result").click()');
    assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=result-grid]")', 20000));
    const marks = await chrome.ev('document.querySelectorAll("[data-testid=grid-unsure]").length');
    assert.equal(marks, 1, 'one run, one mark');
    assert.equal(await chrome.ev('document.querySelector("[data-testid=grid-unsure]").textContent'), 'unsure');
    const over = await chrome.ev(`(function(){ var vw = document.documentElement.clientWidth, o = [];
      document.querySelectorAll("#result-body *").forEach(function(e){ var r = e.getBoundingClientRect(); if(r.width === 0 && r.height === 0) return; var g = e.closest(".grid-wrap"); if(g && g !== e) return; if(r.right > vw + 0.5 || r.left < -0.5) o.push(e.tagName + "." + e.className); });
      return { scrollW: document.documentElement.scrollWidth, vw: vw, o: o.slice(0, 5) }; })()`);
    const inCell = await chrome.ev('(function(){ var m = document.querySelector("[data-testid=grid-unsure]").getBoundingClientRect(), r = document.querySelector("[data-testid=grid-unsure]").closest(".tg-rowname").getBoundingClientRect(); return { markRight: Math.round(m.right), cellRight: Math.round(r.right), markW: Math.round(m.width) }; })()');
    assert.ok(inCell.markRight <= inCell.cellRight + 1, `the mark stays inside the name cell ${JSON.stringify(inCell)}`);
    assert.ok(over.scrollW <= over.vw, JSON.stringify(over));
    assert.deepEqual(over.o, [], JSON.stringify(over));
    await chrome.ev('document.getElementById("tab-ask").click()');
    assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=ask-filter-unsure]")', 20000), 'the ask page shows the line');
    assert.equal(await chrome.ev('document.querySelector("[data-testid=ask-filter-unsure]").textContent'), 'the filter was unsure about this ticket');
    assert.equal(await chrome.ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
  });
}

test('browser: a job with NO ask shows the grid mark and no ask line', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const w = await buildWorld();
  setVerdict(path.join(w.root, w.flow ?? 'job2', 'runs', 'run-1'), 9, { outcome: 'run', unsure: 'x' });
  const h = await panel(w.root, w.home);
  const asks = await j(h, `/api/runs/${w.flow ?? 'job2'}/run-1/asks`);
  assert.equal(asks.asks.some((a) => a.filterUnsure), false, 'a run with no ask carries no ask line');
  await asTicketJob(chrome);
  await chrome.open(`http://127.0.0.1:${h.port}/`, 1280);
  assert.ok(await chrome.waitFor('!document.getElementById("tab-result").hidden', 20000));
  await chrome.ev('document.getElementById("tab-result").click()');
  assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=result-grid]")', 20000));
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=grid-unsure]").length === 1 || (document.querySelector("[data-testid=grid-fold-done]") && (document.querySelector("[data-testid=grid-fold-done]").click(), document.querySelectorAll("[data-testid=grid-unsure]").length === 1))'));
  assert.equal(await chrome.ev('document.querySelectorAll("[data-testid=ask-filter-unsure]").length'), 0);
});
