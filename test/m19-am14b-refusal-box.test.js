// M19 amendment 14b (docs/wiki/the-module-ladder.md): a draft refusal shows under the box it is about, with one pointer line by the Draft button;
// a refusal with no box shows its own words under the button. The box is typed (named at the refusing check's call site), never read from words.
// A real panel and a real `fwdloop draft` child (no injected provider, fake key, no provider call, $0). Browser parts: real headless chromium.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { keysForDoor } from '../src/keysfile.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { JOB, killChildrenAfter, rq, until, world } from './m4e-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const SHOTS = process.env.FWDLOOP_AM14B_SHOTS;
const POINTER = 'Not drafted: fix the red line above.';
const NO_RULE = 'Add at least one rule (~) for this job — for example what the result must include, or what must stay true.';
const ZERO = 'Read the notes and list the open items\nWrite a short summary';

// a real child: drop the injected test provider so the CLI runs its own model / key / hold checks
const real = async (opts = {}) => { const w = await world(opts); delete w.env.FWDLOOP_TEST_DRAFT_PROVIDER; return w; };
const stopped = (port, id) => until(async () => { const j = (await rq(port, { url: `/api/author/${id}` })).json(); return j?.phase === 'stopped' ? j : null; }, 60000);
const printed = (w, id) => readFileSync(path.join(w.dir(id), 'child.log'), 'utf8');

/** the four boxes + one with no box; each returns { w, port, id, box, words, field } for a stopped draft. */
const CASES = {
  async job() {
    const w = await real();
    const id = (await w.post('/api/author/draft', w.card({ job: ZERO }))).json().draftId;
    return { w, port: w.h.port, id, box: 'job', field: 'jf-err-job' };
  },
  async capUsd() {
    const w = await real({ limit: 0.001, authorOpts: { skipMonthly: true } });
    const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
    return { w, port: w.h.port, id, box: 'capUsd', field: 'jf-err-capUsd' };
  },
  async model() {
    const w = await real();
    // the panel lists the key by name (so its own card check passes); the keys file and the env hold no value for the child
    writeFileSync(path.join(w.home, '.env'), '', { mode: 0o600 });
    const env = { ...w.env };
    const h = remember(await createPanelServer({ port: 0, root: w.root, settings: { home: w.home, env: {} }, author: { loadEnv: () => ({ ...keysForDoor({ env, keysHome: w.home }), ok: true, refusal: null, keyNames: ['DEEPSEEK_API_KEY'], env }) } }));
    CLOSERS.push(() => h.close());
    const id = (await rq(h.port, { method: 'POST', url: '/api/author/draft', body: w.card({ job: JOB }) })).json().draftId;
    return { w, port: h.port, id, box: 'model', field: 'jf-err-model' };
  },
  async inputs() {
    const w = await real();
    writeFileSync(path.join(w.inDir, 'jd.md'), '');
    const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
    return { w, port: w.h.port, id, box: 'inputs', field: 'jf-err-inputs' };
  },
  // no box: the draft folder already exists, so the drafter's claim refuses (a root / dir / claim refusal belongs to no box). A wrapper makes the folder, then runs the REAL CLI.
  async none() {
    const w = await real();
    // (the script's name must be `fwdloop`: the panel's liveness check only counts a process whose script is named so)
    mkdirSync(path.join(w.work, 'wrap'));
    const wrap = path.join(w.work, 'wrap', 'fwdloop');
    writeFileSync(wrap, `const { mkdirSync } = require('node:fs');\nconst { spawnSync } = require('node:child_process');\nconst a = process.argv.slice(2);\nmkdirSync(a[a.indexOf('--out') + 1], { recursive: true });\nprocess.exit(spawnSync(process.execPath, [${JSON.stringify(path.join(HERE, '..', 'bin', 'fwdloop'))}, ...a], { stdio: 'inherit' }).status ?? 1);\n`);
    const h = remember(await createPanelServer({ port: 0, root: w.root, settings: { home: w.home, env: {} }, author: { loadEnv: () => keysForDoor({ env: w.env, keysHome: w.home }), bin: wrap } }));
    CLOSERS.push(() => h.close());
    const id = (await rq(h.port, { method: 'POST', url: '/api/author/draft', body: w.card({ job: JOB }) })).json().draftId;
    return { w, port: h.port, id, box: null, field: null };
  },
};

