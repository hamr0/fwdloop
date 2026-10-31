// M13 piece 3 (docs/wiki/the-module-ladder.md, M13 scope items 1 and 2): where MCPs come from, and Settings > MCP. $0, no model call, no network.
// REAL: createSettings (the routes), mcpSources / mcpConfigFor, bare-agent's listServerTools and bridge, the panel page in headless chromium. FAKE: the MCP servers
// (test/fixtures/cwd-mcp-server.mjs writes a marker file at start, so "was it started" is a file; test/fixtures/fake-mcp-server.mjs answers a ticket read).
// HOME is a scratch dir for every test (os.homedir() follows it); the real ~/.mcp.json and ~/.config/fwdloop are never touched. Each test goes red with its one src change taken out.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createSettings } from '../src/panel/settings.js';
import { mcpConfigFor, mcpSources } from '../src/mcp-sources.js';
import { readTicketMcp } from '../src/ticket-mcp.js';
import { createPanelServer } from '../src/panel/server.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MARK = path.join(FIX, 'cwd-mcp-server.mjs');
const FAKE = path.join(FIX, 'fake-mcp-server.mjs');
const KEY = 'KEYCANARY-m13p3-7c1e9a';
const CMD = 'CMDCANARY-m13p3-4b2d8f';

const HANDLES = [];
const CLOSERS = [];
after(async () => { for (const h of HANDLES) await h.close(); for (const c of CLOSERS) await c(); });

/** HOME, the cwd and FWDLOOP_CONFIG_HOME are swapped for scratch ones; restored after the test. `files` = {relative path under HOME: json}. */
function world(t, files = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p3-'));
  const home = path.join(base, 'home');
  const cfg = path.join(base, 'cfg');
  const root = path.join(base, 'root');
  const proj = path.join(base, 'proj');
  for (const d of [home, cfg, root, proj]) mkdirSync(d, { recursive: true });
  for (const [rel, json] of Object.entries(files)) { mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); writeFileSync(path.join(home, rel), JSON.stringify(json)); }
  const old = { HOME: process.env.HOME, CFG: process.env.FWDLOOP_CONFIG_HOME, cwd: process.cwd() };
  process.env.HOME = home;
  process.env.FWDLOOP_CONFIG_HOME = cfg;
  process.chdir(proj);
  t.after(() => {
    process.chdir(old.cwd);
    process.env.HOME = old.HOME;
    if (old.CFG === undefined) delete process.env.FWDLOOP_CONFIG_HOME; else process.env.FWDLOOP_CONFIG_HOME = old.CFG;
    rmSync(base, { recursive: true, force: true });
  });
  const settings = createSettings({ home: cfg, root, env: {} });
  const call = (method, pathname, body) => settings.handle({ method, pathname, query: new URLSearchParams(), body });
  return { base, home, cfg, root, proj, settings, call, get: () => call('GET', '/api/settings/mcp'), post: (p, b) => call('POST', p, b) };
}
const marker = (dir) => path.join(dir, 'started.txt');
const markServer = (out, extra = {}) => ({ command: process.execPath, args: [MARK], env: { CWD_OUT: out, ...extra } });
const fakeServer = (extra = {}) => ({ command: process.execPath, args: [FAKE], env: { FAKE_MCP_SERVER: '1', ...extra } });
const find = (body, name) => body.places.flatMap((p) => p.servers.map((s) => ({ ...s, place: p.path }))).filter((s) => s.name === name);

test('a project folder .mcp.json is never read: its server is not listed, not checkable, never started', async (t) => {
  const w = world(t, { '.mcp.json': { mcpServers: { github: fakeServer() } } });
  const out = marker(w.base);
  // the planted file is in the cwd (the "project folder") and holds a server that would write a marker if it were ever started
  writeFileSync(path.join(w.proj, '.mcp.json'), JSON.stringify({ mcpServers: { canary: markServer(out) } }));
  const r = await w.get();
  assert.equal(find(r.body, 'canary').length, 0, 'the project server is listed');
  assert.equal(mcpConfigFor('canary'), null);
  const c = await w.post('/api/settings/mcp-check', { server: 'canary' });
  assert.equal(c.body.refused, 'unknown-mcp');
  assert.equal(existsSync(out), false, 'the project server was started');
});

