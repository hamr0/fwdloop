// M20 am5 item 1: the New job card's Schedule offers exactly what the Run card's When offers for the same flow type (one list: src/schedule-choices.js), with the Run card's
// time, day, file and folder boxes, signed with the job into the same schedule.json shape. Real panel (headless chromium; skips only when none is installed) at 1280, 390 and 320. $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { killChildrenAfter, tmp, world } from './m4e-world.mjs';
import { greenWorld, setTrigger } from './m9-trigger-world.mjs';
import { readSchedule } from '../src/schedule.js';
import { userInfo } from 'node:os';
import { scheduleChoices, scheduleKindsOf } from '../src/schedule-choices.js';
import { shapeOf } from '../src/schedule-shape.js';
import { fileTriggerWhy } from '../src/trigger-files.js';
import { createTriggerDoor } from '../src/panel/authortrigger.js';
import { cardFields, checkCard } from '../src/panel/authorcard.js';

killChildrenAfter();
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const OLD_HOME = process.env.HOME;
after(() => { process.env.HOME = OLD_HOME; });

async function open(width) {
  const w = await world({ limit: 5 });
  const home = path.join(w.work, 'home');
  mkdirSync(home);
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'true' } } }));
  process.env.HOME = home;
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  await chrome.send('Page.enable');
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, width);
  await chrome.ev('document.getElementById("tab-chat").click()');
  assert.ok(await chrome.waitFor('!!document.getElementById("jf-sched")'), 'the card has a Schedule');
  return { chrome, w };
}
const setSel = (c, id, value) => c.ev(`var s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change", {bubbles: true}))`);
const setIn = (c, id, v) => c.ev(`var e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", {bubbles: true}))`);
const shown = (c, id) => c.ev(`!document.getElementById(${JSON.stringify(id)}).hidden`);
const optionsOf = (c) => c.ev('Array.from(document.getElementById("jf-sched").options).filter(function(o){ return !o.hidden && !o.disabled; }).map(function(o){ return o.value + "|" + o.textContent; })');
const SPILL = '({ vw: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth })';
/** every shown box of the Schedule row stays inside the screen: left >= 0, right <= viewport */
const BOXES = '(function(){ var vw = document.documentElement.clientWidth; return Array.from(document.querySelectorAll("#jf-sched-field select, #jf-sched-field input")).filter(function(e){ return e.offsetParent !== null; }).map(function(e){ var r = e.getBoundingClientRect(); return { id: e.id, left: r.left, right: r.right, vw: vw }; }); })()';

// the card's own check and sign use the same list and the Run card's own shape check
test('am5 item 1 (server): the card check offers each flow type its kinds from the one list, and a file or folder choice is refused when its file or folder is missing, as the Run card refuses it', () => {
  const dir = tmp('am5-card');
  const base = { flowName: 'sched', job: 'Read it\nWrite it', inputs: `resume: ${path.join(dir, 'resume.md')}`, destination: dir, capUsd: '0.25', askWait: '30m', provider: 'x', model: 'y' };
  writeFileSync(path.join(dir, 'resume.md'), 'x');
  const reds = (card) => { const r = checkCard(cardFields(card), { root: dir, home: dir, keys: [] }); return r.ok ? [] : r.refusals.filter((x) => x.field === 'schedule').map((x) => x.say); };
  for (const kind of scheduleKindsOf('plain').filter((k) => k !== 'hand')) {
    const spec = kind === 'daily' || kind === 'weekdays' ? { kind, hour: 7, minute: 5 } : kind === 'weekly' ? { kind, day: 'mon', hour: 7, minute: 5 } : kind === 'file-updated' ? { kind, role: 'resume', path: path.join(dir, 'resume.md') } : { kind, role: 'resume', folder: dir };
    assert.deepEqual(reds({ ...base, schedule: spec }), [], `${kind} is offered to a plain job`);
  }
  assert.equal(reds({ ...base, schedule: { kind: 'new-file', role: 'resume', folder: path.join(dir, 'nope') } }).length, 1, 'a missing folder is refused');
  assert.equal(reds({ ...base, schedule: { kind: 'file-updated', role: 'resume', path: path.join(dir, 'nope', 'x.md') } }).length, 1, 'a file whose folder is missing is refused');
  assert.equal(reds({ ...base, flowType: 'mcp', mcp: 'github', schedule: { kind: 'weekdays', hour: 7, minute: 5 } }).length, 1, 'a generic MCP job offers By hand and every day only');
});

