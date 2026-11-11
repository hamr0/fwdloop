// M10 am29 in a real headless browser, on the real panel, at 1280, 390 and 320 px: the Draft view's question box for a reading ask, a cant-check ask and a drafter question.
// Per width: the right buttons per ask kind, the CLI's answer tail gone, the buttons post their own choice (read back from the answer file), the document is not wider than the
// screen and no box spills (per-box numbers are printed). Set FWDLOOP_WALK_OUT=<dir> for one screenshot per width and ask kind. Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { world, until, killChildrenAfter, JOB, tmp } from './m4e-world.mjs';
import { raw } from './fixtures/m10-map/load.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'm10-map');
const OUT = process.env.FWDLOOP_WALK_OUT || null;
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const LOOK_JOB = ['Read my resume,', '~ under $150', '~ not a red-eye', '~ nonstop', '~ pays well', 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ plain words only', 'Ask 30m: check it with me,', '~ nothing goes out before I accept'].join('\n');
const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['Select flight'] }] });
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
    if(e.scrollWidth > e.clientWidth + 1 && ["auto", "scroll", "hidden"].indexOf(getComputedStyle(e).overflowX) !== -1) over.push("inner-scroll " + e.tagName + "." + e.className);
  });
  return { vw: vw, docW: document.documentElement.scrollWidth, boxes: boxes, worst: Math.round(worst), over: over.slice(0, 8) };
})()`;
const ok = (m) => {
  assert.ok(m.docW <= m.vw, `the document is ${m.docW}px wide on a ${m.vw}px screen`);
  assert.deepEqual(m.over, [], `boxes past the right edge: worst ${m.worst}px`);
  assert.ok(m.worst <= 0, `worst right edge is ${m.worst}px past the screen`);
};
/** what the box shows now: the visible texts and which of its controls are visible */
const SHOWN = `(function(){
  var vis = function(id){ var e = document.getElementById(id); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; };
  return { text: document.getElementById("chat-q-text").textContent, agree: vis("chat-q-agree"), drop: vis("chat-q-drop"), or: vis("chat-q-or"), box: vis("chat-q-answer"), send: vis("chat-q-send"),
    orText: document.getElementById("chat-q-or").textContent, labels: Array.from(document.querySelectorAll("#chat-question button")).filter(function(b){ return !b.hidden; }).map(function(b){ return b.textContent; }) };
})()`;

for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: reading ask, cant-check ask and drafter question in the Draft view's box`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const snap = async (name) => { if (OUT) { mkdirSync(OUT, { recursive: true }); await chrome.screenshot(path.join(OUT, `am29-${name}-${width}.png`)); } };
    const shownNow = async (key) => { assert.ok(await chrome.waitFor(`!document.getElementById("chat-question").hidden && document.getElementById("chat-q-text").textContent.indexOf(${JSON.stringify(key)}) !== -1`), `the box shows ${key}`); return chrome.ev(SHOWN); };

    // the look's asks: a reading ask, then a cant-check ask
    const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt') } });
    const id = (await w.post('/api/author/draft', w.card({ flowName: 'job2', job: LOOK_JOB, inputs: `${w.card().inputs}\nflights: ${ADDRESS}` }))).json().draftId;
    await until(async () => (await w.get(`/api/author/${id}`)).json()?.phase === 'questions-open');
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    let s = await shownNow('not a red-eye');
    assert.deepEqual([s.agree, s.drop, s.or, s.box, s.send, s.orText, s.labels], [true, true, true, true, true, 'Or type a new rule:', ['Agree', 'Drop it', 'Send']]);
    assert.ok(!/Answer "agree"|type your own reading/.test(s.text), s.text);
    assert.ok(s.text.endsWith('I read it as: departure time between 05:00 and 23:59. Agree?'), s.text);
    await chrome.ev('document.getElementById("chat-question").scrollIntoView()');
    let m = await chrome.ev(measure('#chat-question'));
    console.log(`# walk am29 reading ${width}px ${JSON.stringify(m)}`);
    await snap('reading');
    ok(m);
    // the Agree button posts its own choice and nothing else
    await chrome.ev('document.getElementById("chat-q-agree").click()');
    s = await shownNow('pays well');
    assert.deepEqual([ANSWER(w, id, 1).choice, ANSWER(w, id, 1).answer, ANSWER(w, id, 1).rule], ['agree', 'agree', 'departure time between 05:00 and 23:59']);
    assert.deepEqual([s.agree, s.drop, s.or, s.box, s.send, s.labels], [false, true, true, true, true, ['Drop it', 'Send']], 'a cant-check ask proposes nothing: no Agree');
    assert.ok(!/Answer "drop it"|type how to check it/.test(s.text), s.text);
    assert.ok(s.text.endsWith('I can\'t check this on the page. Drop it?'), s.text);
    await chrome.ev('document.getElementById("chat-question").scrollIntoView()');
    m = await chrome.ev(measure('#chat-question'));
    console.log(`# walk am29 cant-check ${width}px ${JSON.stringify(m)}`);
    await snap('cantcheck');
    ok(m);
    // the box adds the typed words word for word, "agree, why not" is not agree
    await chrome.ev('var a = document.getElementById("chat-q-answer"); a.value = "agree, why not"; a.dispatchEvent(new Event("input")); document.getElementById("chat-q-send").click()');
    await until(() => { try { return ANSWER(w, id, 2).choice === 'rule'; } catch { return false; } });
    assert.deepEqual([ANSWER(w, id, 2).choice, ANSWER(w, id, 2).rule, ANSWER(w, id, 2).answer], ['rule', 'agree, why not', 'agree, why not']);

    // a drafter question: the box only
    const w2 = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_OFFERED_LOG: path.join(tmp('am29-walk'), 'offered.log') } });
    const id2 = (await w2.post('/api/author/draft', w2.card({ job: JOB.replace('Read my resume,', 'Read my resume QMARK,') }))).json().draftId;
    await until(async () => (await w2.get(`/api/author/${id2}`)).json()?.phase === 'questions-open');
    await chrome.open(`http://127.0.0.1:${w2.h.port}/`, width);
    s = await shownNow('What does "3 sections" mean here?');
    assert.equal(s.orText, 'Or type a new rule:');
    assert.deepEqual([s.agree, s.drop, s.or, s.box, s.send, s.labels], [false, false, true, true, true, ['Send']], 'a drafter question shows the labelled box and no buttons');
    await chrome.ev('document.getElementById("chat-question").scrollIntoView()');
    m = await chrome.ev(measure('#chat-question'));
    console.log(`# walk am29 drafter ${width}px ${JSON.stringify(m)}`);
    await snap('drafter');
    ok(m);
    await chrome.ev('document.getElementById("chat-q-send").click()');
    assert.ok(await chrome.waitFor('document.getElementById("chat-q-error").textContent.length > 0'), 'a blank answer is refused in words and the question stays');
  });
}
