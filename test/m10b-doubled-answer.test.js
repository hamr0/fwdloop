// M10b fix: the same answer given twice to the same job line (a first draft's column ask, then again after a redraft) was added as a second `~` rule, so the guardrail read
// "x; x". An answer equal (exact string, after trim) to a `~` rule already on that line is not added again. Seen live: flows/m10b-aging, draft d-00mvkmbx5j-a98a.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendAnswersToJob } from '../src/panel/authorcard.js';

const JOB = ['Read the aging report', 'Work out the days past due', '~ every invoice appears exactly once', '~ days past due = days since \'Due date\'', 'ask 1h: check it with me'].join('\n');
const ANS = "days past due = days since 'Due date'";

test('an answer equal to a ~ rule already on its line is not added again, and still counts as taken (the caller refuses on a missing line only)', () => {
  const r = appendAnswersToJob(JOB, [{ line: 2, answer: ANS }]);
  assert.equal(r.job, JOB);
  assert.equal(r.added, 1);
  const padded = appendAnswersToJob(JOB, [{ line: 2, answer: `  ${ANS}  ` }]);
  assert.equal(padded.job, JOB, 'after trim');
});

test('the same answer twice in one batch is one rule; a different answer, a different line and a different case are still added', () => {
  const twice = appendAnswersToJob(JOB, [{ line: 2, answer: 'new rule' }, { line: 2, answer: 'new rule' }]);
  assert.equal(twice.job.split('\n').filter((l) => l === '~ new rule').length, 1);
  assert.equal(twice.added, 2);
  assert.equal(appendAnswersToJob(JOB, [{ line: 1, answer: ANS }]).job.split('\n').filter((l) => l === `~ ${ANS}`).length, 2, 'the same words under ANOTHER line are a rule of that line');
  assert.equal(appendAnswersToJob(JOB, [{ line: 2, answer: ANS.toUpperCase() }]).job.split('\n').filter((l) => l.startsWith('~ DAYS')).length, 1, 'exact string: a different case is a different rule');
});