test('check tools starts a server only on a press: a GET (and so a page load) starts nothing; the press starts that one, once', async (t) => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p3-mk-')), 'started.txt');
  const w = world(t, { '.mcp.json': { mcpServers: { canary: markServer(out) } } });
  await w.get(); await w.get();
  assert.equal(existsSync(out), false, 'a GET started the server');
  const c = await w.post('/api/settings/mcp-check', { server: 'canary' });
  assert.deepEqual([c.status, c.body.ok, c.body.checked], [200, true, true]);
  assert.equal(existsSync(out), true, 'the press did not start it');
  rmSync(path.dirname(out), { recursive: true, force: true });
});

test('a key or a command is on no route and not on the page (also when the server cannot start and the library message holds the command)', async (t) => {
  const w = world(t, {
    '.mcp.json': { mcpServers: { good: fakeServer({ GITHUB_TOKEN: KEY, FAKE_NOTE: CMD }), ghost: { command: `/nonexistent/${CMD}/serve`, args: ['--token', KEY], env: { TOKEN: KEY } } } },
  });
  const seen = [];
  seen.push(JSON.stringify((await w.get()).body));
  seen.push(JSON.stringify((await w.post('/api/settings/mcp-check', { server: 'good' })).body));
  const bad = await w.post('/api/settings/mcp-check', { server: 'ghost' });
  seen.push(JSON.stringify(bad.body));
  seen.push(JSON.stringify((await w.get()).body));
  seen.push(JSON.stringify((await w.post('/api/settings/mcp-path', { path: '~/.claude.json' })).body));
  seen.push(JSON.stringify((await w.get()).body));
  seen.push(readFileSync(path.join(w.cfg, 'mcp-checks.jsonl'), 'utf8'));
  const ghost = find(JSON.parse(seen[3]), 'ghost')[0];
  assert.equal(ghost.check.ok, false, 'the failed start is recorded as a failed check');
  for (const text of seen) { assert.ok(!text.includes(KEY), 'a key is shown'); assert.ok(!text.includes(CMD), 'a command is shown'); }
  // the page the panel serves (server side, before any script runs)
  const h = remember(await createPanelServer({ port: 0, root: w.root, settings: { home: w.cfg, env: {} } }));
  HANDLES.push(h);
  const html = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: h.port, path: '/', headers: { host: `127.0.0.1:${h.port}`, ...cookieHeader(h.port) } }, (res) => { const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => resolve(Buffer.concat(ch).toString('utf8'))); }).on('error', reject);
  });
  assert.ok(!html.includes(KEY) && !html.includes(CMD));
});

test('same name in two paths: the first in the list wins, the later one is marked shadowed, and the check and the start use the first file', async (t) => {
  const out1 = path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p3-a-')), 'one.txt');
  const out2 = path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p3-b-')), 'two.txt');
  t.after(() => { rmSync(path.dirname(out1), { recursive: true, force: true }); rmSync(path.dirname(out2), { recursive: true, force: true }); });
  const w = world(t, { '.mcp.json': { mcpServers: { dup: markServer(out1) } }, '.cursor/mcp.json': { mcpServers: { dup: markServer(out2), other: markServer(out2) } } });
  const r = await w.get();
  const dup = find(r.body, 'dup');
  assert.deepEqual(dup.map((s) => [s.place, s.shadowedBy]), [['~/.mcp.json', null], ['~/.cursor/mcp.json', '~/.mcp.json']]);
  assert.equal(find(r.body, 'other')[0].shadowedBy, null);
  assert.equal(mcpConfigFor('dup').file, path.join(w.home, '.mcp.json'));
  const c = await w.post('/api/settings/mcp-check', { server: 'dup' });
  assert.equal(c.body.ok, true);
  assert.equal(existsSync(out1), true, 'the first (winning) server was not the one started');
  assert.equal(existsSync(out2), false, 'the shadowed server was started');
});

