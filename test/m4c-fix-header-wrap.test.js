// M4c-fix item 21: at 320 px a long unbroken run title must wrap inside the Run header. A source test
// cannot see rendering, so it pins the two rules the real-browser walk (320/390/1280, per-box spill:
// every element's right edge vs its parent and the viewport) showed are what keeps it inside.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const page = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const rule = (sel) => {
  const m = new RegExp(`^\\s*${sel.replace(/[.\-]/g, '\\$&')}\\{([^}]*)\\}`, 'm').exec(page);
  assert.ok(m, `rule ${sel} exists`);
  return m[1];
};

test('the Run header title can shrink and its run title breaks anywhere', () => {
  const h2 = rule('.rp-header h2');
  assert.match(h2, /overflow-wrap:anywhere/, 'an unbroken run title wraps');
  assert.match(h2, /min-width:0/, 'the flex item may shrink below its text width');
  const box = rule('.rp-header-title');
  assert.match(box, /min-width:0/);
  assert.match(box, /max-width:100%/, 'the title box stays inside the header');
});
