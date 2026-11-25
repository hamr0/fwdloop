// M19 amendment 13 (docs/wiki/the-module-ladder.md): a job needs at least one `~` rule of the person's. Refused at $0 by `fwdloop draft`, the one place; the panel spawns that child and shows its words.
// $0: the test draft provider, a scratch HOME and config home per world, everything removed at exit.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { appendMcpCheck } from '../src/mcp-checks.js';
import { cardFields, cardToProse } from '../src/panel/authorcard.js';
import { createPanelServer } from '../src/panel/server.js';
import { keysForDoor, keysFilePath } from '../src/keysfile.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { tickedConfig } from './m4e-world.mjs';
import { job2Fixture } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE_DRAFT = path.join(HERE, 'fixtures', 'cli-fake-draft-provider.mjs');
const WORDS = 'Add at least one rule (~) for this job — for example what the result must include, or what must stay true.';
// the job #2 fixture carries one `~` (the Ask line's guardrail); the zero-rule job is the same prose with that line cut
const ZERO = () => job2Fixture().prose.replace('   guardrail: nothing goes out before I accept\n', '');
const base = { destination: 'out', capUsd: '0.25', askWait: '1h', inputs: '' };
const proseOf = (job, extra = {}) => cardToProse(cardFields({ ...base, flowName: 'x', job, ...extra }));

const MCP = { flowType: 'mcp', mcp: 'github' };
const TICKETS = { flowType: 'tickets', mcp: 'github', inputs: 'issues: https://github.com/o/r/issues' };

function world(t) {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m19-am13-'));
  const cfg = path.join(work, 'cfg');
  const home = path.join(work, 'home');
  mkdirSync(cfg, { recursive: true, mode: 0o700 });
  mkdirSync(home);
  t.after(() => rmSync(work, { recursive: true, force: true }));
  writeFileSync(path.join(cfg, 'config.json'), JSON.stringify({ monthlyLimitUsd: 5 }));
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: '/nonexistent/never-started' } } }));
  appendMcpCheck(cfg, { server: 'github', path: '~/.mcp.json', at: '2026-10-31T10:00:00Z', ok: true, tools: ['issue_read', 'list_issues'].map((name) => ({ name, hint: null })) });
  const draft = (prose, args = []) => {
    writeFileSync(path.join(work, 'prose.txt'), prose);
    return spawnSync(process.execPath, [BIN, 'draft', path.join(work, 'prose.txt'), '--out', path.join(work, 'out'), '--root', path.join(work, 'flows'), '--name', 'x', ...args], {
      env: { PATH: process.env.PATH ?? '', HOME: home, NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: cfg, FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT }, encoding: 'utf8', timeout: 60000,
    });
  };
  const nothingLeft = () => {
    assert.equal(existsSync(path.join(work, 'out')), false, 'no draft folder');
    assert.equal(existsSync(path.join(cfg, 'runs.jsonl')), false, 'no hold or spend row in runs.jsonl');
    assert.equal(existsSync(path.join(work, 'flows')), false, 'nothing written under the flows root');
  };
  return { work, cfg, draft, nothingLeft };
}

test('zero ~ (plain): refused with the exact words, non-zero exit, no out folder, no hold or spend row', (t) => {
  const w = world(t);
  const r = w.draft(ZERO());
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes(WORDS), r.stderr);
  w.nothingLeft();
});

test('one ~ (plain): the gate lets it through to the draft (the fake provider answers, nothing refused)', (t) => {
  const w = world(t);
  const r = w.draft(job2Fixture().proseG);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(!r.stderr.includes(WORDS));
  assert.equal(existsSync(path.join(w.work, 'out')), true);
});

test('MCP and Tickets MCP with zero ~: refused with the same words, nothing left behind', (t) => {
  const w = world(t);
  const m = w.draft(proseOf('Use the tool to read the page\nSummarise it', MCP), ['--flow-type', 'mcp', '--mcp', 'github']);
  assert.notEqual(m.status, 0);
  assert.ok(m.stderr.includes(WORDS), m.stderr);
  const k = w.draft(proseOf('Read the ticket and say what is broken\nWrite the answer', TICKETS), ['--flow-type', 'tickets', '--mcp', 'github']);
  assert.notEqual(k.status, 0);
  assert.ok(k.stderr.includes(WORDS), k.stderr);
  w.nothingLeft();
});

