// M12 piece 2, the look (docs/wiki/the-module-ladder.md, "M12 scope (restart)" items 5, 6, 7): one $0 look at a ticket list through the job's server with
// `allow` = only the schedule's tool. A real bare-agent bridge against the fake stdio server (test/fixtures/fake-mcp-server.mjs, FAKE_LIST), no network, no model.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lookTickets, reasonFor } from '../src/trigger-tickets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, 'fixtures', 'fake-mcp-server.mjs');
const LIST = 'https://github.com/flutter/flutter/issues';
const MCP = { server: 'github', tool: 'list_issues' };
const issue = (number, extra = {}) => ({ number, state: 'OPEN', labels: [], created_at: `2026-10-${String(10 + (number % 18)).padStart(2, '0')}T00:00:00Z`, ...extra });
/** newest first: numbers n, n-1, ... 1 */
const newestFirst = (n) => Array.from({ length: n }, (_, i) => issue(n - i));

function world(t, { env = {}, issues = newestFirst(25) } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p2-look-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = path.join(dir, 'calls.jsonl');
  const listFile = path.join(dir, 'list.json');
  const configPath = path.join(dir, 'mcp.json');
  writeFileSync(listFile, JSON.stringify(issues));
  writeFileSync(configPath, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { FAKE_MCP_SERVER: '1', FAKE_CALLS: calls, FAKE_LIST: listFile, ...env } } } }));
  return {
    configPath,
    setList: (l) => writeFileSync(listFile, JSON.stringify(l)),
    look: (over = {}) => lookTickets({ listUrl: LIST, mcp: MCP, configPath, seen: null, last: new Map(), watch: [], perPage: 10, ...over }),
    callsMade: () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []),
  };
}

