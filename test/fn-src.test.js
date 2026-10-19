// scripts/panel-fixtures/fn-src.mjs cuts a function out of the page source by matching its braces. The old cut (up to the first "\n  }\n") ended a
// function at the first line that merely LOOKED like its closing brace; a body can hold one inside a string, a template or a nested block.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fnSrc } from '../scripts/panel-fixtures/fn-src.mjs';

const SRC = [
  '  function plain(a){',
  '    return a + 1;',
  '  }',
  '  function tricky(x){',
  '    var html = `<style>',
  '  }',
  '</style>`;',
  '    var s = "}" + \'{\' + /[}]/.source;',
  '    // a comment with a } brace',
  '    if(x){',
  '      return html + s;',
  '    }',
  '    return `${x}` + `${ `${1}` }`;',
  '  }',
  '  function after(){ return 7; }',
  '',
].join('\n');

test('fnSrc: a body holding "\\n  }\\n" in a template is cut at its real closing brace', () => {
  const f = new Function(`${fnSrc(SRC, 'tricky', '  ')}\nreturn tricky;`)();
  assert.match(f(2), /^<style>\n {2}}\n<\/style>\}\{\[\}\]$/);
  assert.equal(fnSrc(SRC, 'tricky', '  ').endsWith('\n  }'), true);
  assert.equal(fnSrc(SRC, 'after', '  '), '  function after(){ return 7; }');
});

test('fnSrc: a plain function, with and without the indent', () => {
  assert.equal(new Function(`${fnSrc(SRC, 'plain', '  ')}\nreturn plain;`)()(1), 2);
  assert.equal(new Function(`${fnSrc(SRC, 'plain')}\nreturn plain;`)()(1), 2);
});

test('fnSrc: a missing function throws by name', () => {
  assert.throws(() => fnSrc(SRC, 'nope'), /function nope not found/);
});

test('fnSrc: every function the old copies cut still cuts to valid JavaScript, from the real page', () => {
  const page = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
  for (const name of ['matchesSearch', 'filterBarHTML', 'inboxFilterRows', 'escapeXml']) {
    assert.doesNotThrow(() => new Function(fnSrc(page, name, '  ')), name);
  }
});
