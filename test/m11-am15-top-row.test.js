// M11 amendment 15 (docs/wiki/the-module-ladder.md): a job's top row is its waiting run, if it has one. A stuck run that has left Needs you
// (RUNS_LIST_LIMITS.needsYouDays, M11 am3 item 5) is no longer the top row; the newest run by time is. orderRuns is the ONE decider: the job
// card head (the page's first run of a job) and the Scheduled card's runId (listScheduled's first row of that job) both read its order.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { orderRuns, listScheduled, needsYouTag, RUNS_LIST_LIMITS } from '../src/panel/data.js';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const DAY = 86_400_000;
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
// `needs` is what listRuns stamps from needsYouOf: the tag while the card is in Needs you, null once it has left.
const stuck = (runId, daysAgo) => ({
  flow: 'f', runId, glyph: '[II]', stuck: true, waiting: false, at: null, needs: needsYouTag('[II]', { atAsk: false, canResume: true }, iso(daysAgo), NOW),
});
const passed = (runId, daysAgo) => ({ flow: 'f', runId, glyph: '[✓]', waiting: false, at: iso(daysAgo), needs: null });
const waiting = (runId) => ({ flow: 'f', runId, glyph: '[·]', waiting: true, timeLeftMs: 600_000, at: null, needs: 'Answer' });
const top = (rows) => orderRuns(rows)[0].runId;

test('(a) a stuck run past the Needs-you days is not the top row; the newer passed run is', () => {
  const rows = [passed('run-9', 1), stuck('run-2', RUNS_LIST_LIMITS.needsYouDays + 1)];
  assert.equal(rows[1].needs, null, 'fixture: the stuck run has left Needs you');
  assert.deepEqual(orderRuns(rows).map((r) => r.runId), ['run-9', 'run-2']);
});

test('(b) a stuck run still inside its days stays the top row', () => {
  const rows = [passed('run-9', 1), stuck('run-2', RUNS_LIST_LIMITS.needsYouDays - 1)];
  assert.equal(rows[1].needs, 'Resume');
  assert.equal(top(rows), 'run-2');
});

test('(c) a waiting-at-ask run stays top whatever else is there, stuck or not', () => {
  assert.equal(top([passed('run-9', 0), stuck('run-2', 30), waiting('run-5')]), 'run-5');
  assert.equal(top([passed('run-9', 0), stuck('run-3', 1), waiting('run-5')]), 'run-5');
});

test('the Scheduled card follows the same top row (listScheduled reads orderRuns order)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m11am15-'));
  mkdirSync(path.join(root, 'f'));
  const reads = { f: { trigger: { kind: 'daily', hour: 9, minute: 0 }, armed: true, nextSlotMs: NOW + DAY, lastOutcome: null } };
  const card = (rows) => listScheduled({ root, triggerRead: (f) => reads[f], now: () => NOW, rows: orderRuns(rows) })[0].runId;
  assert.equal(card([passed('run-9', 1), stuck('run-2', 30)]), 'run-9');
  assert.equal(card([passed('run-9', 1), stuck('run-2', 1)]), 'run-2');
});