test('a remote server (no start command) is listed, marked remote, refused a check, and refused by a run reader; nothing starts', async (t) => {
  const w = world(t, { '.mcp.json': { mcpServers: { beeper: { type: 'http', url: 'https://example.invalid/mcp' } } } });
  const r = await w.get();
  assert.equal(find(r.body, 'beeper')[0].remote, true);
  const c = await w.post('/api/settings/mcp-check', { server: 'beeper' });
  assert.equal(c.body.refused, 'remote-mcp');
  assert.equal(existsSync(path.join(w.cfg, 'mcp-checks.jsonl')), false, 'a refused press wrote a check line');
  const read = await readTicketMcp({ listUrl: 'https://github.com/o/r/issues', number: 1, mcp: { server: 'beeper', tools: ['issue_read'] } });
  assert.deepEqual([read.ok, read.error], [false, 'beeper is a remote server, not supported yet']);
});

test('an added path round-trips through config.json: it is listed (added), its servers count, remove takes it away, other settings and the MCP files stay as they were', async (t) => {
  const w = world(t, { '.mcp.json': { mcpServers: { github: fakeServer() } }, '.claude.json': { mcpServers: { barebrowse: fakeServer() } } });
  writeFileSync(path.join(w.cfg, 'config.json'), JSON.stringify({ monthlyLimitUsd: 7 }));
  const filesBefore = [path.join(w.home, '.mcp.json'), path.join(w.home, '.claude.json')].map((f) => readFileSync(f, 'utf8'));
  assert.equal(find((await w.get()).body, 'barebrowse').length, 0, 'listed before it was added');
  const add = await w.post('/api/settings/mcp-path', { path: '~/.claude.json' });
  assert.equal(add.body.ok, true);
  assert.deepEqual(JSON.parse(readFileSync(path.join(w.cfg, 'config.json'), 'utf8')), { monthlyLimitUsd: 7, mcpPaths: ['~/.claude.json'] });
  const after1 = (await w.get()).body.places.find((p) => p.path === '~/.claude.json');
  assert.deepEqual([after1.added, after1.status, after1.servers.map((s) => s.name)], [true, 'found', ['barebrowse']]);
  // the same path again, a default place, a relative path and a line break are refused with nothing saved
  for (const [p, refused] of [['~/.claude.json', 'path-listed'], [path.join(w.home, '.claude.json'), 'path-listed'], ['~/.mcp.json', 'path-listed'], ['claude.json', 'bad-path'], ['/a\n/b', 'bad-path'], ['', 'bad-path']]) {
    assert.equal((await w.post('/api/settings/mcp-path', { path: p })).body.refused, refused, p);
  }
  assert.deepEqual(JSON.parse(readFileSync(path.join(w.cfg, 'config.json'), 'utf8')).mcpPaths, ['~/.claude.json']);
  assert.equal((await w.post('/api/settings/mcp-path-remove', { path: '~/.mcp.json' })).body.refused, 'path-unknown', 'a default place can be removed');
  assert.equal((await w.post('/api/settings/mcp-path-remove', { path: '~/.claude.json' })).body.ok, true);
  assert.deepEqual(JSON.parse(readFileSync(path.join(w.cfg, 'config.json'), 'utf8')), { monthlyLimitUsd: 7 });
  assert.deepEqual([path.join(w.home, '.mcp.json'), path.join(w.home, '.claude.json')].map((f) => readFileSync(f, 'utf8')), filesBefore, 'an MCP config file was written');
});

