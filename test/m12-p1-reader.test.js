// M12 piece 1b/1c: the ticket reader. A real bare-agent MCP bridge against a fake stdio server (test/fixtures/fake-mcp-server.mjs), an explicit config path, no network,
// no model. Each refusal names the real cause (F101: all three used to print one generic line); none ever reads as empty content or "0 new".
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { readTicketMcp } from '../src/ticket-mcp.js';
import { freezeInputs } from '../src/runner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, 'fixtures', 'fake-mcp-server.mjs');
const LIST = 'https://github.com/flutter/flutter/issues';
const MCP = { server: 'github', tools: ['issue_read'] };

/** a scratch dir with a `.mcp.json` whose `github` server is the fake; `env` is what the fake reads, `server` renames the entry, `command` swaps the command */
function world(t, { env = {}, server = 'github', command = process.execPath, args = [FAKE], noServers = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p1-reader-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = path.join(dir, 'calls.jsonl');
  const configPath = path.join(dir, 'mcp.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers: noServers ? {} : { [server]: { command, args, env: { FAKE_MCP_SERVER: '1', FAKE_CALLS: calls, ...env } } } }));
  const read = (over = {}) => readTicketMcp({ listUrl: LIST, number: 100047, mcp: MCP, configPath, ...over });
  const callsMade = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { dir, configPath, read, callsMade };
}

describe('1b: reads one ticket through only the job\'s tools', () => {
  test('issue_read for owner/repo/N from the list address; the record says what was exposed, missing and called', async (t) => {
    const w = world(t);
    const r = await w.read();
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    assert.match(r.text, /"number":100047/);
    assert.equal(r.url, 'https://github.com/flutter/flutter/issues/100047');
    assert.deepEqual(r.record, {
      server: 'github', exposed: ['github_issue_read'], missing: [], calls: [{ tool: 'issue_read', owner: 'flutter', repo: 'flutter', issue_number: 100047 }],
    });
    assert.deepEqual(w.callsMade(), [{ name: 'issue_read', arguments: { method: 'get', owner: 'flutter', repo: 'flutter', issue_number: 100047 } }]);
  });
  test('the server offers more tools than the job lists: only the job\'s tool exists for the run, and only it is called', async (t) => {
    const w = world(t); // the fake offers issue_read AND list_issues
    const r = await w.read();
    assert.equal(r.ok, true);
    assert.deepEqual(r.record.exposed, ['github_issue_read']);
    assert.deepEqual(w.callsMade().map((c) => c.name), ['issue_read']);
  });
  test('a list address that is not owner/repo issues, or a bad ticket number, is refused before any server starts', async (t) => {
    const w = world(t);
    for (const [over, want] of [
      [{ listUrl: 'https://example.com/a/b/issues' }, /not a GitHub issues address/],
      [{ number: 0 }, /ticket number/],
      [{ number: 1.5 }, /ticket number/],
      [{ number: '7' }, /ticket number/],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await w.read(over);
      assert.equal(r.ok, false);
      assert.match(r.error, want);
    }
    assert.deepEqual(w.callsMade(), []);
  });
  test('the job must list issue_read for the reader to use it', async (t) => {
    const w = world(t);
    const r = await w.read({ mcp: { server: 'github', tools: ['list_issues'] } });
    assert.equal(r.ok, false);
    assert.match(r.error, /does not list issue_read/);
    assert.deepEqual(w.callsMade(), []);
  });
  test('the repo\'s own .mcp.json is never read: a ./.mcp.json in the cwd that has the server changes nothing when ~/.mcp.json lacks it', async (t) => {
    const w = world(t, { noServers: true });
    writeFileSync(path.join(w.dir, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE] } } }));
    const before = process.cwd();
    process.chdir(w.dir);
    try {
      const r = await w.read();
      assert.equal(r.ok, false);
      assert.equal(r.error, 'github is not in ~/.mcp.json');
    } finally { process.chdir(before); }
  });
});

