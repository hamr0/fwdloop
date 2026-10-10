// M6 amendment 2: a roomier job card. The left pane is 630px on a wide screen (100% on a phone); every job box on the card
// (the editable textarea and the read-only lines) grows with its text up to 8 lines, then scrolls inside: ONE shared rule.
// Source-level checks (the real rendering is a browser walk at 1280/390/320).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const rule = (sel) => { const m = PAGE.match(new RegExp('(?:^|\\n)\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[1] : null; };

test('the left pane is 630px on a wide screen and 100% on a phone', () => {
  assert.match(rule('.left-pane') ?? '', /(^|;)width:630px;/);
  const blocks = PAGE.split('@media (max-width: 899px){').slice(1).map((b) => b.split('\n  }')[0]);
  assert.ok(blocks.some((b) => /\.left-pane\{width:100%;/.test(b)), 'the phone block keeps width:100%');
});

test('one shared rule caps every job box at 8 lines: line-height 1.5, max-height 12em + padding and border', () => {
  const shared = PAGE.match(/\n\s*([^\n{]*\.ro-lines[^\n{]*)\{([^}]*)\}/g).map((s) => s.trim()).find((s) => /jf-wrap/.test(s) && /max-height/.test(s));
  assert.ok(shared, 'the textarea and .ro-lines share one rule');
  assert.match(shared, /line-height:1\.5;/);
  assert.match(shared, /max-height:calc\(12em \+ 14px\);/); // 8 x 1.5em + 6px padding x2 + 1px border x2
  assert.doesNotMatch(rule('.ro-lines') ?? '', /max-height/, '.ro-lines keeps no cap of its own');
  assert.doesNotMatch(PAGE.match(/\.job-card textarea\.jf-wrap\{[^}]*\}/)?.[0] ?? '', /max-height:200px/);
});

test('fitBox reads the CSS cap instead of a number of its own', () => {
  const fn = PAGE.match(/function fitBox\(el\)\{[\s\S]*?\n    \}/)[0];
  assert.match(fn, /getComputedStyle\(el\)\.maxHeight/);
});
