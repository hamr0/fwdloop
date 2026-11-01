// M13 am4: (1) Reuse workflow shows the job's Flow type and MCP; a change is a changed job (Start drafting, new workflow); unchanged = Reuse as before.
// (2) The Job tab shows flow type, MCP, signed tools (name + hint), and for Tickets the filter and watched field; a plain job's Job tab is unchanged. $0, no model.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, world } from './m4e-world.mjs';
import { ticketJob } from './m12-p2-world.mjs';

killChildrenAfter();
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');

const check = (w, body) => w.post('/api/author/reuse-check', body);
const job = async (w, flow) => (await w.get(`/api/runs/${flow}/seed-pass/job`)).json();
const entryOf = async (w, flow) => (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === flow);

async function mixed() {
  const w = await world({ limit: 5 });
  await w.signedFlow();   // job2: plain
  w.seedPassed('job2');
  ticketJob(w.root, 'tk', { flowType: 'tickets' });
  ticketJob(w.root, 'gm', { flowType: 'mcp' });
  w.seedPassed('tk');
  w.seedPassed('gm');
  rmSync(path.join(w.root, '.drafts'), { recursive: true, force: true });
  writeFileSync(path.join(w.home, 'mcp-checks.jsonl'), `${JSON.stringify({
    server: 'github', path: '/x/.mcp.json', at: '2026-10-30T10:00:00Z', ok: true, tools: [{ name: 'issue_read', hint: 'read-only' }, { name: 'other', hint: null }],
  })}\n`);
  return w;
}

test('getRunJob: a plain job payload carries none of the MCP keys', async () => {
  const w = await mixed();
  const j = await job(w, 'job2');
  for (const k of ['flowType', 'mcp', 'tools', 'ticketFilter', 'ticketWatch']) assert.equal(Object.hasOwn(j, k), false, k);
});

test('getRunJob: an MCP job has flow type, server and tools with hints; a tool the check never named has hint null', async () => {
  const w = await mixed();
  const j = await job(w, 'gm');
  assert.equal(j.flowType, 'mcp');
  assert.equal(j.mcp, 'github');
  assert.deepEqual(j.tools, [{ name: 'issue_read', hint: 'read-only' }, { name: 'list_issues', hint: null }]);
  assert.equal(Object.hasOwn(j, 'ticketFilter'), false);
});

test('getRunJob: no check at all gives every hint null; a Tickets job adds the filter and the watched field', async () => {
  const w = await mixed();
  writeFileSync(path.join(w.home, 'mcp-checks.jsonl'), '');
  const j = await job(w, 'tk');
  assert.equal(j.flowType, 'tickets');
  assert.deepEqual(j.tools.map((t) => t.hint), [null, null]);
  const decl = JSON.parse(readFileSync(path.join(w.root, 'tk', 'declaration.json'), 'utf8'));
  assert.deepEqual(j.ticketFilter, decl.ticketFilter ?? null);
  assert.deepEqual(j.ticketWatch, decl.ticketWatch ?? null);
  assert.equal(Object.hasOwn(j, 'ticketFilter'), true);
  assert.equal(Object.hasOwn(j, 'ticketWatch'), true);
});

test('reuseCheck: flowType and mcp equal to the signed values answer exactly what the body without them answers', async () => {
  const w = await mixed();
  for (const flow of ['job2', 'gm']) {
    // eslint-disable-next-line no-await-in-loop
    const e = await entryOf(w, flow);
    const base = { flow, job: e.edit.card.job, inputs: w.inputs() };
    // eslint-disable-next-line no-await-in-loop
    const without = await check(w, base);
    // eslint-disable-next-line no-await-in-loop
    const withIt = await check(w, { ...base, flowType: e.flowType, mcp: e.mcp ?? '' });
    assert.equal(withIt.status, without.status, flow);
    assert.equal(withIt.text, without.text, flow);
  }
  const e = await entryOf(w, 'job2');
  assert.equal((await check(w, { flow: 'job2', job: e.edit.card.job, inputs: w.inputs(), flowType: 'plain', mcp: '' })).json().kind, 'run');
});