test('a Tickets job with only a filter ~ is not refused by this gate', (t) => {
  const w = world(t);
  const r = w.draft(proseOf('Read the ticket and say what is broken\n~ priority P1 or P2 only\nWrite the answer', TICKETS), ['--flow-type', 'tickets', '--mcp', 'github']);
  assert.ok(!r.stderr.includes(WORDS), r.stderr);
});

test('a typed `~ !x` and `~ $x` count as the person\'s rule: not refused', (t) => {
  const w = world(t);
  const r = w.draft(ZERO().replace('\n4. ask 30m', '\n   guardrail: !agent says so\n4. ask 30m'));
  assert.ok(!r.stderr.includes(WORDS), r.stderr);
});

// the panel door: a real panel, Start drafting spawns the real `fwdloop draft` child; the child's own words are what the card shows
const HANDLES = [];
const ROOTS = [];
after(async () => {
  for (const root of ROOTS) {
    const dd = path.join(root, '.drafts');
    if (!existsSync(dd)) continue;
    for (const id of readdirSync(dd)) {
      try {
        const pid = JSON.parse(readFileSync(path.join(dd, id, 'pid.json'), 'utf8'));
        if (isFwdloopAlive(pid.pid, pid.procStart) === true) process.kill(-pid.pid, 'SIGKILL');
      } catch { /* none */ }
    }
  }
  await Promise.all(HANDLES.map((h) => h.close()));
});

function rq(port, { method = 'GET', url = '/', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const hd = { host: `127.0.0.1:${port}`, ...cookieHeader(port) };
    if (method === 'POST') hd.origin = `http://127.0.0.1:${port}`;
    if (data !== undefined) hd['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: hd, agent: false }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => { const text = Buffer.concat(ch).toString('utf8'); resolve({ status: res.statusCode, text, json() { try { return JSON.parse(text); } catch { return null; } } }); });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

test('the panel door: Start drafting on a zero-~ card ends with the child\'s output holding the exact words, nothing spent', async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m19-am13-p-'));
  const root = path.join(work, 'flows');
  const outDir = path.join(work, 'out');
  const home = path.join(work, 'cfg', 'fwdloop');
  for (const d of [root, outDir]) mkdirSync(d);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), 'DEEPSEEK_API_KEY=sk-canary-m19-am13-0000\n', { mode: 0o600 });
  writeFileSync(path.join(home, 'config.json'), JSON.stringify(tickedConfig({})));
  const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT };
  ROOTS.push(root);
  try {
    const h = remember(await createPanelServer({ port: 0, root, settings: { home, env: {} }, author: { loadEnv: () => keysForDoor({ env, keysHome: home }) } }));
    HANDLES.push(h);
    const card = { flowName: 'job2', job: 'Read the notes and list the open items\nWrite a short summary', capUsd: '0.25', askWait: '1h', destination: outDir, provider: 'DEEPSEEK_API_KEY', model: 'fake-ticked', inputs: '' };
    const r = await rq(h.port, { method: 'POST', url: '/api/author/draft', body: card });
    assert.equal(r.status, 202, r.text);
    const id = r.json().draftId;
    const log = path.join(root, '.drafts', id, 'child.log');
    const t0 = Date.now();
    while (!(existsSync(log) && readFileSync(log, 'utf8').includes(WORDS))) {
      if (Date.now() - t0 > 20000) throw new Error(`the child never said the words: ${existsSync(log) ? readFileSync(log, 'utf8') : 'no log'}`);
      await sleep(25); // eslint-disable-line no-await-in-loop
    }
    assert.equal(existsSync(path.join(root, '.drafts', id, 'draft')), false, 'no draft folder');
  } finally {
    // the after hook kills any child; the work dir goes with the mkdtemp tracker
    rmSync(work, { recursive: true, force: true });
  }
});
