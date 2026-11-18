// P4c: bareloop layout - the card's list is one plan view (#chat-plan), rows found by data-testid.
// M16 P4 item 4 in a real headless browser, on the real panel, at 1280, 390 and 320 px: the plan card's list - every check row with exactly one tag, Drop only on an [agent] row, Add on a suggestion, the
// controls POST row-edit (Add makes the row an [agent] check with a Drop, Drop gives the suggestion back), the document is not wider than the screen and no box spills (per-box numbers are printed).
// Set FWDLOOP_WALK_OUT=<dir> for one screenshot per width. Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { world, until, killChildrenAfter } from './m4e-world.mjs';
import { BOX_JOB } from './m4e-box-fixture.mjs';

killChildrenAfter();
const OUT = process.env.FWDLOOP_WALK_OUT || null;
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const JOB = BOX_JOB.replace('200ish each,', '200ish each,\n~ exactly 3 bullets');
const SUGGEST = JSON.stringify({ checks: [{ line: 3, guardrail: 1, rule: 'listItems', value: 3 }] });
const LEDGER = JSON.stringify({ extra: [{ line: 3, kind: 'phrase', phrase: 'Rust engineer', source: 'resume' }] });
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
const ok = (m) => {
  assert.ok(m.docW <= m.vw, `the document is ${m.docW}px wide on a ${m.vw}px screen`);
  assert.deepEqual(m.over, [], `boxes past the right edge: worst ${m.worst}px`);
};
const IDS = 'Array.from(document.querySelectorAll("[id]")).map(function(e){return e.id;}).filter(function(id,i,a){return a.indexOf(id)!==i;})';
/** P4c: bareloop layout - each check row and each suggestion row of the plan view: its text, how many tags, which buttons */
const ROWS = `[{id: "chat-plan", rows: Array.from(document.querySelectorAll("#chat-plan [data-testid=plan-check], #chat-plan [data-testid=plan-suggest-row]")).map(function(d){
  return {text: d.textContent.replace(/\\s+/g, " ").trim(), tags: d.querySelectorAll(".by").length, by: Array.from(d.querySelectorAll(".by")).map(function(x){return x.getAttribute("data-by");}), op: Array.from(d.querySelectorAll("button")).map(function(x){return x.getAttribute("data-rowop");})};
})}]`;

for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: the plan card's list - tags, Drop, Add`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const snap = async (name) => { if (OUT) { mkdirSync(OUT, { recursive: true }); await chrome.screenshot(path.join(OUT, `m16-p4-${name}-${width}.png`)); } };
    const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST, FWDLOOP_TEST_DRAFT_LEDGER: LEDGER } });
    writeFileSync(path.join(w.inDir, 'resume.md'), '# Resume\n\nJo Doe, a Rust engineer for ten years.\n');
    const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
    await until(async () => (await w.get(`/api/author/${id}`)).json()?.phase === 'questions-open');
    assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' })).status, 202);
    await until(async () => (await w.get(`/api/author/${id}`)).json()?.phase === 'green');
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor('!!document.querySelector("button[data-rowop=add]")'), 'the suggestion has an Add button');
    assert.deepEqual(await chrome.ev(IDS), [], 'element ids are unique');
    let blocks = await chrome.ev(ROWS);
    const rows = blocks.flatMap((b) => b.rows).filter((r) => r.by.length || r.op.length);
    assert.ok(rows.every((r) => r.tags === 1), `every check row has exactly one tag: ${JSON.stringify(rows)}`);
    const you = rows.filter((r) => r.by[0] === 'you');
    assert.ok(you.length >= 1 && you.every((r) => r.op.length === 0), `a [you] row has no Drop: ${JSON.stringify(you)}`);
    assert.deepEqual(rows.filter((r) => r.op.includes('add')).map((r) => r.by), [['agent']]);
    await chrome.ev('document.getElementById("chat-extras").scrollIntoView()');
    let m = await chrome.ev(measure('#chat-extras'));
    console.log(`# walk m16-p4 card ${width}px ${JSON.stringify(m)}`);
    await snap('card');
    ok(m);
    // Add: a new plan, the suggestion is a check of the agent now, with a Drop
    await chrome.ev('document.querySelector("button[data-rowop=add]").click()');
    assert.ok(await chrome.waitFor('!!document.querySelector("button[data-rowop=drop]") && !document.querySelector("button[data-rowop=add]")'), 'Add made the row a check with a Drop');
    blocks = await chrome.ev(ROWS);
    const agent = blocks.flatMap((b) => b.rows).filter((r) => r.op.includes('drop'));
    assert.equal(agent.length, 1);
    assert.deepEqual([agent[0].by, agent[0].tags], [['agent'], 1]);
    assert.match(agent[0].text, /Rust engineer/);
    m = await chrome.ev(measure('#chat-extras'));
    console.log(`# walk m16-p4 after-add ${width}px ${JSON.stringify(m)}`);
    await snap('after-add');
    ok(m);
    assert.deepEqual(await chrome.ev(IDS), []);
    // Drop: the suggestion is back, marked as dropped
    await chrome.ev('document.querySelector("button[data-rowop=drop]").click()');
    assert.ok(await chrome.waitFor('!!document.querySelector("button[data-rowop=add]") && !document.querySelector("button[data-rowop=drop]")'), 'Drop gave the suggestion back');
    assert.match(await chrome.ev('document.querySelector("#chat-plan [data-testid=plan-suggested]").textContent'), /\(you dropped it\)/);
    ok(await chrome.ev(measure('#chat-extras')));
  });
}

