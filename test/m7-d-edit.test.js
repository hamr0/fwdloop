// M7 piece 4 (signed item 3): `edit` may only change files where `write` may.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { resolvePrimitives, GateRefusal, WIRED_VERBS } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';

function setup() {
  const runDir = path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-m7d-')), 'flow', 'runs', 'run-1');
  mkdirSync(path.join(runDir, 'out'), { recursive: true });
  mkdirSync(path.join(runDir, 'inputs'), { recursive: true });
  const files = {
    inOut: path.join(runDir, 'out', 'a.txt'),
    state: path.join(runDir, 'state.json'),
    frozen: path.join(runDir, 'inputs', 'jd.md'),
  };
  for (const f of Object.values(files)) writeFileSync(f, 'one two three');
  const { tools } = resolvePrimitives(loadCatalogue().primitives, ['edit', 'write'], {
    runDir, inputs: [{ id: 'jd', frozen: files.frozen }],
  });
  return { tools, files, runDir };
}

test('M7: edit is a wired verb', () => {
  assert.ok(WIRED_VERBS.has('edit'));
});

test('M7: edit changes a file inside out/ in place', async () => {
  const { tools, files } = setup();
  await tools.edit.execute({ path: files.inOut, oldText: 'two', newText: '2' });
  assert.equal(readFileSync(files.inOut, 'utf8'), 'one 2 three');
});

test('M7: a relative path lands inside the run dir, like write', async () => {
  const { tools, files } = setup();
  await tools.edit.execute({ path: 'out/a.txt', oldText: 'one', newText: '1' });
  assert.equal(readFileSync(files.inOut, 'utf8'), '1 two three');
});

test('M7: edit is refused exactly where write is refused (run records, frozen inputs, outside the run)', async () => {
  const { tools, files, runDir } = setup();
  const outside = path.join(path.dirname(runDir), 'elsewhere.txt');
  writeFileSync(outside, 'one two three');
  for (const target of [files.state, files.frozen, outside]) {
    await assert.rejects(() => tools.write.execute({ path: target, content: 'x' }), (e) => e instanceof GateRefusal, `write ${target}`);
    await assert.rejects(() => tools.edit.execute({ path: target, oldText: 'two', newText: '2' }), (e) => e instanceof GateRefusal, `edit ${target}`);
    assert.equal(readFileSync(target, 'utf8'), 'one two three', `${target} must be untouched`);
  }
});
