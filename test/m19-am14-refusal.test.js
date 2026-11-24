// M19 amendment 14 (docs/wiki/the-module-ladder.md): a shorter job-box hint; a refusal in red (am14 items 1-2 are replaced by am14b: its words sit under the box, see m19-am14b-refusal-box.test.js).
// Server: `refusal` is the typed {box, words} of the child's refusal-record line (am14b; was the words string), null without that line. Page: a real headless chromium on the real panel, $0 (fake provider).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const WORDS = 'Add at least one rule (~) for this job — for example what the result must include, or what must stay true.';
const HINT = 'One step per line. A ~ line under a step is its rule; add at least one. Ask: stops for you (Ask 2h: waits 2h). The last line writes the result to the Destination.';
const ZERO = 'Read the notes and list the open items\nWrite a short summary';
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const stopped = (w, id) => until(async () => { const j = await state(w, id); return j?.phase === 'stopped' ? j : null; });

test('server: a stopped draft refused at $0 carries `refusal` = {box, words} (am14b pin: was the words string); without a record line it is null', async () => {
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card({ job: ZERO }))).json().draftId;
  const s = await stopped(w, id);
  assert.deepEqual(s.refusal, { box: 'job', words: WORDS });
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
  test(`browser at ${width}: a zero-~ Draft shows its words in red under Job and the pointer in #chat-draft-refusal (am14b pin: the words moved), inside the card`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = await world();
    const id = (await w.post('/api/author/draft', w.card({ job: ZERO }))).json().draftId;
    await stopped(w, id);
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor('document.getElementById("jf-err-job").textContent !== ""'), 'the refusal shows');
    const m = await chrome.ev(`(function(){ var e = document.getElementById("jf-err-job"); var b = e.getBoundingClientRect();
      var card = document.getElementById("chat-main-btn").parentElement.getBoundingClientRect(); var red = document.createElement("i"); red.style.color = "var(--red)"; document.body.appendChild(red);
      var out = { ptr: document.getElementById("chat-draft-refusal").textContent, text: e.textContent, testid: e.getAttribute("data-testid"), cls: e.className, color: getComputedStyle(e).color, red: getComputedStyle(red).color, sw: e.scrollWidth, cw: e.clientWidth,
        right: b.right, cardRight: card.right, cardLeft: card.left, left: b.left, old: document.getElementById("chat-card-error").textContent, act: document.getElementById("chat-action-error").textContent,
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      red.remove(); return out; })()`);
    assert.equal(m.text, WORDS);
    assert.equal(m.testid, 'jf-err-job');
    assert.match(m.cls, /\bjf-err\b/);
    assert.equal(m.color, m.red, 'red');
    assert.equal(m.ptr, 'Not drafted: fix the red line above.');
    assert.equal(m.old, '', 'not on the grey card line');
    assert.equal(m.act, '', 'the click-owned line is untouched');
    assert.ok(m.sw <= m.cw, `no spill ${JSON.stringify(m)}`);
    assert.ok(m.left >= m.cardLeft - 0.5 && m.right <= m.cardRight + 0.5, `inside the card ${JSON.stringify(m)}`);
    assert.equal(m.page <= 0, true, 'no horizontal page scroll');
    if (process.env.FWDLOOP_AM14_SHOTS) await chrome.ev('document.getElementById("chat-draft-refusal").scrollIntoView({block: "center"}); true');
    if (process.env.FWDLOOP_AM14_SHOTS) await chrome.screenshot(path.join(process.env.FWDLOOP_AM14_SHOTS, `am14-${width}.png`));
  });
}

// F259: a stopped (refused) draft leaves the boxes to the person: the poll must not write #jf-job back from the old card.
test('browser: after a $0 refusal the poll leaves a newly typed job alone, and the next Draft sends it', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card({ job: ZERO }))).json().draftId;
  await stopped(w, id);
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  assert.ok(await chrome.waitFor('document.getElementById("chat-draft-refusal") && document.getElementById("chat-draft-refusal").textContent !== ""'), 'the refusal shows');
  const NEW = 'Read the notes and list the open items\n~ lists every open item\nWrite a short summary';
  await chrome.ev(`(function(){ var b = document.getElementById("jf-job"); b.value = ${JSON.stringify(NEW)}; b.dispatchEvent(new Event("input", {bubbles: true})); return true; })()`);
  await new Promise((r) => setTimeout(r, 7000));
  assert.equal(await chrome.ev('document.getElementById("jf-job").value'), NEW, 'the poll did not overwrite the typed job');
  await chrome.ev('document.getElementById("chat-main-btn").click(); true');
  const sent = await until(async () => {
    const ids = readdirSync(path.join(w.root, '.drafts')).filter((d) => d !== id);
    return ids.length ? ids[0] : null;
  });
  assert.equal(JSON.parse(readFileSync(path.join(w.dir(sent), 'card.json'), 'utf8')).job, NEW);
});
