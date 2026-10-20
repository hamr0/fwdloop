// M10 am5 item 2: the Result tab's Your call card. The SERVER decides when a run waits for the person's accept (the Ask tab's own "doors" rule: an open,
// unexpired ask with no saved answer); /result carries `door` = { head, ask, askId, draftNo } or null. Bareloop's words (server.js@2959217 DOOR_WORDS.waiting.head,
// RESULT_DOOR_ASK). The page only draws it; Accept and Rerun go through the Ask tab's own POST /api/answer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { world } from './m10-am4-world.mjs';
import { answerAsk } from '../src/ask.js';
import { RESULT_DOOR_HEAD, RESULT_DOOR_ASK } from '../src/panel/result.js';

test('the words are bareloop\'s', () => {
  assert.equal(RESULT_DOOR_HEAD, 'waiting for you');
  assert.equal(RESULT_DOOR_ASK, 'the checks passed; is this what you wanted?');
});

test('a run parked at its ask has a door with the ask\'s own id, the words from the one table', async () => {
  const w = await world({ mode: 'park' });
  const door = (await w.get('/api/runs/job2/run-1/result')).body.door;
  const asks = (await w.get('/api/runs/job2/run-1/asks')).body;
  assert.deepEqual(door, { head: 'waiting for you', ask: 'the checks passed; is this what you wanted?', askId: asks.blocks[0].current.askId, draftNo: asks.blocks[0].draftNo });
  assert.equal(asks.blocks[0].current.open, true, 'the Ask tab shows the same ask open');
});

// must fail: a door on a run nobody is waiting on
test('a run that was accepted and finished has no door; neither has one that ended red', async () => {
  const green = await world({ mode: 'green' });
  assert.equal((await green.get('/api/runs/job2/run-1/result')).body.door, null);
  const red = await world({ mode: 'red' });
  assert.equal((await red.get('/api/runs/job2/run-1/result')).body.door, null);
});

// the Ask tab hides its doors once an answer is saved (the run is carrying it on); the Result tab hides the card by the same rule
test('once an answer is saved the door is gone (the Ask tab shows no doors for that ask either)', async () => {
  const w = await world({ mode: 'park' });
  const askId = (await w.get('/api/runs/job2/run-1/asks')).body.blocks[0].current.askId;
  assert.equal(answerAsk({ runDir: w.runDir, askId, decision: 'accept' }).ok, true);
  assert.equal((await w.get('/api/runs/job2/run-1/result')).body.door, null);
});