for (const name of Object.keys(CASES)) {
  test(`server: ${name} refusal carries {box, words}; words = the CLI line`, async () => {
    const c = await CASES[name]();
    const s = await stopped(c.port, c.id);
    assert.equal(typeof s.refusal, 'object');
    assert.equal(s.refusal.box, c.box);
    assert.ok(printed(c.w, c.id).includes(s.refusal.words), 'the words are what the CLI printed');
    assert.ok(!s.refusal.words.startsWith('draft refused at $0'), 'prefix left off');
  });
}

test('server: a log with no refusal record has refusal null (the words are never read for a box)', async () => {
  const c = await CASES.job();
  await stopped(c.port, c.id);
  writeFileSync(path.join(c.w.dir(c.id), 'child.log'), 'fwdloop: draft refused at $0 — Add at least one rule (~) for this job\n');
  const s = (await rq(c.port, { url: `/api/author/${c.id}` })).json();
  assert.equal(s.refusal, null);
});

test('server: the no-~ refusal keeps the am13 guarantees (no draft folder, no ledger row)', async () => {
  const c = await CASES.job();
  const s = await stopped(c.port, c.id);
  assert.equal(s.refusal.words, NO_RULE);
  assert.equal(existsSync(path.join(c.w.dir(c.id), 'draft')), false);
  assert.equal(existsSync(path.join(c.w.home, 'runs.jsonl')), false);
});

const probe = (field) => `(function(){
  var red = document.createElement("i"); red.style.color = "var(--red)"; document.body.appendChild(red);
  var txt = function(id){ var e = document.getElementById(id); return e ? e.textContent : null; };
  var btn = document.getElementById("chat-main-btn").getBoundingClientRect();
  var pe = document.getElementById("chat-draft-refusal"), pb = pe.getBoundingClientRect();
  var card = document.getElementById("chat-main-btn").parentElement.getBoundingClientRect();
  var fe = ${field === null ? 'null' : `document.getElementById(${JSON.stringify(field)})`};
  var fb = fe ? fe.getBoundingClientRect() : null;
  var out = { field: fe ? fe.textContent : null, fieldColor: fe ? getComputedStyle(fe).color : null, fsw: fe ? fe.scrollWidth : 0, fcw: fe ? fe.clientWidth : 0, fl: fb ? fb.left : 0, fr: fb ? fb.right : 0,
    pointer: pe.textContent, pcolor: getComputedStyle(pe).color, red: getComputedStyle(red).color, psw: pe.scrollWidth, pcw: pe.clientWidth, pl: pb.left, pr: pb.right, below: pb.top >= btn.bottom - 1,
    cardLeft: card.left, cardRight: card.right, grey: txt("chat-card-error"), act: txt("chat-action-error"), page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    other: Array.prototype.slice.call(document.querySelectorAll("#jf-err-job,#jf-err-capUsd,#jf-err-model,#jf-err-inputs")).filter(function(e){ return e.id !== ${JSON.stringify(field)} && e.textContent !== ""; }).map(function(e){ return e.id; }) };
  red.remove(); return out; })()`;

async function shown(c, width) {
  const chrome = await launchChrome();
  if (!chrome) return null;
  CLOSERS.push(async () => chrome.close());
  const s = await stopped(c.port, c.id);
  await chrome.open(`http://127.0.0.1:${c.port}/`, width);
  assert.ok(await chrome.waitFor('document.getElementById("chat-draft-refusal").textContent !== "" || ' + (c.field ? `document.getElementById("${c.field}").textContent !== ""` : 'false')), 'a refusal shows');
  return { chrome, s, m: await chrome.ev(probe(c.field)) };
}

for (const name of ['job', 'capUsd', 'model', 'inputs']) {
  test(`browser 1280: ${name} refusal in red under its box, pointer by the Draft button, nothing grey`, { skip: SKIP && 'no browser' }, async (t) => {
    const c = await CASES[name]();
    const r = await shown(c, 1280);
    if (!r) { t.skip('no chromium installed'); return; }
    const { m, s } = r;
    assert.equal(m.field, s.refusal.words, `words under ${c.field}`);
    assert.equal(m.fieldColor, m.red, 'red');
    assert.equal(m.pointer, POINTER);
    assert.equal(m.pcolor, m.red, 'pointer red');
    assert.ok(m.below, 'pointer under the Draft button');
    assert.equal(m.grey, '', 'no grey copy in the job card');
    assert.equal(m.act, '');
    assert.deepEqual(m.other, [], 'no other box holds it');
    assert.ok(m.psw <= m.pcw && m.fsw <= m.fcw, `no spill ${JSON.stringify(m)}`);
  });
}