test('am5 item 1 (server): the card\'s sign checks its choice with the Run card\'s own shape check and writes the trigger the Run card writes for it', () => {
  const dir = tmp('am5-sign');
  const door = createTriggerDoor({ root: dir, flowsDoor: {}, starter: {}, loadEnv: () => ({ ok: true, env: {}, keyNames: [] }), monthlyClaim: () => null, modelRefusal: () => [] });
  const plan = { arbiter: { sources: [{ role: 'resume', kind: 'file', path: path.join(dir, 'resume.md') }] }, declaration: {} };
  for (const spec of [{ kind: 'daily', hour: 7, minute: 5 }, { kind: 'weekdays', hour: 7, minute: 5 }, { kind: 'weekly', day: 'fri', hour: 7, minute: 5 }, { kind: 'file-updated', role: 'resume', path: path.join(dir, 'resume.md') }, { kind: 'new-file', role: 'resume', folder: dir }]) {
    const planned = door.cardSchedule(spec, plan);
    assert.equal(planned.ok, true, JSON.stringify(planned));
    assert.deepEqual(planned.trigger, shapeOf(spec, ['resume']).trigger, `${spec.kind}: the same trigger the Run card's door builds`);
    if (spec.kind === 'file-updated' || spec.kind === 'new-file') assert.equal(fileTriggerWhy(planned.trigger), null);
  }
  assert.match(door.cardSchedule({ kind: 'new-file', role: 'resume', folder: path.join(dir, 'nope') }, plan).say, /does not exist\. Nothing was signed\./);
});

for (const width of [1280, 390, 320]) {
  test(`am5 item 1 at ${width}px: the Schedule row offers the Run card's choices per flow type, the boxes follow the pick, the card sends what it shows, nothing spills`, { skip: SKIP && 'no browser' }, async (t) => {
    const o = await open(width);
    if (!o) { t.skip('no chromium installed'); return; }
    const c = o.chrome;
    const all = scheduleChoices();
    const expect = (type, withFile, withTicket) => all[type].filter((x) => (withFile || !x.kind.startsWith('file') && x.kind !== 'new-file') && (withTicket || x.kind !== 'new-ticket')).map((x) => `${x.kind}|${x.newCardLabel}`);
    // no Inputs line: no file choice
    assert.deepEqual(await optionsOf(c), expect('plain', false, false), 'plain, no file input');
    await setIn(c, 'jf-inputs', 'resume: /full/path/to/resume.md');
    assert.deepEqual(await optionsOf(c), expect('plain', true, false), 'plain, with a file input: the Run card\'s list');
    await setSel(c, 'jf-flowtype', 'mcp');
    assert.deepEqual(await optionsOf(c), expect('mcp', true, false), 'MCP: By hand and every day');
    await setSel(c, 'jf-flowtype', 'tickets');
    assert.deepEqual(await optionsOf(c), expect('tickets', true, true), 'Tickets: plain\'s and a new ticket');
    await setSel(c, 'jf-flowtype', 'plain');
    // each pick shows its boxes, inside the screen
    const BOXES_OF = { daily: ['jf-sched-time'], weekdays: ['jf-sched-time'], weekly: ['jf-sched-day', 'jf-sched-time'], 'file-updated': ['jf-sched-role', 'jf-sched-path'], 'new-file': ['jf-sched-role', 'jf-sched-path'] };
    for (const [kind, ids] of Object.entries(BOXES_OF)) {
      await setSel(c, 'jf-sched', kind);
      for (const id of ids) assert.equal(await c.ev(`document.getElementById(${JSON.stringify(id)}).offsetParent !== null`), true, `${kind}: ${id} shows`);
      const spill = await c.ev(SPILL);
      assert.ok(spill.scrollW <= spill.vw, `${kind} at ${width}: ${JSON.stringify(spill)}`);
      for (const b of await c.ev(BOXES)) assert.ok(b.left >= 0 && b.right <= b.vw, `${kind}: ${b.id} stays inside the screen at ${width}: ${JSON.stringify(b)}`);
    }
    // the card sends the choice it shows, with the Run card's field names
    await c.ev('window.__bodies = []; var of = window.fetch; window.fetch = function(u, op){ if(String(u).indexOf("/api/author/draft") !== -1) window.__bodies.push(op.body); return of.apply(this, arguments); }');
    await setIn(c, 'jf-name', 'sched-card');
    await setIn(c, 'jf-job', 'Read what comes in\nWrite it out');
    await setIn(c, 'jf-dest-folder', tmp('dest'));
    await setIn(c, 'jf-cap-money', '0.25');
    const sent = [
      ['weekdays', async () => { await setIn(c, 'jf-sched-time', '07:05'); }, { kind: 'weekdays', hour: 7, minute: 5 }],
      ['weekly', async () => { await setSel(c, 'jf-sched-day', 'fri'); await setIn(c, 'jf-sched-time', '07:05'); }, { kind: 'weekly', day: 'fri', hour: 7, minute: 5 }],
      ['file-updated', async () => { await setIn(c, 'jf-sched-path', '/full/path/to/resume.md'); }, { kind: 'file-updated', role: 'resume', path: '/full/path/to/resume.md' }],
      ['new-file', async () => { await setIn(c, 'jf-sched-path', '/full/path/to/inbox'); }, { kind: 'new-file', role: 'resume', folder: '/full/path/to/inbox' }],
    ];
    let n = 0;
    for (const [kind, fill, want] of sent) {
      await setSel(c, 'jf-sched', kind);
      await fill();
      assert.ok(await c.waitFor('document.getElementById("chat-main-btn").disabled === false'));
      await c.ev('document.getElementById("chat-main-btn").click()');
      n += 1;
      assert.ok(await c.waitFor(`window.__bodies.length === ${n}`));
      assert.deepEqual(JSON.parse(await c.ev(`window.__bodies[${n - 1}]`)).schedule, want, kind);
    }
  });
}