test('reuseCheck: a changed flow type or MCP is a changed job: draft with a suggested name', async () => {
  const w = await mixed();
  const plain = await entryOf(w, 'job2');
  const gm = await entryOf(w, 'gm');
  const cases = [
    ['job2', plain, { flowType: 'mcp', mcp: 'github' }],
    ['gm', gm, { flowType: 'plain', mcp: '' }],
    ['gm', gm, { flowType: 'tickets', mcp: 'github' }],
    ['gm', gm, { flowType: 'mcp', mcp: 'other-server' }],
  ];
  for (const [flow, e, over] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const r = await check(w, { flow, job: e.edit.card.job, inputs: w.inputs(), ...over });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json().kind, 'draft', JSON.stringify(over));
    assert.match(r.json().suggestedName, new RegExp(`^${flow}-\\d+$`));
  }
});

// ---- the page --------------------------------------------------------------------------------------------------------------------------------------
const fn = (name) => {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};
function renderJob(job) {
  const els = {};
  const mk = (tag) => {
    const e = { tag, children: [], className: '', textContent: '', hidden: false, attrs: {}, appendChild(c) { e.children.push(c); return c; }, setAttribute(k, v) { e.attrs[k] = v; } };
    Object.defineProperty(e, 'innerHTML', { set() { e.children = []; }, get() { return ''; } });
    return e;
  };
  const document = { getElementById: (id) => (els[id] ??= mk('div')), createElement: (t) => mk(t) };
  const src = ['duration', 'plainWait', 'textDiv', 'sheetBlockLines', 'renderRowsField', 'readableDateTime', 'stepSummaryText', 'jobStepFold', 'paintJobPlan', 'renderJob'].map(fn).join('\n');
  new Function('document', `${src}\nreturn { renderJob };`)(document).renderJob(job);
  return els;
}
const BASE = {
  resolved: true, flow: 'f', model: null, modelWhy: 'x', prose: [{ line: 1, text: 'a' }], guardrails: [], asks: [], sends: [], sources: [], capUsd: 0.5, redoCap: 3, signature: null, signatureWhy: 'unsigned', plan: { steps: [], notChecked: { label: 'x', items: [], readNotes: [], recorded: false } },
};

test('page: the Job tab renders the MCP rows for an MCP and a Tickets job, with the five signed words only, and none for a plain job', () => {
  const plain = renderJob(BASE);
  assert.equal(plain['details-mcp-field'].hidden, true);
  assert.equal(plain['details-mcp'].children.length, 0);
  const mcp = renderJob({ ...BASE, flowType: 'mcp', mcp: 'github', tools: [{ name: 'issue_read', hint: 'read-only' }, { name: 'list_issues', hint: null }] });
  assert.equal(mcp['details-mcp-field'].hidden, false);
  assert.deepEqual(mcp['details-mcp'].children.map((c) => c.textContent), ['flow type · MCP', 'MCP · github', 'tools · issue_read (read-only)', 'tools · list_issues']);
  const tk = renderJob({ ...BASE, flowType: 'tickets', mcp: 'github', tools: [{ name: 'list_issues', hint: null }], ticketFilter: { priority: ['P1'] }, ticketWatch: ['state'] });
  assert.deepEqual(tk['details-mcp'].children.map((c) => c.textContent), ['flow type · Tickets MCP', 'MCP · github', 'tools · list_issues', 'ticket filter · {"priority":["P1"]}', 'watched field · state']);
});