test('browser 1280: a refusal with no box shows its words under the button, no pointer, no box error', { skip: SKIP && 'no browser' }, async (t) => {
  const c = await CASES.none();
  const r = await shown(c, 1280);
  if (!r) { t.skip('no chromium installed'); return; }
  const { m, s } = r;
  assert.equal(s.refusal.box, null);
  assert.equal(m.pointer, s.refusal.words);
  assert.notEqual(m.pointer, POINTER);
  assert.equal(m.pcolor, m.red);
  assert.ok(m.below);
  assert.equal(m.grey, '');
  assert.deepEqual(m.other, []);
});

test('browser: pressing Draft again clears the box error and the pointer', { skip: SKIP && 'no browser' }, async (t) => {
  const c = await CASES.job();
  const r = await shown(c, 1280);
  if (!r) { t.skip('no chromium installed'); return; }
  assert.equal(r.m.field, NO_RULE);
  const after = await r.chrome.ev(`(function(){ document.getElementById("chat-main-btn").click(); return { f: document.getElementById("jf-err-job").textContent, p: document.getElementById("chat-draft-refusal").textContent }; })()`);
  assert.deepEqual(after, { f: '', p: '' });
});

for (const width of [1280, 390, 320]) {
  for (const name of ['job', 'capUsd']) {
    test(`browser at ${width}: ${name} refusal inside the card, no spill`, { skip: SKIP && 'no browser' }, async (t) => {
      const c = await CASES[name]();
      const r = await shown(c, width);
      if (!r) { t.skip('no chromium installed'); return; }
      const { m, chrome } = r;
      assert.ok(m.fsw <= m.fcw && m.psw <= m.pcw, `no spill ${JSON.stringify(m)}`);
      assert.ok(m.fl >= m.cardLeft - 0.5 && m.fr <= m.cardRight + 0.5, `field line inside the card ${JSON.stringify(m)}`);
      assert.ok(m.pl >= m.cardLeft - 0.5 && m.pr <= m.cardRight + 0.5, `pointer inside the card ${JSON.stringify(m)}`);
      assert.ok(m.page <= 0, 'no horizontal page scroll');
      if (SHOTS) {
        await chrome.ev(`document.getElementById(${JSON.stringify(c.field)}).scrollIntoView({block: "center"}); true`);
        await chrome.screenshot(path.join(SHOTS, `am14b-${name}-${width}.png`));
      }
      if (process.env.FWDLOOP_AM14B_NUMBERS) process.stderr.write(`AM14B ${name} ${width} ${JSON.stringify({ fsw: m.fsw, fcw: m.fcw, psw: m.psw, pcw: m.pcw, page: m.page })}\n`);
    });
  }
}

// A slow Run-a-signed-flow list must not wipe a painted refusal: the page's first flows read repaints the Run form, which clears every box error.
// A tiny proxy holds the flows answer back until the refusal is on screen, so the late answer lands after it (the order a loaded machine produces).
test('browser: a late flows answer does not wipe the box error of a painted refusal', { skip: SKIP && 'no browser' }, async (t) => {
  const c = await CASES.job();
  await stopped(c.port, c.id);
  let release = () => {};
  const gate = new Promise((r) => { release = r; });
  const proxy = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/author/flows')) await gate;
    const up = http.request({ host: '127.0.0.1', port: c.port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${c.port}` } }, (u) => { res.writeHead(u.statusCode, u.headers); u.pipe(res); });
    req.pipe(up);
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  CLOSERS.push(() => new Promise((r) => proxy.close(r)));
  const chrome = await launchChrome();
  if (!chrome) { release(); t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  await chrome.open(`http://127.0.0.1:${proxy.address().port}/`, 1280);
  assert.ok(await chrome.waitFor('document.getElementById("jf-err-job").textContent !== ""'), 'the refusal shows');
  release();
  await new Promise((r) => setTimeout(r, 1500));
  const after = await chrome.ev(`({ f: document.getElementById("jf-err-job").textContent, p: document.getElementById("chat-draft-refusal").textContent })`);
  assert.deepEqual(after, { f: NO_RULE, p: POINTER });
});
