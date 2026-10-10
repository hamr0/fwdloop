// M4e amendment 41 (items 5-7): a job card shows at most its latest 7 sub-cards then "older runs: use search"; the Job tab has a "The job" title;
// each failed plan check on the Chat card is one plain sentence with the raw checker text folded under it. $0. The layout is a browser walk.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const fn = (name) => {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};

test('item 5: capChildRuns keeps the latest 7 (the list is newest first) and counts the rest; 7 or fewer hides nothing', () => {
  const cap = new Function(`${fn('capChildRuns')}\nreturn capChildRuns;`)();
  const runs = Array.from({ length: 10 }, (_, i) => ({ runId: `run-${10 - i}` }));
  const c = cap(runs);
  assert.deepEqual(c.shown.map((r) => r.runId), ['run-10', 'run-9', 'run-8', 'run-7', 'run-6', 'run-5', 'run-4']);
  assert.equal(c.hidden, 3);
  assert.equal(cap(runs.slice(0, 7)).hidden, 0);
  assert.equal(cap(runs.slice(0, 7)).shown.length, 7);
  assert.equal(cap([]).hidden, 0);
});

test('item 5: renderWorkflows draws only the capped sub-cards and, when some are hidden, one line "older runs: use search"', () => {
  const src = fn('renderWorkflows');
  assert.match(src, /capChildRuns\(childRuns\)/);
  assert.match(src, /older runs: use search/);
  assert.doesNotMatch(src, /childRuns\.forEach/);
});