describe('the first look is the starting point', () => {
  test('first page only, newest first, called through list_issues alone; nothing else exists for the look', async (t) => {
    const w = world(t);
    const r = await w.look();
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    assert.equal(r.first, true);
    assert.deepEqual(r.found.map((i) => i.number), [25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
    assert.equal(r.pages, 1);
    assert.deepEqual(w.callsMade().map((c) => c.name), ['list_issues']);
    assert.deepEqual(w.callsMade()[0].arguments, {
      owner: 'flutter', repo: 'flutter', orderBy: 'CREATED_AT', direction: 'DESC', perPage: 10, state: 'OPEN', fields: ['number', 'created_at', 'state', 'labels'],
    });
  });
});

describe('later looks: newest first, cursor, stop at a seen number', () => {
  test('3 new tickets: one page, stops at the first seen number', async (t) => {
    const w = world(t, { issues: newestFirst(28) });
    const seen = new Set(Array.from({ length: 25 }, (_, i) => i + 1));
    const r = await w.look({ seen });
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    assert.equal(r.first, false);
    assert.deepEqual(r.found.map((i) => i.number), [28, 27, 26]);
    assert.equal(r.pages, 1);
  });
  test('a flood of 23 new tickets between two looks is followed across pages with the cursor, and ends at the seen number (not at the page edge)', async (t) => {
    const w = world(t, { issues: newestFirst(48) });
    const seen = new Set(Array.from({ length: 25 }, (_, i) => i + 1));
    const r = await w.look({ seen });
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    assert.deepEqual(r.found.map((i) => i.number), Array.from({ length: 23 }, (_, i) => 48 - i));
    assert.equal(r.pages, 3);
    assert.deepEqual(w.callsMade().map((c) => c.arguments.after), [undefined, '10', '20']);
  });
  test('nothing new is a real "0 new": ok, found empty', async (t) => {
    const w = world(t, { issues: newestFirst(25) });
    const r = await w.look({ seen: new Set(Array.from({ length: 25 }, (_, i) => i + 1)) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.found, []);
  });
});

describe('Must fail: an unreadable list is never "0 new" (item 5)', () => {
  const seen = new Set([1, 2, 3]);
  test('GitHub\'s device-login text -> unreadable, naming the token', async (t) => {
    const w = world(t, { env: { FAKE_REPLY: 'device' } });
    const r = await w.look({ seen });
    assert.deepEqual(r, { ok: false, error: 'GitHub token unavailable — is pass locked?' });
  });
  test('a server error -> unreadable with its first line', async (t) => {
    const w = world(t, { env: { FAKE_REPLY: 'error' } });
    const r = await w.look({ seen });
    assert.equal(r.ok, false);
    assert.match(r.error, /Could not resolve to a Repository/);
    assert.doesNotMatch(r.error, /second line/);
  });
  test('no list in the answer (empty content) -> unreadable', async (t) => {
    const w = world(t, { env: { FAKE_REPLY: 'empty' } });
    const r = await w.look({ seen });
    assert.equal(r.ok, false);
    assert.match(r.error, /no ticket list/);
  });
  test('a list with no tickets on its first page -> unreadable, never a starting point of nothing', async (t) => {
    const w = world(t, { issues: [] });
    for (const over of [{}, { seen }]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await w.look(over);
      assert.equal(r.ok, false);
      assert.match(r.error, /came back empty/);
    }
  });
  test('the server lacks the signed tool, or does not mark it read-only -> unreadable, by name', async (t) => {
    const a = world(t, { env: { FAKE_TOOLS: JSON.stringify([{ name: 'issue_read', annotations: { readOnlyHint: true } }]) } });
    assert.match((await a.look({ seen })).error, /github does not offer list_issues/);
    const b = world(t, { env: { FAKE_TOOLS: JSON.stringify([{ name: 'list_issues' }]) } });
    assert.match((await b.look({ seen })).error, /does not mark list_issues read-only/);
  });
  test('a server that is not in ~/.mcp.json, and an address that is not a GitHub issues list -> unreadable', async (t) => {
    const w = world(t);
    assert.match((await w.look({ seen, mcp: { server: 'nope', tool: 'list_issues' } })).error, /nope is not in ~\/\.mcp\.json/);
    assert.match((await w.look({ seen, listUrl: 'https://example.com/a/b/issues' })).error, /not a GitHub issues address/);
  });
});

describe('watched fields (item 7): code compares typed values; an unwatched edit is nothing', () => {
  test('reasonFor: state, labels added/removed, only for the watched fields', () => {
    const prev = { state: 'open', labels: ['bug'] };
    assert.equal(reasonFor(prev, { state: 'closed', labels: ['bug'] }, ['state']), 'state open→closed');
    assert.equal(reasonFor(prev, { state: 'open', labels: ['bug', 'P2'] }, ['labels']), 'label added: P2');
    assert.equal(reasonFor(prev, { state: 'open', labels: [] }, ['labels']), 'label removed: bug');
    assert.equal(reasonFor(prev, { state: 'closed', labels: ['P2'] }, []), '');
    assert.equal(reasonFor(prev, { state: 'closed', labels: ['bug'] }, ['labels']), '');
  });
  const tracked = (state, labels = []) => ({ state, labels });
  test('a seen ticket whose watched state changed is reported once with its reason; one whose unwatched title changed is not', async (t) => {
    const l = newestFirst(5).map((i) => ({ ...i, title: 't' }));
    const w = world(t, { issues: l });
    const last = new Map([[5, tracked('open')], [4, tracked('open')], [3, tracked('open')], [2, tracked('open')], [1, tracked('open')]]);
    const seen = new Set(last.keys());
    w.setList(l.map((i) => (i.number === 3 ? { ...i, state: 'CLOSED' } : i.number === 4 ? { ...i, title: 'edited' } : i)));
    const r = await w.look({ seen, last, watch: ['state'] });
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    assert.deepEqual(r.found, []);
    assert.deepEqual(r.changed.map((c) => [c.number, c.reason, c.state]), [[3, 'state open→closed', 'closed']]);
    assert.equal(w.callsMade()[0].arguments.state, undefined, 'a watched state needs closed tickets too');
  });
  test('watched labels (objects or plain names) changing arrives once; the walk goes past the first seen number to reach tracked tickets, and stops past the oldest', async (t) => {
    const l = newestFirst(25);
    const w = world(t, { issues: l });
    const last = new Map([[24, tracked('open')], [3, tracked('open', ['bug'])]]);
    w.setList(l.map((i) => (i.number === 3 ? { ...i, labels: [{ name: 'bug' }, { name: 'P2' }] } : i)));
    const r = await w.look({ seen: new Set([25, ...last.keys()]), last, watch: ['labels'] });
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    assert.deepEqual(r.found, []);
    assert.deepEqual(r.changed.map((c) => [c.number, c.reason]), [[3, 'label added: P2']]);
    assert.equal(r.pages, 3, 'ten per page: 25-16, 15-6, 5-1');
  });
  test('Must fail: no watched field named -> a change to state or labels is nothing, and the walk stops at the first seen number', async (t) => {
    const l = newestFirst(5).map((i) => (i.number === 2 ? { ...i, state: 'CLOSED' } : i));
    const w = world(t, { issues: l });
    const r = await w.look({ seen: new Set([1, 2, 3, 4, 5]), last: new Map([[2, tracked('open')]]), watch: [] });
    assert.deepEqual([r.found, r.changed], [[], []]);
    assert.equal(r.pages, 1);
  });
});