test('a run reader and the step bridge take the winning file: a server found only in a later place, or only in an added path, is read from there', async (t) => {
  const w = world(t, { '.cursor/mcp.json': { mcpServers: { github: fakeServer() } }, 'extra/servers.json': { mcpServers: { only_added: fakeServer() } } });
  assert.equal((await w.post('/api/settings/mcp-path', { path: '~/extra/servers.json' })).body.ok, true);
  assert.equal(mcpConfigFor('github').file, path.join(w.home, '.cursor', 'mcp.json'));
  assert.equal(mcpConfigFor('only_added').file, path.join(w.home, 'extra', 'servers.json'));
  for (const server of ['github', 'only_added']) {
    const r = await readTicketMcp({ listUrl: 'https://github.com/o/r/issues', number: 1, mcp: { server, tools: ['issue_read'] } });
    assert.equal(r.ok, true, `${server}: ${r.error}`);
  }
});

test('the check log is append-only: two presses are two lines, the first line is never rewritten, and the page reads the newest', async (t) => {
  const w = world(t, { '.mcp.json': { mcpServers: { github: fakeServer() } } });
  const file = path.join(w.cfg, 'mcp-checks.jsonl');
  await w.post('/api/settings/mcp-check', { server: 'github' });
  const one = readFileSync(file, 'utf8');
  assert.equal(one.split('\n').filter(Boolean).length, 1);
  const first = JSON.parse(one);
  assert.deepEqual(Object.keys(first).sort(), ['at', 'ok', 'path', 'server', 'tools']);
  assert.deepEqual(first.tools.map((x) => x.name), ['issue_read', 'list_issues']);
  await w.post('/api/settings/mcp-check', { server: 'github' });
  const two = readFileSync(file, 'utf8');
  assert.equal(two.split('\n').filter(Boolean).length, 2);
  assert.ok(two.startsWith(one), 'the first line was rewritten');
  // a newer line (here a later failed press, written by hand into the log) is the one the page shows
  writeFileSync(file, `${two}${JSON.stringify({ server: 'github', path: '~/.mcp.json', at: '2099-01-01T00:00:00.000Z', ok: false, error: 'The check failed.' })}\n`);
  assert.deepEqual(find((await w.get()).body, 'github')[0].check, { at: '2099-01-01T00:00:00.000Z', ok: false, error: 'The check failed.' });
});

test('use counts come from what runs record: ticket reads in run.json, tool rows in diary.jsonl; a denied call is counted apart, a torn row skipped', async (t) => {
  const w = world(t, { '.mcp.json': { mcpServers: { github: fakeServer(), git: fakeServer() } } });
  const run = (n) => { const d = path.join(w.root, 'flow-a', 'runs', `run-${n}`); mkdirSync(d, { recursive: true }); return d; };
  const row = (o) => `${JSON.stringify({ kind: 'tool', decision: 'allow', ...o })}\n`;
  writeFileSync(path.join(run(1), 'run.json'), JSON.stringify({ inputs: [{ mcp: { server: 'github', calls: [{ tool: 'issue_read' }, { tool: 'issue_read' }] } }] }));
  utimesSync(path.join(run(1), 'run.json'), new Date('2026-10-29T08:00:00Z'), new Date('2026-10-29T08:00:00Z'));
  writeFileSync(path.join(run(2), 'diary.jsonl'), row({ tool: 'github_list_issues', at: '2026-10-30T10:00:00.000Z' }) + row({ tool: 'github_create_issue', at: '2026-10-30T10:01:00.000Z', decision: 'deny' })
    + row({ tool: 'git_status', at: '2026-10-30T10:02:00.000Z' }) + row({ tool: 'read', at: '2026-10-30T10:03:00.000Z' }) + '{"kind":"tool","tool":"github_is');
  const r = find((await w.get()).body, 'github')[0];
  assert.equal(r.use.last, '2026-10-30T10:00:00.000Z');
  assert.equal(r.use.calls, 3);
  assert.equal(r.use.runs, 2);
  assert.equal(r.use.denied, 1);
  assert.deepEqual(r.use.tools, { issue_read: 2, list_issues: 1 });
  const g = find((await w.get()).body, 'git')[0];
  assert.deepEqual([g.use.calls, g.use.runs, g.use.denied, g.use.tools], [1, 1, 0, { status: 1 }], 'github_ rows were counted for the shorter name "git"');
});