// the Done-when: each plain choice signed from the Run card (the trigger door over HTTP) and from the New job card (`cardSchedule` then `signSchedule`, as the card's sign does)
// writes the same schedule.json. The ONLY fields ignored are the two that carry the signing time: `signedAt` (the clock) and `sig` (a hash of `bound` and `signedAt`).
// Every other field is compared, `bound` (the hash of what was shown: flow, signature, trigger, model, destination, inputs, plan) included.
test('am5 item 1 (end to end): each plain choice signed from the New job card writes the same schedule.json as the Run card, field by field (ignored: signedAt, sig)', async () => {
  const { w, flowDir, read } = await greenWorld();
  const IGNORED = ['signedAt', 'sig'];
  const door = createTriggerDoor({ root: w.root, flowsDoor: {}, starter: {}, loadEnv: () => ({ ok: true, env: {}, keyNames: [] }), monthlyClaim: () => null, modelRefusal: () => [] });
  const r = read();
  assert.equal(r.ok, true);
  const inputs = w.inputs();
  const file = inputs[0].path;
  const specs = [
    { kind: 'daily', hour: 7, minute: 5 },
    { kind: 'weekdays', hour: 7, minute: 5 },
    { kind: 'weekly', day: 'fri', hour: 7, minute: 5 },
    { kind: 'file-updated', role: inputs[0].role, path: file },
    { kind: 'new-file', role: inputs[0].role, folder: path.dirname(file) },
  ];
  const without = (rec) => Object.fromEntries(Object.entries(rec).filter(([k]) => !IGNORED.includes(k)));
  for (const spec of specs) {
    const fromRunCard = await setTrigger(w, spec);
    assert.equal(fromRunCard.status, 200, `${spec.kind}: the Run card signs it: ${fromRunCard.text}`);
    const runCard = readSchedule(flowDir);
    rmSync(path.join(flowDir, 'schedule.json'), { force: true });
    const planned = door.cardSchedule(spec, { arbiter: r.arbiter, declaration: r.declaration });
    assert.equal(planned.ok, true, `${spec.kind}: the New job card accepts it: ${JSON.stringify(planned)}`);
    door.signSchedule({ flow: 'job2', flowSignatureHash: r.signature.flow, trigger: planned.trigger, from: null, signedBy: userInfo().username });
    const newCard = readSchedule(flowDir);
    assert.deepEqual(Object.keys(newCard).sort(), Object.keys(runCard).sort(), `${spec.kind}: the same fields`);
    assert.deepEqual(without(newCard), without(runCard), `${spec.kind}: the same schedule.json but signedAt and sig`);
    assert.equal(newCard.bound, runCard.bound, `${spec.kind}: the same hash of what was shown`);
  }
});
