// M10 piece 3 + am5 item 2 in a real headless browser, on the real panel, at 1280, 390 and 320 px (and 600): the look's question in the Chat box, and the Result tab's
// Your-call card. For each width: the document is not wider than the screen and no box spills past the right edge (per-box numbers are printed).
// Set FWDLOOP_WALK_OUT=<dir> to also save one screenshot per width and view. Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { world as askWorld, until, killChildrenAfter } from './m4e-world.mjs';
import { world as parkedWorld } from './m10-am4-world.mjs';
import { CITED_CHECKS_FILE } from '../src/panel/result.js';
import { raw } from './fixtures/m10-map/load.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'm10-map');
const GOLDEN = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm10-result', 'result-mvfphtwl.json'), 'utf8'));
const OUT = process.env.FWDLOOP_WALK_OUT || null;
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const JOB = ['Read my resume,', '~ under $150', '~ not a red-eye', '~ nonstop', 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ 3 sections, all under 600 words', 'Ask 30m: check it with me,', '~ nothing goes out before I accept', 'and once I accept, write it out.'].join('\n');
const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['results returned'] }] });

/** every box inside `root`: its worst right edge past the screen, and any that are past it */
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
  var rr = root.getBoundingClientRect();
  return { vw: vw, docW: document.documentElement.scrollWidth, boxes: boxes, worst: Math.round(worst), over: over.slice(0, 8), rootLeft: Math.round(rr.left), rootRight: Math.round(rr.right) };
})()`;
const ok = (m) => {
  assert.ok(m.docW <= m.vw, `the document is ${m.docW}px wide on a ${m.vw}px screen`);
  assert.deepEqual(m.over, [], `boxes past the right edge: worst ${m.worst}px`);
  assert.ok(m.worst <= 0, `worst right edge is ${m.worst}px past the screen`);
};

for (const width of [1280, 600, 390, 320]) {
  test(`browser ${width}px: the look's question in the Chat box spills nothing, and a long own answer wraps`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = await askWorld({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt') } });
    const id = (await w.post('/api/author/draft', w.card({ job: JOB, inputs: `${w.card().inputs}\nflights: ${ADDRESS}` }))).json().draftId;
    await until(async () => (await w.get(`/api/author/${id}`)).json()?.phase === 'questions-open');
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor('!document.getElementById("chat-question").hidden'), 'the Chat box shows the question');
    // am2 item 1 / am5 item 1: ONE plain chat message; the head and line rows of the M4e box are not drawn
    const shown = await chrome.ev('Array.from(document.querySelectorAll("#chat-question .q-head, #chat-question .q-line, #chat-question .q-text")).filter(function(e){ return !e.hidden && e.getBoundingClientRect().height > 0; }).map(function(e){ return e.textContent; })');
    assert.deepEqual(shown, ['A question the plan raised (1 of 1), about job line 1: Your line 1 says "not a red-eye". I read it as: departure time between 05:00 and 23:59. Agree? Answer "agree", or type your own reading (your answer is added as a new ~ rule on line 1).']);
    await chrome.ev('var a = document.getElementById("chat-q-answer"); a.value = "leaves after seven in the morning and lands before ten at night, no longunbrokenwordthatcouldpushabox".repeat(2); a.dispatchEvent(new Event("input"))');
    await chrome.ev('document.getElementById("chat-question").scrollIntoView()');
    const m = await chrome.ev(measure('#chat-question'));
    console.log(`# walk chat ${width}px ${JSON.stringify(m)}`);
    if (OUT) { mkdirSync(OUT, { recursive: true }); await chrome.screenshot(path.join(OUT, `ask-chat-${width}.png`)); }
    ok(m);
    // a blank answer gets bareloop's sentence, shown in the box
    await chrome.ev('document.getElementById("chat-q-answer").value = ""; document.getElementById("chat-q-send").click()');
    assert.ok(await chrome.waitFor('document.getElementById("chat-q-error").textContent.indexOf("An answer is needed here") === 0'), 'bareloop\'s blank-answer sentence');
    const m2 = await chrome.ev(measure('#chat-question'));
    ok(m2);
    if (OUT) await chrome.screenshot(path.join(OUT, `ask-chat-blank-${width}.png`));
  });
}

for (const width of [1280, 600, 390, 320]) {
  test(`browser ${width}px: the Result tab's Your-call card (rerun box open) spills nothing`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const url = GOLDEN.pages[0];
    const w = await parkedWorld({ mode: 'park', prose: (p) => p.replace(/guardrail: source jd = file:\S+/, `guardrail: source jd = page:${url}`) });
    writeFileSync(path.join(w.runDir, CITED_CHECKS_FILE), JSON.stringify({ lines: GOLDEN.lines.map((l) => ({ n: 3, source: 'jd', passed: true, facts: l.facts, rows: l.rows, notChecked: [] })) }));
    await chrome.open(`http://127.0.0.1:${w.port}/`, width);
    const card = 'document.querySelector("[data-testid=rl-run-job2-run-1]")';
    assert.ok(await chrome.waitFor(`!!${card}`), 'the Runs list shows the run');
    await chrome.ev(`${card}.click()`);
    assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden'), 'the run opened');
    await chrome.ev('document.getElementById("tab-result").click()');
    assert.ok(await chrome.waitFor('!!document.querySelector("[data-testid=result-accept]")'), 'the Your-call card is there');
    await chrome.ev('document.querySelector("[data-testid=result-rerun-open]").click(); var t = document.getElementById("result-rerun-text"); t.value = "only morning flights, and show the airline, longunbrokenwordthatcouldpushabox".repeat(2); t.dispatchEvent(new Event("input"))');
    await chrome.ev('document.getElementById("result-door-card").scrollIntoView()');
    const m = await chrome.ev(measure('#result-body'));
    console.log(`# walk door ${width}px ${JSON.stringify(m)}`);
    if (OUT) { mkdirSync(OUT, { recursive: true }); await chrome.screenshot(path.join(OUT, `result-door-${width}.png`)); }
    ok(m);
  });
}