const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
for (const width of [1280, 390, 320]) {
  test(`the MCP tab at ${width}px: unique element ids, paths open and MCPs folded, a press lists the tools, no horizontal scroll, no key or command on the page`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const tools = JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ name: `tool_${i}`, annotations: i === 0 ? { readOnlyHint: true } : {} })));
    const w = world(t, { '.mcp.json': { mcpServers: { github: { ...fakeServer({ GITHUB_TOKEN: KEY, FAKE_TOOLS: tools }), args: [FAKE, CMD] } } }, '.claude.json': { mcpServers: { beeper: { type: 'http', url: 'https://example.invalid/mcp' } } } });
    await w.post('/api/settings/mcp-path', { path: '~/.claude.json' });
    const h = remember(await createPanelServer({ port: 0, root: w.root, settings: { home: w.cfg, env: {} } }));
    HANDLES.push(h);
    await chrome.open(`http://127.0.0.1:${h.port}/`, width);
    await chrome.ev('document.getElementById("settings-open").click()');
    await chrome.ev('document.getElementById("stab-mcp").click()');
    assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=mcp-row]").length === 2'), 'the rows did not paint');
    const ids = await chrome.ev('(function(){var seen={},dup=[];Array.prototype.forEach.call(document.querySelectorAll("[id]"),function(e){if(seen[e.id])dup.push(e.id);seen[e.id]=1;});return JSON.stringify(dup);})()');
    assert.equal(ids, '[]', `repeated element ids: ${ids}`);
    assert.equal(await chrome.ev('Array.prototype.every.call(document.querySelectorAll("[data-testid=mcp-path]"), function(g){ return g.getAttribute("data-open") === "1" || !g.querySelector(".mc-kids"); })'), true, 'a path starts folded');
    assert.equal(await chrome.ev('Array.prototype.every.call(document.querySelectorAll("[data-testid=mcp-row]"), function(r){ return r.getAttribute("data-open") === "0"; })'), true, 'an MCP starts open');
    assert.equal(await chrome.ev('document.querySelectorAll("[data-testid=mcp-tool]").length'), 0, 'tools listed before a press');
    assert.equal(existsSync(path.join(w.cfg, 'mcp-checks.jsonl')), false, 'a page load pressed check tools');
    await chrome.ev('document.querySelector("[data-testid=mcp-check]").click()');
    assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=mcp-tool]").length === 5'), 'five tools show, the rest behind +N more');
    assert.match(await chrome.ev('document.querySelector(".pv-more .pv-add[data-more]").textContent'), /^\+3 more$/);
    await chrome.ev('document.querySelector("[data-more]").click()');
    assert.equal(await chrome.ev('document.querySelectorAll("[data-testid=mcp-tool]").length'), 8);
    await chrome.ev('document.getElementById("mcp-add-open").click()');
    const spill = await chrome.ev('JSON.stringify([document.documentElement.scrollWidth - document.documentElement.clientWidth, (function(){var w=document.querySelector("[data-testid=mcp-table-wrap]");return w.scrollWidth-w.clientWidth;})()])');
    assert.equal(spill, '[0,0]', 'the page or the table scrolls sideways');
    const html = await chrome.ev('document.documentElement.outerHTML');
    assert.ok(!html.includes(KEY) && !html.includes(CMD), 'a key or command is in the page');
    // adding a path from the page goes through the route and shows (added) with "not found"
    await chrome.ev('document.getElementById("mcp-add-in").value = "/nowhere/m13p3.json"; document.getElementById("mcp-add-go").click()');
    assert.ok(await chrome.waitFor('document.body.textContent.indexOf("/nowhere/m13p3.json") >= 0'), 'the added path did not show');
    assert.ok(JSON.parse(readFileSync(path.join(w.cfg, 'config.json'), 'utf8')).mcpPaths.includes('/nowhere/m13p3.json'));
  });
}

