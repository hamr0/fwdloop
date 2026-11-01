// M13 piece 7, item 9b.3 (Must fail: an unreadable look reads as "0 new" or shows nowhere). A look that could not read (pass locked: GitHub's device-login text) shows on the
// Run card as ONE line naming the cause; a later look that reads clears it. Real trigger door, real scheduler and look against the fake MCP server, injected clock. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { scheduleBlockWords, scheduledNextFor } from '../src/summary-words.js';
import { MIN, p5World } from './m13-p5-world.mjs';

function locked(w, on) {
  const file = path.join(w.dir, 'mcp.json');
  const o = JSON.parse(readFileSync(file, 'utf8'));
  if (on) o.mcpServers.github.env.FAKE_REPLY = 'device'; else delete o.mcpServers.github.env.FAKE_REPLY;
  writeFileSync(file, JSON.stringify(o));
}

test('a look that could not read shows on the Run card as one line naming the cause, never "0 new"; the next look that reads clears it', async (t) => {
  const w = p5World();
  t.after(() => rmSync(w.dir, { recursive: true, force: true }));
  w.sign();
  w.run('r-green', { ticket: 5, rows: [['complete', w.clock.t]] });
  await w.ticks(2);                                   // armed, first look baselines #1-#5
  assert.equal(w.door.facts('tk').lookProblem ?? null, null, 'a good look shows no problem');
  locked(w, true);
  await w.tick();
  const f = w.door.facts('tk');
  assert.match(f.lookProblem.why, /GitHub token unavailable — is pass locked\?/);
  const blk = scheduleBlockWords({ ...f, last: null, problem: null });
  assert.equal(blk.red, true);
  assert.match(blk.line2, /could not read the tickets: GitHub token unavailable — is pass locked\?/);
  assert.doesNotMatch(blk.line2, /0 new|waiting for a new ticket/);
  const nx = scheduledNextFor({ ...f, lastOutcome: null, waitingLine: null, now: w.clock.t });
  assert.match(nx.text, /could not read the tickets: GitHub token unavailable/);
  assert.equal(nx.red, true);
  await w.tick();                                     // still locked: still shown, once, not doubled
  assert.match(w.door.facts('tk').lookProblem.why, /pass locked/);
  locked(w, false);
  await w.tick();                                     // a look that reads, with nothing new
  assert.equal(w.door.facts('tk').lookProblem ?? null, null, 'cleared by the next look that reads, though it found nothing');
  assert.doesNotMatch(scheduleBlockWords({ ...w.door.facts('tk'), last: null, problem: null }).line2, /could not read/);
});
