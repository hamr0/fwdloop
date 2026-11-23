// M19 amendment 14 (docs/wiki/the-module-ladder.md): a draft refusal shows in red right under the Draft button, in one place; a shorter job-box hint.
// Server: `refusal` is the words after `draft refused at $0 — ` (null without that prefix). Page: a real headless chromium on the real panel, $0 (fake provider).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const WORDS = 'Add at least one rule (~) for this job — for example what must stay true, or what must not change.';
const HINT = 'One step per line. A ~ line under a step is its rule; add at least one. Ask: stops for you (Ask 2h: waits 2h). The last line writes the result to the Destination.';
const ZERO = 'Read the notes and list the open items\nWrite a short summary';
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const stopped = (w, id) => until(async () => { const j = await state(w, id); return j?.phase === 'stopped' ? j : null; });

test('server: a stopped draft refused at $0 carries `refusal` = the words after the prefix; without the prefix it is null', async () => {
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card({ job: ZERO }))).json().draftId;
  const s = await stopped(w, id);
  assert.equal(s.refusal, WORDS);
  assert.match(s.say, /^draft refused at \$0 — /, 'say is unchanged');
  writeFileSync(path.join(w.dir(id), 'child.log'), 'fwdloop: something else went wrong\n');
  const s2 = await state(w, id);
  assert.equal(s2.phase, 'stopped');
  assert.equal(s2.refusal, null);
});

test('page: the job-box hint reads exactly the signed words', () => {
  const m = PAGE.match(/<div class="hint">(One step per line\.[\s\S]*?)<\/div>/);
  assert.ok(m, 'hint found');
  assert.equal(m[1].replace(/<[^>]+>/g, ''), HINT);
});

for (const width of [1280, 390, 320]) {
  test(`browser at ${width}: a zero-~ Draft shows the words in red in #chat-draft-refusal only, inside the card`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = await world();
    const id = (await w.post('/api/author/draft', w.card({ job: ZERO }))).json().draftId;
    await stopped(w, id);
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor('document.getElementById("chat-draft-refusal") && document.getElementById("chat-draft-refusal").textContent !== ""'), 'the refusal shows');
    const m = await chrome.ev(`(function(){ var e = document.getElementById("chat-draft-refusal"); var b = e.getBoundingClientRect();
      var card = document.getElementById("chat-main-btn").parentElement.getBoundingClientRect(); var red = document.createElement("i"); red.style.color = "var(--red)"; document.body.appendChild(red);
      var out = { text: e.textContent, testid: e.getAttribute("data-testid"), cls: e.className, color: getComputedStyle(e).color, red: getComputedStyle(red).color, sw: e.scrollWidth, cw: e.clientWidth,
        right: b.right, cardRight: card.right, cardLeft: card.left, left: b.left, old: document.getElementById("chat-card-error").textContent, act: document.getElementById("chat-action-error").textContent,
        below: b.top >= document.getElementById("chat-main-btn").getBoundingClientRect().bottom - 1, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      red.remove(); return out; })()`);
    assert.equal(m.text, WORDS);
    assert.equal(m.testid, 'chat-draft-refusal');
    assert.match(m.cls, /\bjf-err\b/);
    assert.equal(m.color, m.red, 'red');
    assert.equal(m.old, '', 'not on the grey card line');
    assert.equal(m.act, '', 'the click-owned line is untouched');
    assert.ok(m.below, 'under the Draft button');
    assert.ok(m.sw <= m.cw, `no spill ${JSON.stringify(m)}`);
    assert.ok(m.left >= m.cardLeft - 0.5 && m.right <= m.cardRight + 0.5, `inside the card ${JSON.stringify(m)}`);
    assert.equal(m.page <= 0, true, 'no horizontal page scroll');
    if (process.env.FWDLOOP_AM14_SHOTS) await chrome.screenshot(path.join(process.env.FWDLOOP_AM14_SHOTS, `am14-${width}.png`));
  });
}
