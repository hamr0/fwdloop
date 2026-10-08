// M4e amendment 4 (Run-tab Stop and Resume, the Resume form) and amendment 5 (the Run form) in src/panel/index.html. Source-level, like the
// other page tests: the page's own pure functions are cut out and run, the markup is read for what must (not) be there. Real rendering is
// walked in a browser (see the report).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));

function fnSrc(name) {
  const start = CHAT.indexOf(`    function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in the Chat block`);
  return CHAT.slice(start, CHAT.indexOf('\n    }\n', start) + 7);
}
const load = (name) => new Function(`${fnSrc(name)}\nreturn ${name};`)();
/** The element block starting at `<div id="…"` through its matching close. */
function block(id) {
  const at = PAGE.indexOf(`id="${id}"`);
  assert.ok(at !== -1, id);
  const start = PAGE.lastIndexOf('<div', at);
  let depth = 0;
  const re = /<\/?div\b/g;
  re.lastIndex = start;
  for (let m = re.exec(PAGE); m; m = re.exec(PAGE)) {
    depth += m[0] === '<div' ? 1 : -1;
    if (depth === 0) return PAGE.slice(start, PAGE.indexOf('>', m.index) + 1);
  }
  throw new Error(`unbalanced ${id}`);
}
const base = { mode: 'run', session: false, startOk: true, busy: false, capUsd: '0.25' };

test('am5 item 3: the Run form\'s button is Run (one click) for inputs alone, Sign & run (two clicks, the hash on the label) when the destination, cap or an ask wait differs', () => {
  const mb = load('mainButtonFor');
  assert.deepEqual(mb({ ...base, runDiffers: false }), { text: 'Run — spends up to $0.25', action: 'run', disabled: false });
  assert.deepEqual(mb({ ...base, runDiffers: true }), { text: 'Sign & run', action: 'run-sign-prepare', disabled: false });
  assert.deepEqual(mb({ ...base, runDiffers: true, startOk: false }), { text: 'Sign & run', action: 'run-sign-prepare', disabled: true });
  const clicked = mb({ ...base, runDiffers: true, runSignClicked: true, hash: '7cc0122f0f3058b12a57', capUsd: '0.40' });
  assert.deepEqual(clicked, { text: 'Sign 7cc0122f & run · $0.40', action: 'run-sign', disabled: false });
  assert.ok(clicked.text.length <= 31, 'one line at 320px');
  assert.equal(mb({ ...base, runDiffers: true, runSignClicked: true, hash: 'abc', busy: true }).disabled, true);
});

test('am4 item 4: the Resume form\'s button is Sign & resume (two clicks, hash-bound); it is off while the money note is red (startOk false)', () => {
  const mb = load('mainButtonFor');
  const st = { ...base, mode: 'resume', capUsd: '0.30' };
  assert.deepEqual(mb(st), { text: 'Sign & resume', action: 'resume-sign-prepare', disabled: false });
  assert.deepEqual(mb({ ...st, startOk: false }), { text: 'Sign & resume', action: 'resume-sign-prepare', disabled: true });
  const clicked = mb({ ...st, runSignClicked: true, hash: '0123456789abcdef' });
  assert.deepEqual(clicked, { text: 'Sign 01234567 & resume · $0.30', action: 'resume-sign', disabled: false });
  assert.ok(clicked.text.length <= 33);
});

