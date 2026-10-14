// M9 piece 5/6: the ONE writer of the summary block's and trigger card's words. Pure: typed facts in, a fixed sentence out.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  catchUpWords, editClearsWords, endedWords, scheduledNextFor, scheduledWords, slotWords,
} from '../src/summary-words.js';

// the NEXT sentence alone
const scheduledNext = (f) => scheduledNextFor(f).text;

test('SCHEDULED words, the signed examples', () => {
  assert.equal(scheduledWords(null), null);
  assert.equal(scheduledWords({ kind: 'weekly', day: 'mon', hour: 9, minute: 0 }), 'Mondays at 09:00');
  assert.equal(scheduledWords({ kind: 'daily', hour: 7, minute: 5 }), 'Every day at 07:05');
  assert.equal(scheduledWords({ kind: 'weekdays', hour: 18, minute: 30 }), 'Weekdays at 18:30');
  assert.equal(scheduledWords({ kind: 'file-updated', role: 'inv', path: '/data/in/invoices.xlsx' }), 'When invoices.xlsx is updated');
  assert.equal(scheduledWords({ kind: 'new-file', role: 'inv', folder: '/home/x/inbox' }, '/home/x'), 'When a new file arrives in ~/inbox/');
  assert.equal(scheduledWords({ kind: 'new-file', role: 'inv', folder: '/srv/in/' }, '/home/x'), 'When a new file arrives in /srv/in/');
});

test('slotWords is local and fixed English', () => {
  assert.equal(slotWords(new Date(2026, 9, 13, 9, 0).getTime()), 'Tue 13 Oct, 09:00');
});

test('NEXT of a scheduled job: next run, paused, waiting, file kinds, not armed', () => {
  const now = new Date(2026, 9, 12, 12, 0).getTime();
  const weekly = { kind: 'weekly', day: 'mon', hour: 9, minute: 0 };
  const base = { trigger: weekly, armed: true, nextSlotMs: new Date(2026, 9, 12, 9, 0).getTime() + 7 * 86400000, lastOutcome: null, waitingLine: null, now };
  assert.equal(scheduledNext(base), 'Next run Mon 19 Oct, 09:00.');
  assert.equal(scheduledNext({ ...base, waitingLine: 4 }), 'Waiting for your answer at line 4; the next run waits too.');
  const paused = { at: new Date(2026, 9, 12, 9, 0).toISOString(), outcome: 'monthly-exhausted', leftUsd: 0.12, needUsd: 0.5, atLeast: false };
  assert.equal(scheduledNext({ ...base, lastOutcome: paused }),
    'Paused: not enough money left this month ($0.12 left, a run needs up to $0.50). Raise the monthly limit in Settings, or it starts again on the 1st.');
  assert.match(scheduledNext({ ...base, lastOutcome: { ...paused, atLeast: true } }), /at most \$0\.12 left/);
  // last month's pause is not this month's
  assert.equal(scheduledNext({ ...base, lastOutcome: { ...paused, at: new Date(2026, 8, 30, 9, 0).toISOString() } }), 'Next run Mon 19 Oct, 09:00.');
  assert.match(scheduledNext({ ...base, lastOutcome: { at: paused.at, outcome: 'refused', why: 'The input "jd" is not there. Nothing started.' } }), /^The last try did not start: The input "jd" is not there\. Nothing started\. Next run /);
  assert.match(scheduledNext({ ...base, armed: false }), /^Not armed yet/);
  // the typed red flag: the human must act (paused for money, a refused try); a normal next run is not red
  assert.equal(scheduledNextFor(base).red, false);
  assert.equal(scheduledNextFor({ ...base, waitingLine: 4 }).red, false);
  assert.equal(scheduledNextFor({ ...base, lastOutcome: paused }).red, true);
  assert.equal(scheduledNextFor({ ...base, lastOutcome: { at: paused.at, outcome: 'refused', why: 'The input "jd" is not there. Nothing started.' } }).red, true);
  assert.equal(scheduledNextFor({ ...base, lastOutcome: { ...paused, at: new Date(2026, 8, 30, 9, 0).toISOString() } }).red, false);
  assert.match(scheduledNext({ ...base, trigger: { kind: 'file-updated', role: 'a', path: '/x/a.md' }, nextSlotMs: null }), /^Watching for it\. A run starts when its contents change\.$/);
  assert.match(scheduledNext({ ...base, trigger: { kind: 'new-file', role: 'a', folder: '/x' }, nextSlotMs: null }), /^Watching for it\. A run starts for each new file\.$/);
});

test('ENDED words, every outcome the books can hold has a fixed sentence', () => {
  const f = { line: 4, destination: '/home/x/out', canResume: false, home: '/home/x' };
  assert.deepEqual(endedWords({ ...f, outcome: 'complete' }), { reason: 'Goal met.', next: 'The result is in ~/out.' });
  assert.equal(endedWords({ ...f, outcome: 'complete', destination: null }).next, 'The result is in the step cards below.');
  assert.deepEqual(endedWords({ ...f, outcome: 'redo-halt' }), { reason: 'Stopped at line 4: you rejected it.', next: 'Run it again from the Chat card.' });
  assert.equal(endedWords({ ...f, outcome: 'redo-halt', line: null }).reason, 'Stopped: you rejected it.');
  assert.deepEqual(endedWords({ ...f, outcome: 'stopped', canResume: true }), { reason: 'Stopped by you.', next: 'Resume from the Chat card.' });
  assert.equal(endedWords({ ...f, outcome: 'stopped' }).next, 'Run it again from the Chat card.');
  assert.equal(endedWords({ ...f, outcome: 'cap-halt', canResume: true }).next, 'Raise the cap and Resume from the Chat card.');
  for (const o of ['ask-expired', 'ask-timeout', 'not-done', 'struck-out', 'attempt-fallback', 'close-casualty', 'provider-red', 'pricing-red', 'red', 'cap-halt']) {
    const w = endedWords({ ...f, outcome: o });
    assert.match(w.reason, /^Stopped at line 4: /, o);
    assert.ok(w.next.length > 10, o);
  }
  for (const o of ['rerun', 'preflight-red', 'refused']) assert.ok(endedWords({ ...f, outcome: o }).reason.length > 10, o);
  assert.equal(endedWords({ ...f, outcome: null }), null);
  assert.match(endedWords({ ...f, outcome: null, died: true }).reason, /no ending recorded/);
});

test('an unknown ending gets the honest fixed fallback, never a guess', () => {
  const w = endedWords({ outcome: 'sky-fell', line: 2, destination: null, canResume: true });
  assert.equal(w.reason, 'It ended with "sky-fell", which this panel has no sentence for.');
  assert.doesNotMatch(w.reason, /line 2/);
  // the code from the books is cut to word characters and 40 long: no markup, no sentence smuggled in
  assert.equal(endedWords({ outcome: '<b>x</b> y z', line: null, destination: null, canResume: false }).reason, 'It ended with "bxbyz", which this panel has no sentence for.');
});

test('catch-up and the am1 edit warning', () => {
  assert.match(catchUpWords({ catchUp: true }), /catch-up/);
  assert.equal(catchUpWords({ catchUp: false }), null);
  assert.equal(catchUpWords(null), null);
  assert.equal(editClearsWords(null), null);
  assert.match(editClearsWords({ kind: 'weekly', day: 'mon', hour: 9, minute: 0 }), /Mondays at 09:00.*clears that back to By hand/);
});
