// M4d amendment 29 (signed 2026-10-18) items 4-8: the Audit step fold (design lab C), the Run summary's two lines (F) and the step cards' marker + line (G),
// all read from the run's files ($0 replay). Part 1: the server payloads. Part 2: the real panel in headless chromium at 1280, 390 and 320 (skips when none).
// Must fail when (signed): a model step shows [human · ask] or the other way round; the summary or card numbers don't match the Audit rows; an old run
// shows made-up rounds or checks. $0: a fake provider.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { rmSync } from 'node:fs';
import path from 'node:path';

import { buildWorld, CAT } from './m4d-am29-world.mjs';
import { getRunAudit, getRunDetail } from '../src/panel/data.js';
import { DIARY_FILE, appendTool } from '../src/diary.js';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';

const HANDLES = [];
const CLOSERS = [];
after(() => Promise.all([...HANDLES.map((h) => h.close()), ...CLOSERS.map((c) => c())]));

const audit = (w) => getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
const detail = (w) => getRunDetail({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
const group = (a, step) => a.groups.find((g) => g.step === step);

test('D1: model steps are [model], the ask is [human · ask], a step with no record has no marker', async () => {
  const w = await buildWorld({ redo: true });
  assert.equal(w.result.outcome, 'complete', w.result.red);
  const a = audit(w);
  assert.equal(group(a, 'resume-text').fold.who, 'model');
  assert.equal(group(a, 'jd-text').fold.who, 'model');
  assert.equal(group(a, 'resume-summary').fold.who, 'model');
  assert.equal(group(a, 'resume-summary-approved').fold.who, 'human');
  assert.equal(group(a, 'resume-summary-output').fold, undefined, 'the send step is neither: no marker, its table as before');
});

test('D2: the step fold has the tally, a line per try with its checks and output judged, and the Round table rows in the signed words', async () => {
  const w = await buildWorld({ redo: true });
  const f = group(audit(w), 'resume-summary').fold;
  assert.equal(f.tally, 'read 6');
  const t1 = f.tries[0];
  assert.equal(t1.n, 1);
  assert.equal(t1.mark, '✗');
  assert.equal(t1.thinking, 'thinking off');
  assert.match(t1.gap, /705 words, limit 600/);
  assert.deepEqual(t1.checks.map((c) => [c.n, c.ok]), [[1, true], [2, true], [3, true], [4, false], [5, false]]);
  assert.equal(t1.output.file, 'artifacts/resume-summary.json');
  assert.deepEqual(f.tries[1].checks.map((c) => c.ok), [true, true, true, true, true]);
  // Round, Try, Action, Path, Decision in call order; a check row has no round; rounds count on across tries
  assert.deepEqual(f.rows.slice(0, 6).map((r) => [r.round, r.try, r.action, r.path, r.decision.replace(/^\$.*$/, '$')]), [
    [1, 1, 'model call', null, '$'], [1, 1, 'model · read', 'inputs/jd.md', 'allow'], [1, 1, 'model · read', 'diary.jsonl', 'deny (fs.deny)'],
    [2, 1, 'model call', null, '$'], [3, 1, 'model call', null, '$'], [null, 1, 'check', 'artifacts/resume-summary.json', '✗ #4 #5 failed'],
  ]);
  assert.deepEqual(f.rows.filter((r) => r.round !== null).map((r) => r.round).filter((x, i, all) => i === 0 || x >= all[i - 1]).length, f.rows.filter((r) => r.round !== null).length, 'rounds never go back');
});

test('D3: a human row says paused / what you said / accepted in the signed words; the card says the last answer', async () => {
  const w = await buildWorld({ redo: true });
  const f = group(audit(w), 'resume-summary-approved').fold;
  assert.deepEqual(f.rows.map((r) => r.decision), ['you said redo: "make it shorter"', 'you accepted']);
  assert.deepEqual(f.tries.map((t) => [t.n, t.mark, t.answer, t.about]), [[1, '✗', 'you said redo: "make it shorter"', 'artifacts/resume-summary.json'], [2, '✓', 'you accepted', 'artifacts/resume-summary.json']]);
  const card = detail(w).steps.find((s) => s.emits === 'resume-summary-approved');
  assert.equal(card.who, 'human');
  assert.equal(card.newLine, 'last answer: accepted');
  assert.equal(typeof card.lastAnswerAt, 'string');
});

test('D4: the summary and the cards say what the Audit rows say (calls, denied, checks, rounds, last-try checks)', async () => {
  const w = await buildWorld({ redo: true });
  const a = audit(w);
  const d = detail(w);
  const folds = a.groups.filter((g) => g.fold && g.fold.who === 'model').map((g) => g.fold);
  const count = (pred) => folds.reduce((n, f) => n + f.rows.filter(pred).length, 0);
  const model = count((r) => r.action === 'model call');
  const tool = count((r) => r.action.startsWith('model · '));
  const denied = count((r) => r.action.startsWith('model · ') && r.decision.startsWith('deny'));
  assert.equal(d.runLines.calls, `${model} model · ${tool} tool · ${denied} denied`);
  assert.ok(denied > 0 && tool > denied);
  const run = folds.reduce((n, f) => n + f.tries.reduce((m, t) => m + t.checks.length, 0), 0);
  const failed = folds.reduce((n, f) => n + f.tries.reduce((m, t) => m + t.checks.filter((c) => !c.ok).length, 0), 0);
  assert.equal(d.runLines.checks, `${run} run · ${run - failed} passed · ${failed} failed (resume-summary try 1)`);
  for (const g of a.groups.filter((x) => x.fold && x.fold.who === 'model')) {
    const card = d.steps.find((s) => s.emits === g.step);
    const rounds = g.fold.rows.filter((r) => r.action === 'model call').length;
    const last = g.fold.tries[g.fold.tries.length - 1].checks;
    assert.equal(card.newLine, `${rounds} ${rounds === 1 ? 'round' : 'rounds'} · checks on the last try ${last.filter((c) => c.ok).length}/${last.length} ${last.every((c) => c.ok) ? '✓' : '✗'}`, g.step);
    assert.equal(card.who, 'model');
  }
});

test('D5: an unknown cost never reads $0 in a Round row', async () => {
  const w = await buildWorld();
  const { appendCall } = await import('../src/diary.js');
  appendCall(w.runDir, {
    step: 'jd-text', try: 1, round: 99, at: new Date().toISOString(), model: 'deepseek-flash', costUsd: null, tokens: null, ms: null, stopReason: null, thinking: { asked: 'off', status: null },
  });
  const row = group(audit(w), 'jd-text').fold.rows.find((r) => r.round === 99);
  assert.equal(row.decision, 'cost unknown');
});

test('D6: an old run (no diaries) shows what it showed: no fold, no marker, `—` on the new lines, nothing made up', async () => {
  const w = await buildWorld();
  rmSync(path.join(w.runDir, DIARY_FILE), { force: true });
  const a = audit(w);
  assert.ok(a.groups.every((g) => g.fold === undefined));
  const d = detail(w);
  assert.deepEqual(d.runLines, { calls: '—', checks: '—' });
  assert.ok(d.steps.every((s) => s.who === null && s.newLine === '—'));
});

test('D8: opening the Audit and the Run page is a $0 replay: no network call, and no model step is ever built', async () => {
  const w = await buildWorld({ redo: true });
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('a replay must not call out'); };
  try {
    const a = audit(w);
    const d = detail(w);
    assert.ok(a.groups.some((g) => g.fold) && d.runLines.calls !== '—', 'the replay did read the records');
  } finally { globalThis.fetch = real; }
  assert.equal(calls, 0);
});

// ---- the real panel ---------------------------------------------------------------------------------------------------------------------

const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
async function open(width) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const w = await buildWorld({ redo: true });
  // 25 more tool rows on the summary step so its Round table has a second page
  const f0 = group(audit(w), 'resume-summary').fold;
  const last = f0.rows.filter((r) => r.round !== null).at(-1).round;
  for (let i = 0; i < 25; i += 1) appendTool(w.runDir, { step: 'resume-summary', try: 2, round: last, at: new Date().toISOString(), tool: 'read', path: `inputs/a-very-long-folder-name-that-could-push-the-table-wider-than-a-phone/file-${i}.md`, decision: 'allow', rule: null });
  const h = remember(await createPanelServer({ port: 0, root: w.root, settings: { home: w.home, env: {} } }));
  HANDLES.push(h);
  await chrome.open(`http://127.0.0.1:${h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden', 20000), 'the page opened the newest run');
  return { chrome, w };
}

for (const width of [1280, 390, 320]) {
  test(`D7 at ${width}: Audit fold, Run summary lines and cards on the real page; nothing spills sideways`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await open(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const { chrome } = o;
    const spill = () => chrome.ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    // Run tab: summary lines and cards
    assert.ok(await chrome.waitFor('document.querySelector("[data-testid=summary-calls]")', 20000));
    const calls = await chrome.ev('document.querySelector("[data-testid=summary-calls]").textContent');
    const checks = await chrome.ev('document.querySelector("[data-testid=summary-checks]").textContent');
    assert.match(calls, /^calls:\d+ model · \d+ tool · \d+ denied$/);
    assert.match(checks, /^checks:\d+ run · \d+ passed · \d+ failed \(resume-summary try 1\)$/);
    const cardText = await chrome.ev('Array.from(document.querySelectorAll("[data-testid^=step-card-new-]")).map(function(e){ return e.textContent; })');
    assert.equal(cardText.length, 5);
    assert.match(cardText[2], /^\d+ rounds · checks on the last try 5\/5 ✓$/);
    assert.match(cardText[3], /^last answer: accepted · /);
    assert.equal(cardText[4], '—', 'the send step has no record');
    const whos = await chrome.ev('Array.from(document.querySelectorAll("[data-testid^=step-card-who-]")).map(function(e){ return e.textContent; })');
    assert.deepEqual(whos, ['[model]', '[model]', '[model]', '[human · ask]']);
    assert.ok((await spill()) <= 0, `sideways scroll on the Run tab: ${await spill()}`);
    // Audit tab
    await chrome.ev('document.getElementById("tab-audit").click()');
    assert.ok(await chrome.waitFor('document.querySelector("[data-testid=audit-fold-body-resume-summary]")', 20000));
    const hdr = await chrome.ev('document.querySelector("#audit-group-resume-summary h4").textContent');
    assert.match(hdr, /\[model\]$/);
    assert.match(await chrome.ev('document.querySelector("#audit-group-resume-summary-approved h4").textContent'), /\[human · ask\]$/);
    const body = await chrome.ev('document.querySelector("[data-testid=audit-fold-body-resume-summary]").innerText');
    assert.match(body, /read 31/, 'the tally');
    assert.match(body, /try 1 ✗ · thinking off · 705 words, limit 600/);
    assert.match(body, /✓\s*#1 the output exists and isn't empty \(\d+(\.\d)? (B|KB)\)\s*· from every step/);
    assert.match(body, /✗\s*#4 at most 600 words \(705 words\)\s*· from line 3 ~/);
    assert.match(body, /output judged: artifacts\/resume-summary\.json · .+ · sha256 [0-9a-f]{4}…[0-9a-f]{2}/);
    assert.deepEqual(await chrome.ev('Array.from(document.querySelectorAll("[data-testid=rounds-table-resume-summary] th")).map(function(e){ return e.textContent; })'), ['Round', 'Try', 'Action', 'Path', 'Decision', 'Time']);
    assert.match(await chrome.ev('document.querySelector("#audit-group-resume-summary [data-testid=rounds-pager]").textContent'), /^showing 1–20 of \d+load more$/);
    const pager = 'document.querySelector("#audit-group-resume-summary [data-testid=rounds-pager]").textContent';
    await chrome.ev('document.querySelector("#audit-group-resume-summary [data-testid=rounds-load-more]").click()');
    assert.match(await chrome.ev(pager), /^showing 1–40 of 43load more$/);
    await chrome.ev('document.querySelector("#audit-group-resume-summary [data-testid=rounds-load-more]").click()');
    assert.equal(await chrome.ev(pager), 'showing 1–43 of 43');
    // the Round table keeps its table layout and every cell is drawn (the phone card layout of the old tables must not reach it)
    const cells = await chrome.ev('(function(){ var t = document.querySelector("[data-testid=rounds-table-resume-summary]"); var rows = Array.from(t.tBodies[0].rows); return { display: getComputedStyle(t).display, rows: rows.length, allDrawn: rows.every(function(tr){ return tr.cells.length === 6 && Array.from(tr.cells).every(function(c){ return c.offsetWidth > 0; }); }) }; })()');
    assert.deepEqual(cells, { display: 'table', rows: 43, allDrawn: true });
    // a human step: its tries and rows in the signed words
    await chrome.ev('document.querySelector("#audit-group-resume-summary-approved h4").click()');
    const hb = await chrome.ev('document.querySelector("[data-testid=audit-fold-body-resume-summary-approved]").innerText');
    assert.match(hb, /try 1 ✗ · you said redo: "make it shorter" · about artifacts\/resume-summary\.json/);
    assert.match(hb, /—\s*2\s*human\s*—\s*you accepted/);
    // no sideways page scroll; no box spills (only the Round table scrolls, inside its own box)
    const r = await chrome.ev(`(function(){
      var vw = document.documentElement.clientWidth, bad = [];
      document.querySelectorAll("#audit-groups .audit-group *").forEach(function(e){
        if(e.closest(".audit-table-scroll")) return;
        var b = e.getBoundingClientRect();
        if(b.width > 0 && b.right > vw + 0.5) bad.push(e.tagName + "." + e.className + " " + Math.round(b.right));
      });
      var sc = document.querySelector("#audit-group-resume-summary .audit-table-scroll");
      return { spill: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 5), scrollBox: sc ? { right: Math.round(sc.getBoundingClientRect().right), vw: vw } : null };
    })()`);
    assert.ok(r.spill <= 0, `sideways page scroll ${JSON.stringify(r)}`);
    assert.deepEqual(r.bad, [], `a box spills ${JSON.stringify(r)}`);
    assert.ok(r.scrollBox.right <= r.scrollBox.vw + 0.5, `the table box sits inside the page ${JSON.stringify(r)}`);
  });
}