for (const width of [1280, 390, 320]) {
  test(`browser ${width}px: the Audit's Checks fold - folded, opens to Checks / Not checked / Always checked rows with tags and a state sign, no spill`, { skip: SKIP && 'no browser' }, async (t) => {
    const chrome = await launchChrome();
    if (!chrome) { t.skip('no chromium installed'); return; }
    CLOSERS.push(async () => chrome.close());
    const w = await world();
    const { flow } = await w.signedFlow();
    assert.ok((await w.post('/api/author/run', { flow, inputs: w.inputs(), runId: 'r1' })).json().startId);
    await until(async () => (await w.get(`/api/runs/${flow}/r1/audit`)).json()?.auditChecks?.always?.every((r) => r.result !== 'none') || null, 20000);
    await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
    assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden', 20000), 'the page opened the newest run');
    await chrome.ev('document.getElementById("tab-audit").click()');
    assert.ok(await chrome.waitFor('!!document.querySelector("#audit-groups [data-testid=audit-checks-group]")', 20000), 'the Checks fold is there for a plan with a list');
    assert.equal(await chrome.ev('document.querySelector("[data-testid=audit-checks-body]").hidden'), true, 'folded on open');
    await chrome.ev('document.querySelector("[data-testid=audit-checks-toggle]").click()');
    assert.equal(await chrome.ev('document.querySelector("[data-testid=audit-checks-body]").hidden'), false);
    const shown = await chrome.ev('Array.from(document.querySelectorAll("[data-testid=audit-check-row]")).map(function(r){ return {text: r.textContent.replace(/\\s+/g, " ").trim(), tags: r.querySelectorAll(".by").length, by: Array.from(r.querySelectorAll(".by")).map(function(x){return x.getAttribute("data-by");}), result: r.getAttribute("data-result")}; })');
    // M17 am5 (D3): the job's Ask line carries a ~ rule, one Not checked row [you] with the signed reason; every other row is a default check that passed
    const notRows = shown.filter((r) => r.result === 'not-checked');
    assert.deepEqual(notRows.map((r) => [r.by, r.tags]), [[['you'], 1]], JSON.stringify(shown));
    assert.match(notRows[0].text, /you judge it at the Ask/);
    const passedRows = shown.filter((r) => r.result !== 'not-checked');
    assert.ok(passedRows.length >= 2 && passedRows.every((r) => r.tags === 1 && r.by[0] === 'default' && r.result === 'passed'), JSON.stringify(shown));
    // P4c: bareloop layout - the header reads "checks · N passed", lowercase, after the caret and the state sign
    assert.match(await chrome.ev('document.querySelector("[data-testid=audit-checks-toggle]").textContent'), /^\s*\[.\]\s*checks\s*·\s*\d+ passed/);   // the caret is the step fold's ::before, not text
    // hamr ask: only the word "checks" in the header is bold; the text itself is unchanged
    assert.deepEqual(await chrome.ev('Array.from(document.querySelectorAll("[data-testid=audit-checks-toggle] b:not(.st-word)")).map(function(b){return b.textContent;})'), ['checks'], 'the word checks is bold');
    // hamr ask: the header word "checks" is the same size and color as the rows' "passed"
    const wordStyle = await chrome.ev('(function(){ var h = document.querySelector("[data-testid=audit-checks-toggle] b:not(.st-word)"), p = document.querySelector("[data-testid=audit-check-row][data-result=passed] .st-word"), a = getComputedStyle(h), b = getComputedStyle(p); return {head: [a.fontSize, a.color, a.fontWeight], row: [b.fontSize, b.color, b.fontWeight], rowText: p.textContent}; })()');
    console.log(`# checks word ${width}px ${JSON.stringify(wordStyle)}`);
    assert.equal(wordStyle.rowText, 'passed');
    assert.deepEqual(wordStyle.head, wordStyle.row, 'the word checks matches the rows\' passed in size, color, weight');
    // hamr ask: every passed state word in an Audit group header (step groups, the run summary row) is the same as the word "checks": size, weight, color; the [\u2713] sign keeps its green
    const grp = await chrome.ev('(function(){ var c = getComputedStyle(document.querySelector("[data-testid=audit-checks-toggle] b:not(.st-word)")); var out = {checks: [c.fontSize, c.color, c.fontWeight], groups: []}; document.querySelectorAll("[data-testid=audit-group-state]").forEach(function(e){ var s = getComputedStyle(e), g = e.querySelector(".audit-sign-glyph"); out.groups.push({text: e.textContent, cls: e.className, style: [s.fontSize, s.color, s.fontWeight], glyph: g ? getComputedStyle(g).color : null}); }); out.green = getComputedStyle(document.documentElement).getPropertyValue("--green"); return out; })()');
    console.log(`# group passed word ${width}px ${JSON.stringify(grp)}`);
    const passedGroups = grp.groups.filter((g) => /passed/.test(g.text));
    assert.ok(passedGroups.length >= 1, JSON.stringify(grp));
    for (const g of passedGroups) {
      assert.deepEqual(g.style, grp.checks, `a passed group word matches the checks word: ${JSON.stringify(g)}`);
      assert.notEqual(g.glyph, grp.checks[1], 'the sign glyph keeps its own (green) color');
    }
    for (const g of grp.groups.filter((x) => /failed|stopped/.test(x.text))) assert.notEqual(g.style[1], grp.checks[1], `a failed/stopped word keeps its red/grey: ${JSON.stringify(g)}`);
    // hamr ask: the checks fold row lines up with a step fold row - same box, height, caret x, [\u2713] x, text size, border
    const ALIGN = `(function(){
      function rc(e){ var r = e.getBoundingClientRect(); return {x: r.left, w: r.width, h: r.height}; }
      var c = document.querySelector("[data-testid=audit-checks-group]"), ct = c.querySelector("[data-testid=audit-checks-toggle]");
      var g = document.querySelector("#audit-groups .audit-group.audit-fold:not([data-testid=audit-checks-group]):not([data-testid=audit-group-schedule])"), gh = g.querySelector("h4.audit-status-header");
      function mk(box, head, caret, glyph, rest){ var b = getComputedStyle(box); return {box: rc(box), head: rc(head), caretX: caret.x, glyphX: glyph.getBoundingClientRect().left, restFont: getComputedStyle(rest).fontSize, restLine: getComputedStyle(rest).lineHeight, border: [b.borderTopWidth, b.borderTopColor, b.borderLeftWidth, b.boxShadow]}; }
      var stepCaret = document.createRange(); stepCaret.setStart(gh, 0); stepCaret.setEnd(gh, 0);
      var sg = gh.querySelector(".audit-sign-glyph") || gh.querySelector(".dot");
      var stepRest = gh.querySelector(".audit-fold-tail") || gh;
      return {checks: mk(c, ct, {x: ct.getBoundingClientRect().left}, ct.querySelector(".dot, .audit-sign-glyph"), ct), step: mk(g, gh, {x: gh.getBoundingClientRect().left}, sg, stepRest), cdot: ct.querySelector(".dot, .audit-sign-glyph").className, sdot: sg.className, stepTailText: stepRest.textContent};
    })()`;
    await chrome.ev('document.querySelector("[data-testid=audit-checks-toggle]").click()');   // fold it: the boxes are compared closed
    assert.equal(await chrome.ev('document.querySelector("[data-testid=audit-checks-body]").hidden'), true);
    const al = await chrome.ev(ALIGN);
    console.log(`# align ${width}px ${JSON.stringify(al)}`);
    const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1, `${msg}: checks ${a} vs step ${b}`);
    near(al.checks.box.x, al.step.box.x, 'box x'); near(al.checks.box.w, al.step.box.w, 'box width'); if (al.step.box.h < 40) near(al.checks.box.h, al.step.box.h, 'box height');   // the step row wraps to 2 lines on a phone (long step name): only a one-line step row has the one-line height
    else assert.ok(al.checks.box.h <= al.step.box.h + 1, `a one-line checks row is not taller than a wrapped step row: ${al.checks.box.h} vs ${al.step.box.h}`);
    near(al.checks.glyphX, al.step.glyphX, '[\u2713] x');
    assert.deepEqual(al.checks.border, al.step.border, 'border width, color, shadow');
    assert.equal(al.checks.restFont, al.step.restFont, 'rest-of-line font size');
    assert.deepEqual(await chrome.ev(IDS), [], 'element ids are unique');
    await chrome.ev('document.querySelector("[data-testid=audit-checks-group]").scrollIntoView()');
    const m = await chrome.ev(measure('[data-testid=audit-checks-group]'));
    console.log(`# walk m16-p4 audit ${width}px ${JSON.stringify(m)}`);
    if (OUT) { mkdirSync(OUT, { recursive: true }); await chrome.screenshot(path.join(OUT, `m16-p4-audit-${width}.png`)); }
    ok(m);
  });
}

