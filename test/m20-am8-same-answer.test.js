// M20 am8 item 1: for each merged question, every OLD site's predicate (frozen here as a literal copy, named `old site file:line`) gives the owner's answer on every value of its kind plus empty, missing and unknown values.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lockMayBeHeld } from '../src/liveness.js';

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