describe('1c: refusals that name the real cause', () => {
  test('server not in ~/.mcp.json', async (t) => {
    const w = world(t, { server: 'other' });
    const r = await w.read();
    assert.deepEqual([r.ok, r.error], [false, 'github is not in ~/.mcp.json']);
  });
  test('server did not start: the first error line, nothing else', async (t) => {
    const w = world(t, { command: '/nonexistent/fwdloop-m12-no-such-binary', args: [] });
    const r = await w.read();
    assert.equal(r.ok, false);
    assert.match(r.error, /^github did not start: /);
    assert.doesNotMatch(r.error, /\n/);
  });
  test('server does not offer the tool', async (t) => {
    const w = world(t, { env: { FAKE_TOOLS: JSON.stringify([{ name: 'get_file_contents', annotations: { readOnlyHint: true } }]) } });
    const r = await w.read();
    assert.deepEqual([r.ok, r.error], [false, 'github does not offer issue_read']);
  });
  test('a tool the server does not mark readOnlyHint:true is refused by name: no mark, a false mark, a junk mark', async (t) => {
    for (const annotations of [undefined, { readOnlyHint: false }, { readOnlyHint: 'true' }, { destructiveHint: false }]) {
      const w = world(t, { env: { FAKE_TOOLS: JSON.stringify([{ name: 'issue_read', ...(annotations ? { annotations } : {}) }]) } });
      // eslint-disable-next-line no-await-in-loop
      const r = await w.read();
      assert.equal(r.ok, false, JSON.stringify(annotations));
      assert.equal(r.error, 'github does not mark issue_read read-only (readOnlyHint is not true)');
      assert.deepEqual(w.callsMade(), [], 'a tool not marked read-only is never called');
    }
  });
  test('the server answers with the device-login text: GitHub token unavailable, never content', async (t) => {
    const w = world(t, { env: { FAKE_REPLY: 'device' } });
    const r = await w.read();
    assert.deepEqual([r.ok, r.error], [false, 'GitHub token unavailable — the server asked for a login (is pass locked?)']);
  });
  test('an empty reply and an error reply are refused, never frozen as empty', async (t) => {
    const e = await world(t, { env: { FAKE_REPLY: 'empty' } }).read();
    assert.equal(e.ok, false);
    assert.match(e.error, /github: issue_read returned nothing for .*\/100047/);
    const x = await world(t, { env: { FAKE_REPLY: 'error' } }).read();
    assert.equal(x.ok, false);
    assert.equal(x.error, 'github: issue_read failed: Could not resolve to a Repository');
  });
});

describe('1b: freezes the ticket as a normal frozen input (copy + sha256 in the manifest)', () => {
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  test('freezeInputs: inputs/<id>.txt, sha256 of the frozen bytes, source = the issue address, and the MCP record rides in the manifest entry', async (t) => {
    const w = world(t);
    const runDir = path.join(w.dir, 'run-1');
    const f = await freezeInputs(runDir, [{ id: 'issue', path: LIST, ticket: { number: 100047 } }], { mcp: MCP, ticketRead: (a) => readTicketMcp({ ...a, configPath: w.configPath }) });
    assert.equal(f.ok, true, f.ok ? '' : f.red);
    const e = f.manifest[0];
    assert.equal(e.id, 'issue');
    assert.equal(e.source, 'https://github.com/flutter/flutter/issues/100047');
    assert.equal(e.frozen, path.join(runDir, 'inputs', 'issue.txt'));
    assert.equal(e.sha256, sha(e.frozen));
    assert.equal(e.bytes, readFileSync(e.frozen).length);
    assert.match(readFileSync(e.frozen, 'utf8'), /Tap the back arrow/);
    assert.equal(e.mcp.server, 'github');
    assert.equal(e.mcp.calls.length, 1);
    assert.equal(existsSync(path.join(runDir, 'mcp-calls.jsonl')), false, 'no new run-folder file');
  });
  test('a refusal leaves nothing frozen and says which input: freeze: input "issue": <cause>', async (t) => {
    const w = world(t, { env: { FAKE_REPLY: 'device' } });
    const runDir = path.join(w.dir, 'run-1');
    const f = await freezeInputs(runDir, [{ id: 'issue', path: LIST, ticket: { number: 100047 } }], { mcp: MCP, ticketRead: (a) => readTicketMcp({ ...a, configPath: w.configPath }) });
    assert.equal(f.ok, false);
    assert.equal(f.red, 'freeze: input "issue": GitHub token unavailable — the server asked for a login (is pass locked?)');
    assert.equal(existsSync(path.join(runDir, 'inputs', 'issue.txt')), false);
  });
  test('a ticket input in a job that lists no MCP tools is refused by name', async (t) => {
    const w = world(t);
    const f = await freezeInputs(path.join(w.dir, 'run-1'), [{ id: 'issue', path: LIST, ticket: { number: 1 } }], {});
    assert.equal(f.ok, false);
    assert.match(f.red, /freeze: input "issue": the job lists no MCP tools/);
  });
});
