// Chat card looks (hamr rulings 2026-11-01): variant A captions, and no [n] numbers on the tab rows. $0, static page checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');

test('captions (variant A): normal case, 14px bold, ink, blue left mark, on the Chat card only; `required` small grey with its own token in all three blocks', () => {
  const rule = (sel) => new RegExp(`${sel.replace(/[.#>:()$]/g, '\\$&')}[^{]*\\{([^}]*)\\}`).exec(PAGE)?.[1];
  const cap = rule('#chat-job-card .field > label:not(.jf-thinking)');
  assert.match(PAGE, /#chat-job-card \.jf-waitrow > label[^{]*\{/, 'the Run box\'s per-ask wait caption too');
  assert.ok(cap, 'caption rule');
  assert.match(cap, /font-size:14px/); assert.match(cap, /font-weight:700/); assert.match(cap, /text-transform:none/);
  assert.match(cap, /color:var\(--cap-s-ink\)/); assert.match(cap, /border-left:4px solid var\(--cap-s\)/);
  const req = rule('#chat-job-card .req');
  assert.match(req, /font-size:11px/); assert.match(req, /color:var\(--req\)/);
  assert.equal((PAGE.match(/--req:#[0-9a-f]{6};/g) ?? []).length, 3, 'a --req token in each of the three token blocks');
  assert.match(PAGE, /h2,h4\{[^}]*uppercase/, 'the Job card title keeps the global uppercase');
});
