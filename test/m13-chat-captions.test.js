// Chat card looks (hamr rulings 2026-11-01): variant C pill captions, and no [n] numbers on the tab rows. $0, static page checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');

test('captions (variant C): normal case, 13px bold pill, accent on a tinted background, no left bar, on the Chat card only; `required` small grey with its own token in all three blocks', () => {
  const rule = (sel) => new RegExp(`${sel.replace(/[.#>:()$]/g, '\\$&')}[^{]*\\{([^}]*)\\}`).exec(PAGE)?.[1];
  const cap = rule('#chat-job-card .field > label:not(.jf-thinking)');
  assert.doesNotMatch(PAGE, /jf-waitrow/, 'M13 am7: the per-ask wait boxes and their caption rule are gone');
  assert.ok(cap, 'caption rule');
  assert.match(cap, /font-size:13px/); assert.match(cap, /font-weight:700/); assert.match(cap, /text-transform:none/);
  assert.match(cap, /color:var\(--accent\)/); assert.match(cap, /border-radius:999px/); assert.match(cap, /background:color-mix\(in srgb,var\(--accent\) 16%,transparent\)/); assert.match(cap, /display:inline-block/); assert.doesNotMatch(cap, /border-left/);
  const req = rule('#chat-job-card .req');
  assert.match(req, /font-size:11px/); assert.match(req, /color:var\(--req\)/);
  assert.equal((PAGE.match(/--req:#[0-9a-f]{6};/g) ?? []).length, 3, 'a --req token in each of the three token blocks');
  assert.match(PAGE, /h2,h4\{[^}]*uppercase/, 'the Job card title keeps the global uppercase');
});
