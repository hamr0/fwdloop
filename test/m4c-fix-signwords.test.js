// M4c-fix amendment 2 (g): one bold word after every sign — the same in Runs, the Inbox and the run header. One table
// (data.js SIGN_WORDS) maps sign -> word; the server stamps it on each row; the page only draws it.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { rmSync, readFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCatalogue } from '../src/catalogue.js';
import {
  SIGN_WORDS, signParts, listRuns, getRunDetail, listStops,
} from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const SCRIPT = path.join(HERE, '..', 'scripts', 'panel-fixtures', 'walk-root.mjs');
const CAT = loadCatalogue().primitives;
const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-signwords-'));
const root = path.join(base, 'walk');
after(() => rmSync(base, { recursive: true, force: true }));

const WORDS = {
  '[▶]': 'running', '[·]': 'waiting', '[II]': 'stuck', '[!]': 'expired', '[?]': 'crashed', '[✓]': 'passed', '[✗]': 'failed', '[■]': 'stopped',
};

test('(g) one table: each of the eight signs maps to its one word, and a plain line never repeats it', () => {
  assert.deepEqual(SIGN_WORDS, WORDS);
  assert.deepEqual(signParts('[II]', 'stuck — your answer is saved; the run stopped before using it'),
    { word: 'stuck', line: 'your answer is saved; the run stopped before using it' });
  assert.deepEqual(signParts('[✓]', 'passed'), { word: 'passed', line: null });
  assert.deepEqual(signParts('[·]', 'waiting on you (parked, unanswered)'), { word: 'waiting', line: 'waiting on you (parked, unanswered)' });
  assert.deepEqual(signParts('[✗]', 'stopped by you (rerun), a fresh run was started', true).word, null, 'a rerun is never called failed');
});

test('(g) the page draws the word on all three surfaces (Runs, Inbox, run header) off the server\'s word, never its own table', () => {
  assert.match(PAGE, /signHtml\(r\.word, r\.line, r\.label\)/, 'Runs row');
  assert.match(PAGE, /signHtml\(row\.word, stopStatusLine\(row\), stopStatusLine\(row\)\)/, 'Inbox row');
  assert.match(PAGE, /verdict\.innerHTML = signHtml\(detail\.word, detail\.line, detail\.label\)/, 'run header badge');
  assert.match(PAGE, /signHtml\(detail\.word, detail\.line, detail\.label\) \+ ' &middot;/, 'run header summary');
  for (const w of Object.values(WORDS)) assert.doesNotMatch(PAGE, new RegExp(`word\\s*[:=]\\s*["']${w}["']`), `no second table for ${w}`);
  // the page's one drawing function: bold word, dash, line
  const fn = new Function('escapeXml', `${/function signHtml[\s\S]*?\n {2}\}/.exec(PAGE)[0]}; return signHtml;`)((x) => String(x));
  for (const [g, w] of Object.entries(WORDS)) {
    assert.equal(fn(SIGN_WORDS[g], 'why'), `<b class="sign-word">${w}</b> &mdash; why`, g);
    assert.equal(fn(SIGN_WORDS[g], null), `<b class="sign-word">${w}</b>`, g);
  }
});

test('(g) the server stamps the same word on the Runs list, the run header and the Inbox', () => {
  const r = spawnSync(process.execPath, [SCRIPT, root, '4833'], { encoding: 'utf8', timeout: 100_000 });
  assert.equal(r.status, 0, r.stderr);
  const runs = listRuns({ root, catalogue: CAT });
  const seen = new Set();
  for (const row of runs) {
    if (!row.glyph) continue;
    assert.equal(row.word, WORDS[row.glyph], `${row.runId} list row`);
    seen.add(row.glyph);
    const d = getRunDetail({ root, flow: row.flow, runId: row.runId, catalogue: CAT });
    assert.equal(d.word, row.word, `${row.runId} header agrees with the list`);
  }
  for (const g of ['[·]', '[II]', '[!]', '[✓]']) assert.ok(seen.has(g), `the walk root shows ${g}`);
  const stops = listStops({ root });
  const stuck = stops.find((s) => s.stuck);
  assert.equal(stuck.word, 'stuck');
  assert.match(stuck.stuckLine, /^your answer is saved|^an old resume lock is in the way/);
  for (const s of stops.filter((x) => x.waiting)) assert.equal(s.word, 'waiting');
});

test('(g) a step\'s own word comes from the same table: [✓] passed, [✗] failed, [·] waiting; not started wears none; the map legend is gone', () => {
  const body = PAGE.slice(PAGE.indexOf('var signWords = {};'), PAGE.indexOf('// fwdloop\'s close-class vocabulary'));
  const stateWord = new Function(`${body} signWords = ${JSON.stringify(SIGN_WORDS)}; return stateWord;`)();
  assert.equal(stateWord('done'), '[✓] passed');
  assert.equal(stateWord('stopped'), '[✗] failed');
  assert.equal(stateWord('waiting'), '[·] waiting');
  assert.equal(stateWord('pending'), 'not started');
  assert.doesNotMatch(PAGE, /map-legend|stepMapLegendHTML/);
});

test('(g) layout: a Runs row is sign + name, then **word** — why, then the meta line; the header follows (k): sign + name, then word — why', () => {
  const row = /wf-line1[\s\S]{0,400}?wf-sign-line" data-testid="run-sign-word">' \+ signHtml\(r\.word[\s\S]{0,120}?runMetaLineHtml\(r, null\)/.exec(PAGE);
  assert.ok(row, 'Runs row order');
  assert.match(PAGE, /wf-sign-line" data-testid="run-sign-word">' \+ signHtml\(g\.lastRow\.word/, 'grouped Runs row');
  const hdr = PAGE.indexOf('id="active-wf-verdict"');
  assert.ok(hdr > 0 && hdr > PAGE.indexOf('id="active-wf-name"'), 'name (with its sign) before the verdict, as (k)');
});
