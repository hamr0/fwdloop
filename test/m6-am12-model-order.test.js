// M6 am12: on the Reuse card ("Run a signed flow") the Model line and its picker sit right under SIGNED FLOW, above THE JOB. Nothing else moves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const RUN = PAGE.slice(PAGE.indexOf('<div id="jf-run" data-testid="jf-run" hidden>'));

test('Reuse card DOM order: Signed flow, then the Model line and picker, then The job, then the rest', () => {
  const at = (id) => { const i = RUN.indexOf(`id="${id}"`); assert.ok(i > 0, id); return i; };
  const order = ['jf-run-flow', 'jf-err-flow', 'jf-run-model', 'jf-run-pick', 'jf-err-run-model', 'jf-run-jobbox', 'jf-run-job-hint', 'jf-run-newname', 'jf-run-dest', 'jf-run-inputs', 'jf-run-cap'];
  const pos = order.map(at);
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, `order: ${order.join(' < ')}`);
  assert.equal((RUN.match(/\sid="jf-run-model"/g) ?? []).length, 1);
  // the model line is not inside The job's field any more
  const jobField = RUN.slice(RUN.indexOf('data-testid="jf-run-job-field"'), RUN.indexOf('id="jf-run-newname-field"'));
  assert.doesNotMatch(jobField, /jf-run-model|jf-run-pick|jf-err-run-model/);
});
