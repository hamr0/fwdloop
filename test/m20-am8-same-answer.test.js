// M20 am8 item 1: for each merged question, every OLD site's predicate (frozen here as a literal copy, named `old site file:line`) gives the owner's answer on every value of its kind plus empty, missing and unknown values.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lockMayBeHeld } from '../src/liveness.js';
import { noJudgment } from '../src/closers.js';
import { answerPickedUp } from '../src/panel/data.js';

const ODD = ['', null, undefined, 'nonsense', 0, {}, 'Live', ' live'];
/** old == owner on every value @param {string} what @param {unknown[]} kind @param {(v:any)=>unknown} oldFn @param {(v:any)=>unknown} owner */
const same = (what, kind, oldFn, owner) => {
  for (const v of [...kind, ...ODD]) assert.equal(owner(v), oldFn(v), `${what}: ${JSON.stringify(v)}`);
};

test('1a lockMayBeHeld: the three old sites ask live-or-unknown of a lock state', () => {
  const states = ['none', 'live', 'dead', 'unknown', 'empty'];
  // old site src/panel/authorresume.js:71 and src/runner.js:2305
  same('lock.state', states, (s) => s === 'live' || s === 'unknown', lockMayBeHeld);
  // old site src/panel/data.js:298 (the `lock` word of stuckState, the same state string)
  same('data lock', states, (lock) => lock === 'live' || lock === 'unknown', lockMayBeHeld);
});

test('1b noJudgment: the old sites ask crash-or-unparseable of a closer verdict', () => {
  const verdicts = ['green', 'red', 'hitl', 'unparseable', 'crash', 'stopped', 'close-casualty'];
  // old sites src/closers.js:125,126 (withItemShape), :353,:354 (withNumbers), :383,:384 (closeFactAndPicks), in the `v === 'crash' || v === 'unparseable'` form
  same('closers verdict', verdicts, (v) => v === 'crash' || v === 'unparseable', noJudgment);
  // old site src/try-checks.js:77, the pair in the other order
  same('try-checks verdict', verdicts, (v) => v === 'unparseable' || v === 'crash', noJudgment);
  // src/runner.js:1223 asks `!== 'red'` after green and hitl returned: equal on the three verdicts that can reach it, different on any other, so it stays apart (see the guard)
  for (const v of ['red', 'unparseable', 'crash']) assert.equal(noJudgment(v), v !== 'red');
});

test('1c answerPickedUp: the three old data.js sites ask starting-or-not-started of the resume, for this ask', () => {
  const states = ['starting', 'not-started', 'broken', 'took-over'];
  const resumes = [...states.flatMap((state) => [{ state, askId: 'a1' }, { state, askId: 'other' }, { state }]), null, undefined, {}, '', 0, { state: 'starting' }];
  for (const askId of ['a1', undefined, null, '']) {
    for (const r of resumes) {
      // old site src/panel/data.js:2433 (answerSaved)
      const old2433 = r != null && r.askId === askId && (r.state === 'starting' || r.state === 'not-started');
      // old site src/panel/data.js:2439 (answered), with `open` true and false
      const old2439 = (open) => open && r != null && r.askId === askId && (r.state === 'starting' || r.state === 'not-started');
      // old site src/panel/data.js:2462 (reopenOffer), read as the truth of its `if`
      const old2462 = !!(r && r.askId === askId && (r.state === 'starting' || r.state === 'not-started'));
      const tag = JSON.stringify([r, askId]);
      assert.equal(answerPickedUp(r, askId), old2433, `2433 ${tag}`);
      for (const open of [true, false]) assert.equal(open && answerPickedUp(r, askId), old2439(open), `2439 ${open} ${tag}`);
      assert.equal(!!answerPickedUp(r, askId), old2462, `2462 ${tag}`);
    }
  }
});
