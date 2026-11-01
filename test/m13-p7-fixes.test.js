// M13 piece 7 (docs/wiki/the-module-ladder.md, M13 item 9 and 9b): the parked bugs. Each describe names its item. A real bare-agent bridge against the fake stdio server, no network, no model.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lookTickets, recordLook, seenNumbers } from '../src/trigger-tickets.js';
import { queueOf } from '../src/trigger-files.js';
import { readSeen } from '../src/trigger-files.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, 'fixtures', 'fake-mcp-server.mjs');
const LIST = 'https://github.com/flutter/flutter/issues';
const MCP = { server: 'github', tool: 'list_issues' };
const issue = (number, extra = {}) => ({ number, state: 'OPEN', labels: [], created_at: '2026-10-10T00:00:00Z', ...extra });

function world(t, issues) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p7-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const listFile = path.join(dir, 'list.json');
  const configPath = path.join(dir, 'mcp.json');
  writeFileSync(listFile, JSON.stringify(issues));
  writeFileSync(configPath, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { FAKE_MCP_SERVER: '1', FAKE_LIST: listFile } } } }));
  return { dir, look: (over = {}) => lookTickets({ listUrl: LIST, mcp: MCP, configPath, seen: null, last: new Map(), watch: [], perPage: 10, ...over }) };
}

describe('9.2 closed seen tickets queue no runs (item 6: new = higher than the highest seen)', () => {
  test('Must fail: all 10 seen tickets (#91-#100) closed, #101 opens: the look finds #101 only, not the 90 older open tickets', async (t) => {
    // the look asks for OPEN only, so the closed #91-#100 are not on the list; #1-#90 still are
    const open = [issue(101), ...Array.from({ length: 90 }, (_, i) => issue(90 - i))];
    const w = world(t, open);
    const seen = new Set(Array.from({ length: 10 }, (_, i) => 91 + i));
    const r = await w.look({ seen });
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    assert.deepEqual(r.found.map((i) => i.number), [101]);
  });
  test('and through the ledger: one arrived row, one queued run', async (t) => {
    const open = [issue(101), ...Array.from({ length: 90 }, (_, i) => issue(90 - i))];
    const w = world(t, open);
    const ledger = path.join(w.dir, 'ledger.jsonl');
    const sig = 'sig';
    const seen = new Set(Array.from({ length: 10 }, (_, i) => 91 + i));
    const r = await w.look({ seen });
    recordLook(ledger, sig, r, 1000);
    assert.equal(queueOf(readSeen(ledger, sig)).length, 1);
    assert.deepEqual([...seenNumbers(ledger, sig)], [101]);
  });
});
