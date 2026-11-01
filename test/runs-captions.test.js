// Runs tab captions (hamr 2026-11-01, "A no caps"): Needs you, Scheduled and Jobs are full-width bars, one colour token per section
// (amber / blue / grey), the count in a pill; job cards carry a divider. Fails if the CSS or the markup is reverted. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnSrc as cutFn } from '../scripts/panel-fixtures/fn-src.mjs';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const sect = new Function(`${cutFn(PAGE, 'rlSectHtml', '  ')}\nreturn rlSectHtml;`)();

test('captions: the three section captions carry their section class and keep their text', () => {
  const w = sect('Needs you', 2, '', 'w');
  const s = sect('Scheduled', 3, '', 's');
  const j = sect('Jobs', 31, '· run in the last 30 days', 'j');
  assert.match(w, /class="rl-sect rl-cap rl-cap-w"/);
  assert.match(s, /class="rl-sect rl-cap rl-cap-s"/);
  assert.match(j, /class="rl-sect rl-cap rl-cap-j"/);
  const txt = (h) => h.replace(/<[^>]*>/g, '');
  assert.equal(txt(w), 'Needs you (2)');
  assert.equal(txt(s), 'Scheduled (3)');
  assert.equal(txt(j), 'Jobs (31) · run in the last 30 days');
  assert.match(j, /<span class="rl-note">· run in the last 30 days<\/span>/);
  assert.match(w, /<span class="rl-n">2<\/span>/);
  const r = sect('Running now', 1, '', 'r');
  assert.match(r, /class="rl-sect rl-cap rl-cap-r" data-testid="rl-cap-r"/);
  assert.equal(r.replace(/<[^>]*>/g, ''), 'Running now (1)');
  assert.match(PAGE, /rlSectHtml\("Running now", m\.running\.length, "", "r"\)/, 'Running now is drawn with the bar');
});

test('captions: each section colour is a token with a dark and a light value; no caps, no letter-spacing; job cards have a divider', () => {
  for (const t of ['w', 's', 'j', 'r']) {
    assert.match(PAGE, new RegExp(`\\.rl-cap\\.rl-cap-${t}\\{--cap-c:var\\(--cap-${t}\\)`));
    assert.equal(PAGE.split(`--cap-${t}:`).length - 1, 3, `--cap-${t} defined in dark, light and light-attr blocks`);
  }
  const rule = PAGE.match(/\.rl-cap\{([^}]*)\}/)[1];
  assert.match(rule, /font-size:15px/);
  assert.match(rule, /border-left:5px solid var\(--cap-c\)/);
  assert.match(rule, /background:var\(--cap-bg\)/);
  assert.doesNotMatch(rule, /uppercase|letter-spacing/);
  assert.match(PAGE, /\.rl-jobcard::before\{[^}]*height:2px/);
  assert.match(PAGE, /class="rl-card rl-jobcard/);
});
