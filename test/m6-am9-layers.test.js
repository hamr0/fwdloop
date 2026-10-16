// M6 am9 item 5: docs/product/LAYERS.md carries the "Workflow or run" section, verbatim from the signed block, after "Who keeps what" and before "When something goes wrong".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const LAD = readFileSync(new URL('../docs/wiki/the-module-ladder.md', import.meta.url), 'utf8');
const LAYERS = readFileSync(new URL('../docs/product/LAYERS.md', import.meta.url), 'utf8');

function signedBlock() {
  const am = LAD.slice(LAD.indexOf('M6 amendment 9 — SIGNED'));
  const a = am.indexOf('     ```\n') + '     ```\n'.length;
  const raw = am.slice(a, am.indexOf('     ```', a));
  return raw.split('\n').map((l) => (l.startsWith('     ') ? l.slice(5) : l)).join('\n').replace(/\n+$/, '\n');
}

test('LAYERS.md holds the signed "Workflow or run" block verbatim, once, in its place', () => {
  const block = signedBlock();
  assert.match(block, /^## Workflow or run\n/);
  assert.equal(LAYERS.split(block).length - 1, 1, 'the signed block appears exactly once, byte for byte');
  const at = LAYERS.indexOf(block);
  assert.ok(at > LAYERS.indexOf('### Who keeps what'), 'after Who keeps what');
  assert.ok(at + block.length < LAYERS.indexOf('## When something goes wrong'), 'before When something goes wrong');
  assert.equal((LAYERS.match(/^## Workflow or run$/gm) ?? []).length, 1);
});