for (const width of [1280, 390, 320]) {
  test(`the MCP tab at ${width}px: a shadowed MCP says "same name as above, not used", an unreadable file says "can't be read", a failed check is one fixed red sentence; no sideways scroll`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = world(t, {
      '.mcp.json': { mcpServers: { dup: fakeServer(), ghost: { command: `/nonexistent/${CMD}/serve`, args: ['--token', KEY] } } },
      '.cursor/mcp.json': { mcpServers: { dup: fakeServer() } },
    });
    mkdirSync(path.join(w.home, '.claude'), { recursive: true });
    writeFileSync(path.join(w.home, '.claude', 'mcp_servers.json'), '{ not json');
    const h = remember(await createPanelServer({ port: 0, root: w.root, settings: { home: w.cfg, env: {} } }));
    HANDLES.push(h);
    await chrome.open(`http://127.0.0.1:${h.port}/`, width);
    await chrome.ev('document.getElementById("settings-open").click()');
    await chrome.ev('document.getElementById("stab-mcp").click()');
    assert.ok(await chrome.waitFor('document.querySelectorAll("[data-testid=mcp-row]").length === 3'), 'the rows did not paint');
    const heads = JSON.parse(await chrome.ev('JSON.stringify(Array.prototype.map.call(document.querySelectorAll("[data-testid=mcp-path] .mc-grow"), function(e){ return e.textContent; }))'));
    assert.ok(heads.some((x) => x.includes('~/.claude/mcp_servers.json') && x.endsWith("can't be read")), JSON.stringify(heads));
    assert.ok(heads.some((x) => x.includes('~/.config/Claude/claude_desktop_config.json') && x.endsWith('not found')), JSON.stringify(heads));
    const rows = JSON.parse(await chrome.ev('JSON.stringify(Array.prototype.map.call(document.querySelectorAll("[data-testid=mcp-row]"), function(r){ return r.querySelector("code").textContent + "|" + r.querySelectorAll(".pv-cell")[1].textContent + "|" + (r.querySelector("[data-testid=mcp-check]") ? 1 : 0) + "|" + (r.querySelector(".mc-use") ? 1 : 0); }))'));
    assert.ok(rows.includes('dup|Toolssame name as above, not used|0|0'), JSON.stringify(rows));
    // a failed check: one fixed sentence under that MCP, never the library's words
    await chrome.ev('Array.prototype.forEach.call(document.querySelectorAll("[data-testid=mcp-row]"), function(r){ if(r.querySelector("code").textContent === "ghost") r.querySelector("[data-testid=mcp-check]").click(); })');
    assert.ok(await chrome.waitFor('document.querySelector(".pv-more .hint.bad") !== null'), 'no red sentence');
    const red = JSON.parse(await chrome.ev('JSON.stringify(Array.prototype.map.call(document.querySelectorAll(".pv-more .hint.bad"), function(e){ return e.textContent; }))'));
    assert.deepEqual(red, ['The server did not start.']);
    assert.equal(await chrome.ev('document.documentElement.scrollWidth - document.documentElement.clientWidth'), 0, 'the page scrolls sideways');
    assert.equal(await chrome.ev('(function(){var x=document.querySelector("[data-testid=mcp-table-wrap]");return x.scrollWidth-x.clientWidth;})()'), 0, 'the table scrolls sideways');
    const html = await chrome.ev('document.documentElement.outerHTML');
    assert.ok(!html.includes(KEY) && !html.includes(CMD), 'a key or command is in the page');
  });
}

test('mcpSources reads only explicit places: a scratch HOME with nothing in it lists the four places as missing', async (t) => {
  const w = world(t);
  assert.deepEqual(mcpSources({ home: w.cfg }).places.map((p) => [p.path, p.status]), [['~/.mcp.json', 'missing'], ['~/.claude/mcp_servers.json', 'missing'], ['~/.config/Claude/claude_desktop_config.json', 'missing'], ['~/.cursor/mcp.json', 'missing']]);
  assert.ok(readdirSync(w.cfg).length === 0 && statSync(w.cfg).isDirectory(), 'listing wrote into the config home');
});
