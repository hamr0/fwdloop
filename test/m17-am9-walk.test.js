// M17 am9 in a real headless browser, on the real panel, at 1280, 390 and 320 px: the column tie's picker (a native select listing every tied column, Send, Drop it; no Agree, no own-words box).
// Per width: the controls shown, the list is whole, the pick posts the `column` choice (read back from the answer file), the document is not wider than the screen, no box spills.
// Set FWDLOOP_WALK_OUT=<dir> for one screenshot per width. Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { world, until, killChildrenAfter } from './m4e-world.mjs';
import { raw } from './fixtures/m10-map/load.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'm10-map');
const OUT = process.env.FWDLOOP_WALK_OUT || null;
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const JOB = ['Read my resume,', '~ under $150', '~ not a red-eye', 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ plain words only', 'Ask 30m: check it with me,', '~ nothing goes out before I accept', 'write it out'].join('\n');
const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['Select flight'] }] });
const COLUMNS = ['Amount', 'Tax', 'Unit price incl. delivery', 'Tip', 'Service charge'];
const ANSWER = (w, id, k) => JSON.parse(readFileSync(path.join(w.dir(id), 'draft', `answer-${k}.json`), 'utf8'));

const measure = (rootSel) => `(function(){
  var vw = document.documentElement.clientWidth;
  var root = document.querySelector(${JSON.stringify(rootSel)});
  var worst = 0, over = [], boxes = 0;
  root.querySelectorAll("*").forEach(function(e){
    var r = e.getBoundingClientRect();
    if(r.width === 0 && r.height === 0) return;
    boxes++;
    if(r.right - vw > worst) worst = r.right - vw;
    if(r.right > vw + 0.5 || r.left < -0.5) over.push(e.tagName + "." + e.className + "#" + e.id + " right=" + Math.round(r.right));
  });
  return { vw: vw, docW: document.documentElement.scrollWidth, boxes: boxes, worst: Math.round(worst), over: over.slice(0, 8) };
})()`;
const SHOWN = `(function(){
  var vis = function(id){ var e = document.getElementById(id); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; };
  var sel = document.getElementById("chat-q-column");
  return { text: document.getElementById("chat-q-text").textContent, agree: vis("chat-q-agree"), drop: vis("chat-q-drop"), or: vis("chat-q-or"), box: vis("chat-q-answer"), send: vis("chat-q-send"), picker: vis("chat-q-column"),
    options: Array.from(sel.options).map(function(o){ return o.textContent; }), labels: Array.from(document.querySelectorAll("#chat-question button")).filter(function(b){ return !b.hidden; }).map(function(b){ return b.textContent; }) };
})()`;

for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: a column tie shows the picker, Send and Drop it (no Agree, no box) and posts the pick`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt') } });
    const id = (await w.post('/api/author/draft', w.card({ flowName: 'job2', job: JOB, inputs: `${w.card().inputs}\nflights: ${ADDRESS}` }))).json().draftId;
    await until(async () => (await w.get(`/api/author/${id}`)).json()?.phase === 'questions-open');
    // the question the drafter records for a tie (the drafter's own record is proven in test/m17-am9-tie.test.js)
    const f = path.join(w.dir(id), 'draft', 'questions.json');
    const j = JSON.parse(readFileSync(f, 'utf8'));
    Object.assign(j.questions[0], {
      proposal: null, question: `I found ${COLUMNS.length} columns matching 'Price': ${COLUMNS.join(', ')}. Choose one. (your answer replaces that ~ rule on line 2).`,
      columns: COLUMNS, readings: Object.fromEntries(COLUMNS.map((c) => [c, `use the column '${c}' for 'Price'`])),
    });
    writeFileSync(f, JSON.stringify(j));
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor('!document.getElementById("chat-question").hidden && document.getElementById("chat-q-column").options.length > 1'), 'the box shows the picker');
    const s = await chrome.ev(SHOWN);
    assert.deepEqual([s.agree, s.drop, s.or, s.box, s.send, s.picker], [false, true, false, false, true, true], JSON.stringify(s));
    assert.deepEqual(s.labels, ['Drop it', 'Send']);
    assert.deepEqual(s.options, ['Choose a column', ...COLUMNS], 'every tied column, none cut');
    assert.ok(s.text.includes(`I found 5 columns matching 'Price': ${COLUMNS.join(', ')}. Choose one. (your answer replaces that ~ rule on line 2).`), s.text);
    await chrome.ev('document.getElementById("chat-question").scrollIntoView()');
    const m = await chrome.ev(measure('#chat-question'));
    console.log(`# walk am9 tie ${width}px ${JSON.stringify(m)}`);
    if (OUT) { mkdirSync(OUT, { recursive: true }); await chrome.screenshot(path.join(OUT, `am9-tie-${width}.png`)); }
    assert.ok(m.docW <= m.vw, `the document is ${m.docW}px wide on a ${m.vw}px screen`);
    assert.deepEqual(m.over, [], `boxes past the right edge: worst ${m.worst}px`);
    // Send with nothing picked is refused in the door's words and the question stays
    await chrome.ev('document.getElementById("chat-q-send").click()');
    assert.ok(await chrome.waitFor('document.getElementById("chat-q-error").textContent.indexOf("pick one of the columns") !== -1'), 'an empty pick is refused in words');
    // the pick posts the `column` choice
    await chrome.ev('var s = document.getElementById("chat-q-column"); s.value = "Tax"; s.dispatchEvent(new Event("change")); document.getElementById("chat-q-send").click()');
    await until(() => { try { return ANSWER(w, id, 1).choice === 'column'; } catch { return false; } });
    assert.deepEqual([ANSWER(w, id, 1).choice, ANSWER(w, id, 1).answer, ANSWER(w, id, 1).rule], ['column', 'Tax', "use the column 'Tax' for 'Price'"]);
  });
}