test('am5 (e) / am4 (e): the Resume form has exactly ONE open box (Cap $); every other field is a dimmed read-only block', () => {
  const resume = block('jf-resume');
  const controls = [...resume.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(controls.length, 1, controls.join('\n'));
  assert.match(controls[0], /id="jf-resume-cap"/);
  const dimmed = [...resume.matchAll(/class="field dimmed"/g)].length;
  assert.equal(dimmed, 4, 'job, destination, inputs, ask wait are dimmed');
  // the card hides the mode radios while resuming and says whose run it is
  assert.match(fnSrc('setMode'), /modeRow\.hidden = \(m === "resume"\)/);
  assert.match(fnSrc('setMode'), /"Resume " \+ resumeCtx\.runId/);
  assert.match(fnSrc('refreshClearBtn'), /"Cancel"/);
});

test('am5 item 2: the Run form opens Inputs, Destination, Cap $ and each ask\'s wait; the job lines, ask words and steps are dimmed (no control inside)', () => {
  const run = block('jf-run');
  const job = block('jf-run-job');
  assert.doesNotMatch(job, /<(input|textarea|select)/);
  assert.match(run, /class="field dimmed"[^>]*data-testid="jf-run-job-field"/);
  for (const id of ['jf-run-dest', 'jf-run-cap', 'jf-run-waits', 'jf-run-inputs', 'jf-run-id', 'jf-run-flow']) assert.match(run, new RegExp(`id="${id}"`), id);
  // the old read-only "Cap $ (signed)" box is gone: the cap is typed
  assert.doesNotMatch(run, /Cap \$ \(signed\)/);
  assert.match(PAGE, /<input id="jf-run-cap"/);
  // what the page sends: the open values only (never a job line, an ask's words or the steps)
  const cur = fnSrc('currentRun');
  assert.match(cur, /destination: runDestEl\.value\.trim\(\), capUsd: runCapEl\.value\.trim\(\), askWaits: runWaits\(\)/);
  assert.doesNotMatch(cur, /job|steps|lines|askWords/);
});

test('am5 item 3: runDiffers is only the button\'s wording; the first Sign click is voided by any edit', () => {
  const src = fnSrc('runDiffers');
  assert.match(src, /f\.values\.destination/);
  assert.match(src, /f\.values\.capUsd/);
  assert.match(src, /f\.values\.askWaits/);
  assert.match(CHAT, /runSignInfo = null; resumeSignInfo = null;\n\s+refreshStartEnabled\(\);/);
  // click 2 is the ONLY call that signs: /api/author/run carries the hash, /api/author/resume carries the hash
  assert.match(fnSrc('doRunSign'), /\/api\/author\/run-prepare[\s\S]*body\.hash = runSignInfo\.hash;[\s\S]*\/api\/author\/run"/);
  assert.match(fnSrc('doResumeSign'), /\/api\/author\/resume-prepare[\s\S]*body\.hash = resumeSignInfo\.hash;[\s\S]*\/api\/author\/resume"/);
  assert.match(fnSrc('resumeBody'), /capUsd: resumeCapEl\.value\.trim\(\)/);
  assert.doesNotMatch(fnSrc('resumeBody'), /destination|inputs|askWaits|job/);
});

test('am4 item 4: the Run tab\'s top action row: Stop while running ("stopping after this step…" once asked), Resume on a stopped run; both inside #run-actions, never on a step card', () => {
  assert.match(PAGE, /<div class="run-actions" id="run-actions" data-testid="run-actions" hidden><\/div>/);
  const fn = /function renderRunActions\(detail\)\{[\s\S]*?\n  \}\n/.exec(PAGE)[0];
  assert.match(fn, /c\.stopRequested \? "stopping after this step\\u2026" : "Stop"/);
  assert.match(fn, /c\.canStop/);
  assert.match(fn, /c\.canResume/);
  assert.match(fn, /postJSON\("\/api\/stop"/);
  assert.match(fn, /fwdloopOpenResume/);
  assert.doesNotMatch(PAGE.slice(PAGE.indexOf('function buildStepCardHeadEl'), PAGE.indexOf('function buildStepCardHeadEl') + 3000), /run-stop|run-resume/);
  // a server refusal is shown in the server's own words
  assert.match(fn, /r\.body\.say/);
});

test('am4 item 4 words: a stopped run wears [■] stopped from the one table, never the red [✗] failed; the page draws it from the server\'s word', () => {
  assert.match(PAGE, /\.dot\.stopped::before\{content:"\[■\]"/);
  assert.match(PAGE, /if\(g === "\[■\]"\) return "stopped";/);
  assert.match(PAGE, /data-filter-value="\[■\]" title="stopped, can be resumed"/);
  // no second table of words on the page
  assert.doesNotMatch(PAGE, /word\s*[:=]\s*["']stopped["']/);
});

test('every id on the page is unique (the Run and Resume forms added ids)', () => {
  const ids = [...PAGE.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  const dupes = ids.filter((i) => (seen.has(i) ? true : (seen.add(i), false)));
  assert.deepEqual(dupes, []);
});

test('walk fix 4: after Sign & resume click 2 the Run tab shows a disabled "resuming…" instead of Resume until the run is live/ended, the start is refused, or 30 s pass', () => {
  const at = PAGE.indexOf('  function resumeWaiting(');
  const fn = new Function(`var RESUMING_MAX_MS = 30000;\n${PAGE.slice(at, PAGE.indexOf('\n  }\n', at) + 5)}\nreturn resumeWaiting;`)();
  const m = { key: 'f/r1', at: 1000 };
  assert.equal(fn(m, 'f/r1', true, 2000), true, 'still stopped after click 2: wait');
  assert.equal(fn(m, 'f/r1', false, 2000), false, 'live or ended: nothing to wait for');
  assert.equal(fn(m, 'f/r2', true, 2000), false, 'another run is not held');
  assert.equal(fn(null, 'f/r1', true, 2000), false);
  assert.equal(fn(m, 'f/r1', true, 1000 + 30000), false, 'a child that died: Resume comes back');
  const RA = PAGE.slice(PAGE.indexOf('  function renderRunActions('), PAGE.indexOf('  // A plain lower-case, non-bold data line'));
  assert.match(RA, /makeButton\("resuming\\u2026", "run-resuming"[\s\S]*?disabled = true/, 'the replacement button is disabled');
  assert.match(CHAT, /window\.fwdloopResuming = \{key: resumingKey, at: Date\.now\(\)\};\n\s+beginStart\(/, 'set only once click 2 was accepted');
  assert.match(CHAT, /window\.fwdloopResuming = null; \/\/ a refused start/, 'a refused start gives Resume back');
});
