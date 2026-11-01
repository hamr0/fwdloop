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

test('captions: the three Inbox headers are the same bars (waiting amber, working teal, answered grey) with the count in the pill', () => {
  const mkDiv = (cls) => { const d = { className: cls, attrs: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; } }; return d; };
  const doc = { getElementById: () => ({ hidden: false, innerHTML: '', textContent: '', appendChild(c) { heads.push(c); } }) };
  const heads = [];
  const build = new Function('document', 'inboxTotal', 'textDiv', 'renderStopRow', 'inboxHeadText', `${PAGE.match(/ {2}var INBOX_HEADS = [^\n]*/)[0]}\n${cutFn(PAGE, 'buildInbox', '  ')}\nreturn buildInbox;`)(
    doc, 3, mkDiv, () => ({}), (s, n) => `head ${s} (${n})`);
  const mkEl = () => ({ id: 'inbox-list', innerHTML: '', appendChild(c) { heads.push(c); } });
  build(mkEl(), [{ section: 1 }, { section: 1 }, { section: 2 }, { section: 3 }], 0);
  const want = { 1: ['w', 'waiting on you', 2], 2: ['r', 'working on your answer', 1], 3: ['j', 'answered and expired', 1] };
  const hs = heads.filter((h) => h.attrs && h.attrs['data-testid']);
  assert.equal(hs.length, 3);
  for (const h of hs) {
    const sec = Number(h.attrs['data-testid'].slice(-1));
    const [c, word, n] = want[sec];
    assert.equal(h.className, `inbox-h rl-cap rl-cap-${c}`);
    assert.equal(h.innerHTML.replace(/<[^>]*>/g, ''), `${word} (${n})`);
    assert.match(h.innerHTML, new RegExp(`<span class="rl-n">${n}</span>`));
    assert.equal(h.attrs['aria-label'], `head ${sec} (${n})`);
  }
});
