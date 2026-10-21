// M10 piece 6 item 3: one view() poll reads a plan's questions file once, not once to size `asked` and again to build the phase.
import assert from 'node:assert/strict';
import fs, { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { world, killChildrenAfter, until } from './m4e-world.mjs';

killChildrenAfter();

test('a poll of a draft with questions reads questions.json once', async () => {
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  await until(async () => ((await w.get(`/api/author/${id}`)).json()?.phase === 'green' ? true : null));
  const plan = `${w.dir(id)}/draft`;
  writeFileSync(`${plan}/questions.json`, JSON.stringify({ questions: [{ line: 1, question: 'which one?' }] }));
  writeFileSync(`${plan}/answer-1.json`, JSON.stringify({ answer: 'that one', at: new Date().toISOString() }));
  const real = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function patched(p, ...rest) {
    if (typeof p === 'string' && p.endsWith('/draft/questions.json')) reads += 1;
    return real.call(this, p, ...rest);
  };
  syncBuiltinESMExports();
  try {
    await w.get(`/api/author/${id}`);
  } finally {
    fs.readFileSync = real;
    syncBuiltinESMExports();
  }
  assert.ok(reads >= 1, 'the shim never saw the questions read');
  assert.equal(reads, 1, `questions.json read ${reads} times in one poll`);
});