const BTN = 'document.getElementById("chat-main-btn")';
async function openReuse(w, flow) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(() => chrome.close());
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  assert.ok(await chrome.waitFor('!document.querySelector(\'input[name="jf-mode"][value="run"]\').disabled'));
  await chrome.ev('document.querySelector(\'input[name="jf-mode"][value="run"]\').click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-flow") && !document.getElementById("jf-run").hidden'));
  await chrome.ev(`document.getElementById("jf-run-flow").focus(); document.getElementById("jf-run-flow").value = ${JSON.stringify(flow)}; document.getElementById("jf-run-flow").dispatchEvent(new Event("input", {bubbles: true}))`);
  assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=rw-item]").length > 0'));
  await chrome.ev('document.querySelector("[data-testid=rw-item]").click()');
  assert.ok(await chrome.waitFor('document.getElementById("jf-run-jobbox") && document.getElementById("jf-run-jobbox").value.length > 0'));
  return chrome;
}

test('page: the Reuse box shows Flow type and MCP filled in; unchanged keeps Run, changing either flips the button to Start drafting', { skip: SKIP && 'no browser' }, async (t) => {
  const w = await mixed();
  const c = await openReuse(w, 'gm');
  if (!c) { t.skip('no chromium installed'); return; }
  assert.equal(await c.ev('document.getElementById("jf-run-flowtype").value'), 'mcp');
  assert.deepEqual(await c.ev('Array.from(document.getElementById("jf-run-flowtype").options).map(function(x){ return x.textContent; })'), ['plain', 'MCP', 'Tickets MCP']);
  assert.equal(await c.ev('document.getElementById("jf-run-mcp-field").hidden'), false);
  assert.equal(await c.ev('document.getElementById("jf-run-mcp").value'), 'github');
  assert.equal(await c.ev('document.getElementById("jf-run-mcp-manage").textContent'), 'manage in Settings > MCP');
  assert.ok(await c.waitFor(`/^Run now/.test(${BTN}.textContent)`), `label: ${await c.ev(`${BTN}.textContent`)}`);
  await new Promise((r) => setTimeout(r, 600));
  assert.match(await c.ev(`${BTN}.textContent`), /^Run now/, 'unchanged Reuse stays Run');
  await c.ev('(function(){ var s = document.getElementById("jf-run-flowtype"); s.value = "tickets"; s.dispatchEvent(new Event("input", {bubbles: true})); s.dispatchEvent(new Event("change", {bubbles: true})); })()');
  assert.ok(await c.waitFor(`${BTN}.textContent === "Start drafting"`), `label: ${await c.ev(`${BTN}.textContent`)}`);
  await c.ev('(function(){ var s = document.getElementById("jf-run-flowtype"); s.value = "mcp"; s.dispatchEvent(new Event("input", {bubbles: true})); s.dispatchEvent(new Event("change", {bubbles: true})); })()');
  assert.ok(await c.waitFor(`/^Run now/.test(${BTN}.textContent)`), 'undoing the change asks again');
});

test('page: a plain job reuses with plain and no MCP pick shown', { skip: SKIP && 'no browser' }, async (t) => {
  const w = await mixed();
  const c = await openReuse(w, 'job2');
  if (!c) { t.skip('no chromium installed'); return; }
  assert.equal(await c.ev('document.getElementById("jf-run-flowtype").value'), 'plain');
  assert.equal(await c.ev('document.getElementById("jf-run-mcp-field").hidden'), true);
});

test('page: the Reuse box ids are new and unique, and reuseBody / startReuseDraft read them', () => {
  for (const id of ['jf-run-flowtype', 'jf-run-mcp', 'jf-run-mcp-field', 'jf-run-mcp-manage', 'details-mcp']) assert.equal(PAGE.split(` id="${id}"`).length - 1, 1, id);
  assert.match(fn('reuseBody'), /runFlowTypeEl\.value/);
  assert.match(fn('startReuseDraft'), /setFlow\(runFlowTypeEl\.value/);
  assert.doesNotMatch(fn('startReuseDraft'), /setFlow\(f\./);
});