// Reply order: the run's audit lands BEFORE its detail (the detail is held back 1.5 s by the page's own fetch, nothing in the page is edited).
// The Audit group headers must still read with their sign words ("[✓] passed"), because the words come with the detail.
test('browser: the Audit group words carry their sign when the audit reply lands before the run detail', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const w = await world();
  const { flow } = await w.signedFlow();
  assert.ok((await w.post('/api/author/run', { flow, inputs: w.inputs(), runId: 'r1' })).json().startId);
  await until(async () => (await w.get(`/api/runs/${flow}/r1/audit`)).json()?.auditChecks?.always?.every((r) => r.result !== 'none') || null, 20000);
  const exact = `/api/runs/${flow}/r1`;
  await chrome.send('Page.enable');
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){ var f = window.fetch; window.fetch = function(u, o){ var p = f.apply(this, arguments); if(String(u) === ${JSON.stringify(exact)}) return p.then(function(r){ return new Promise(function(ok){ setTimeout(function(){ ok(r); }, 1500); }); }); return p; }; })();` });
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  await chrome.ev('document.getElementById("tab-audit").click()');
  assert.ok(await chrome.waitFor('!!document.querySelector("#audit-groups [data-testid=audit-group-state]")', 20000), 'the audit groups are painted');
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden', 20000), 'the run detail painted');
  await new Promise((r) => setTimeout(r, 3500));   // past the held detail and at least one poll
  const groups = await chrome.ev('Array.from(document.querySelectorAll("[data-testid=audit-group-state]")).map(function(e){ return {text: e.textContent, cls: e.className}; })');
  const passed = groups.filter((g) => /passed/.test(g.text) && /audit-passed-word/.test(g.cls));
  assert.ok(passed.length >= 1, JSON.stringify(groups));
});
