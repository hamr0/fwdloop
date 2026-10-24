// M8 am7 item 4: on a step's try in Audit, one line `told from earlier runs · N hints`; a click opens the exact text handed; hidden when nothing was handed.
// The run is the REAL one (test/m4d-am29-world.mjs: real runner, real model step, a fake provider) with learningHints ON and one real ledger row for job2, so the record,
// the audit row and the page all come from what the product writes. Server payload first, then the real page in headless chromium at 1280, 390 and 320 (skips when none). $0.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { buildWorld, CAT } from './m4d-am29-world.mjs';
import { getRunAudit } from '../src/panel/data.js';
import { readAudit } from '../src/books.js';
import { writeLedger } from '../src/learnstore.js';
import { emptyLedger, countLedger } from '../src/learn.js';
import { cardsOf } from './m8-learn-fixtures.js';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';

// what each try was handed, read from its own audit row (`hints` count, `hintsText`, `hintIds`)
const readStepLearnings = (runDir) => readAudit(runDir).filter((x) => Object.hasOwn(x, 'hints')).map((x) => ({ step: x.step, try: x.attempt, text: x.hintsText, ids: x.hintIds }));

const HANDLES = [];
const CLOSERS = [];
after(async () => { for (const h of HANDLES) await h.close(); for (const c of CLOSERS) await c(); delete process.env.FWDLOOP_CONFIG_HOME; });
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const NOW = new Date();
const STEP = 'resume-summary';

/** a scratch config home: learningHints as given, the ledger holds the real card of the fixture as a job2 row (lastSeen = now: the age is not under test) */
function configHome(on) {
  const h = mkdtempSync(path.join(tmpdir(), 'fwdloop-m8am7a-'));
  if (on) writeFileSync(path.join(h, 'config.json'), JSON.stringify({ learningHints: true }));
  const L = countLedger(emptyLedger(), { runid: 'r0', cards: cardsOf('ms2c0ls7').cards, workflow: 'job2', place: null, specHash: null, trust: 'deterministic', now: NOW });
  writeLedger({ ...L, rows: L.rows.map((r) => ({ ...r, lastSeen: NOW.toISOString() })) }, h);
  return h;
}
const audit = (w) => getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
const stepGroup = (a) => a.groups.find((g) => g.step === STEP);

test('the server: a try handed a block carries {n, text} exactly as recorded; a try handed nothing carries null; OFF has none anywhere', async () => {
  process.env.FWDLOOP_CONFIG_HOME = configHome(true);
  const w = await buildWorld({ redo: true });
  assert.equal(w.result.outcome, 'complete', w.result.red);
  const recs = readStepLearnings(w.runDir);
  assert.ok(recs.length >= 1, 'the retry / redo tries were handed a block');
  const tries = stepGroup(audit(w)).fold.tries;
  assert.equal(tries[0].hints, null, 'try 1 was not handed one');
  for (const r of recs.filter((x) => x.step === STEP)) {
    const t = tries.find((x) => x.n === r.try);
    assert.deepEqual(t.hints, { n: r.ids.length, text: r.text }, `try ${r.try}: the Audit text is what was handed`);
  }
  assert.ok(tries.some((t) => t.hints !== null), 'at least one try shows the line');
  // the audit row carries the count; it agrees with the record
  for (const r of recs) assert.equal(readAudit(w.runDir).find((x) => x.step === r.step && x.attempt === r.try).hints, r.ids.length);
  process.env.FWDLOOP_CONFIG_HOME = configHome(false);
  const off = await buildWorld({ redo: true });
  assert.deepEqual(readStepLearnings(off.runDir), []);
  assert.ok(stepGroup(audit(off)).fold.tries.every((t) => t.hints === null), 'OFF: no line on any try');
});

async function open(width) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  process.env.FWDLOOP_CONFIG_HOME = configHome(true);
  const w = await buildWorld({ redo: true });
  const h = remember(await createPanelServer({ port: 0, root: w.root, settings: { home: w.home, env: {} } }));
  HANDLES.push(h);
  await chrome.open(`http://127.0.0.1:${h.port}/`, width);
  assert.ok(await chrome.waitFor('!document.getElementById("run-content").hidden', 20000), 'the page opened the newest run');
  await chrome.ev('document.getElementById("tab-audit").click()');
  assert.ok(await chrome.waitFor(`document.querySelector("[data-testid=audit-fold-body-${STEP}]")`, 20000));
  return { chrome, w };
}

for (const width of [1280, 390, 320]) {
  test(`page ${width}px: the line on the tries that were handed hints, a click opens the exact text, nothing spills`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await open(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const { chrome, w } = o;
    const recs = readStepLearnings(w.runDir).filter((r) => r.step === STEP);
    const body = `document.querySelector("[data-testid=audit-fold-body-${STEP}]")`;
    const lines = await chrome.ev(`Array.from(${body}.querySelectorAll("[data-testid=audit-try-hints-head]")).map(function(e){ return e.textContent; })`);
    assert.deepEqual(lines, recs.sort((a, b) => a.try - b.try).map((r) => `told from earlier runs · ${r.ids.length} ${r.ids.length === 1 ? 'hint' : 'hints'}`));
    const tryLines = await chrome.ev(`Array.from(${body}.querySelectorAll("[data-testid=audit-try-line]")).map(function(e){ return e.parentNode.querySelectorAll("[data-testid=audit-try-hints]").length; })`);
    assert.equal(tryLines[0], 0, 'try 1 has no line');
    assert.equal(await chrome.ev(`${body}.querySelector("[data-testid=audit-try-hints-text]").hidden`), true, 'folded until clicked');
    await chrome.ev(`${body}.querySelector("[data-testid=audit-try-hints-head]").click()`);
    assert.equal(await chrome.ev(`${body}.querySelector("[data-testid=audit-try-hints-text]").hidden`), false, 'a click opens it');
    assert.equal(await chrome.ev(`${body}.querySelector("[data-testid=audit-try-hints-text]").textContent`), recs[0].text, 'the exact text handed');
    const r = await chrome.ev(`(function(){
      var vw = document.documentElement.clientWidth, bad = [];
      document.querySelectorAll("#audit-groups .audit-group *").forEach(function(e){
        if(e.closest(".audit-table-scroll")) return;
        var b = e.getBoundingClientRect();
        if(b.width > 0 && b.right > vw + 0.5) bad.push(e.tagName + "." + e.className + " " + Math.round(b.right));
      });
      return { spill: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 5) };
    })()`);
    console.log(`# m8-am7 ${width}px ${JSON.stringify(r)}`);
    assert.ok(r.spill <= 0, `sideways page scroll ${JSON.stringify(r)}`);
    assert.deepEqual(r.bad, [], `a box spills ${JSON.stringify(r)}`);
  });
}
