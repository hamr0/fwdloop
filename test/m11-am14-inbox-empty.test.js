// M11 amendment 14 (docs/wiki/the-module-ladder.md): with no Inbox rows only the 'nothing waiting on you' line shows; the dashed line,
// the filter note and the search/chips appear once there is at least one row. The page slice runs buildInbox against a tiny fake DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
function fnSrc(name) {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  let depth = 0;
  for (let i = PAGE.indexOf('{', start); i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}' && --depth === 0) return PAGE.slice(start, i + 1);
  }
  assert.fail(`function ${name} has no closing brace`);
}

// The dashed line, the note and the filter-bar anchor all sit inside the one wrapper the page hides.
const PANEL = PAGE.slice(PAGE.indexOf('id="panel-inbox"'), PAGE.indexOf('id="panel-runs"'));
const WRAP = PANEL.match(/<div id="inbox-filters"[^>]*>([\s\S]*?)<\/div>\s*<div id="inbox-list-old"/)?.[1] ?? '';

function run(rows) {
  const els = {};
  const mk = (id) => (els[id] ??= { id, hidden: false, innerHTML: '', textContent: '', appendChild() {} });
  const doc = { getElementById: mk };
  const src = `${fnSrc('buildInbox')}\nreturn buildInbox;`;
  const buildInbox = new Function('document', 'inboxTotal', 'textDiv', 'renderStopRow', 'inboxHeadText', src)(
    doc, rows.length, () => ({}), () => ({}), () => '');
  const el = mk('inbox-list');
  buildInbox(el, rows, 0);
  return { el, filters: mk('inbox-filters') };
}

test('empty Inbox: only the nothing-waiting line shows, the filter block is hidden', () => {
  const { el, filters } = run([]);
  assert.match(el.innerHTML, /nothing waiting on you — no stops recorded under this root/);
  assert.equal(filters.hidden, true);
});

test('one row: the dashed line, the filter note and the search/chips show', () => {
  const { filters } = run([{ section: 1 }]);
  assert.equal(filters.hidden, false);
  assert.match(WRAP, /class="rl-dash"/);
  assert.match(WRAP, /inbox-filter-note/);
  assert.match(WRAP, /inbox-filterbar-anchor/);
});
