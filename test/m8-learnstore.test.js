// borrowed-from: bareloop tests/learn-ledger.test.js@v0.46.0 (8b3d815)
// Adaptations: only the disk tests are copied (the count/climb/render tests belong to learn.js); temp dir prefix fwdloop-learn-; "place of a job" test dropped (placeOf is not used by this file); then the tests of fwdloop's own adaptations (M8 item 3: config home, test door, keep-every-row, no wiring functions).
// Disk tests use a scratch home (mkdtemp) and never touch ~/.config/fwdloop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyLedger, countLedger, DECAY_DAYS } from '../src/learn.js';
import * as store from '../src/learnstore.js';
import { readLedger, writeLedger, ledgerPath, foldRunIntoLedger, releaseRun } from '../src/learnstore.js';
import { configHome } from '../src/config.js';
import { cardsOf } from './m8-learn-fixtures.js';

const DAY = 86_400_000;
const WF = 'aurora-u-spawner-types';
const NOW = new Date(new Date(cardsOf('mszcfaof').cards[0].at).getTime() + DAY);
const built = new Map([['ms2c0ls7', cardsOf('ms2c0ls7')]]);
const scratch = (/** @type {any} */ t) => { const d = mkdtempSync(join(tmpdir(), 'fwdloop-learn-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('disk: the ledger lives under <home>/learn/ledger.json, written atomically and mode 600, secrets masked, missing = empty', (t) => {
  const home = scratch(t);
  assert.equal(ledgerPath(home), join(home, 'learn', 'ledger.json'));
  assert.deepEqual(readLedger(home), { ledger: emptyLedger(), exists: false, problem: null });
  assert.equal(existsSync(join(home, 'learn')), false, 'reading never creates the directory');
  const token = `ghp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`;
  const [c] = /** @type {any} */ (built.get('ms2c0ls7')).cards;
  const L = countLedger(emptyLedger(), { runid: 'r', cards: [{ ...c, goal: `use ${token} here` }], workflow: WF, place: null, specHash: null, trust: 'deterministic', now: NOW });
  const file = writeLedger(L, home);
  assert.equal(file, ledgerPath(home));
  assert.deepEqual(readdirSync(join(home, 'learn')), ['ledger.json'], 'no temp file left behind');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(!readFileSync(file, 'utf8').includes(token), 'a secret in a person\'s repo never enters the record');
  assert.equal(readLedger(home).problem, null);
  assert.equal(readLedger(home).ledger.rows.length, 1);
});

test('disk: a corrupt ledger is reported and never silently reset by the run-end write', (t) => {
  const home = scratch(t);
  mkdirSync(join(home, 'learn'));
  writeFileSync(ledgerPath(home), '{ not json');
  assert.match(/** @type {string} */ (readLedger(home).problem), /not readable JSON/);
  const out = foldRunIntoLedger({ home, runid: 'x', build: cardsOf('mvk2e4uy'), workflow: 'w', place: null, specHash: null, trust: 'deterministic', at: '2026-10-22T00:00:00Z', now: NOW });
  assert.equal(out.wrote, false);
  assert.equal(readFileSync(ledgerPath(home), 'utf8'), '{ not json');
});

test('disk: foldRunIntoLedger counts a deterministic run, holds a rubric run, and releaseRun frees it', (t) => {
  const home = scratch(t);
  const det = cardsOf('mvk2e4uy');
  const out = foldRunIntoLedger({ home, runid: 'mvk2e4uy', build: det, workflow: 'pulselog-panel-strict', place: '/p', specHash: 'h', trust: 'deterministic', at: det.cards[0].at, now: new Date(det.cards[0].at) });
  assert.deepEqual([out.wrote, out.counted, out.held], [true, 1, 0]);
  assert.equal(readLedger(home).ledger.rows.length, 1);
  assert.equal(readLedger(home).ledger.suspect.length, 1, 'the CHECK-SUSPECT card is listed, not counted');
  assert.deepEqual(readLedger(home).ledger.health.mvk2e4uy, { at: det.cards[0].at, noise: null, cards: 1, suspect: 1, thin: 0 });
  // the same run again: the tally does not move
  foldRunIntoLedger({ home, runid: 'mvk2e4uy', build: det, workflow: 'pulselog-panel-strict', place: '/p', specHash: 'h', trust: 'deterministic', at: det.cards[0].at, now: new Date(det.cards[0].at) });
  assert.equal(readLedger(home).ledger.rows[0].count, 1);
  // a rubric run: held until released
  const rub = cardsOf('mvh72jo0');
  const now = new Date(rub.cards[0].at);
  const h = foldRunIntoLedger({ home, runid: 'mvh72jo0', build: rub, workflow: 'flights-2', place: 'www.google.com', specHash: 'h', trust: 'rubric', at: rub.cards[0].at, now });
  assert.deepEqual([h.counted, h.held], [0, 1]);
  assert.equal(readLedger(home).ledger.rows.filter((r) => r.workflow === 'flights-2').length, 0);
  assert.deepEqual(releaseRun({ home, runid: 'mvh72jo0', now }), { released: 1, problem: null });
  assert.equal(readLedger(home).ledger.rows.filter((r) => r.workflow === 'flights-2').length, 1);
  assert.deepEqual(releaseRun({ home, runid: 'mvh72jo0', now }), { released: 0, problem: null });
});

// ── fwdloop's own adaptations (M8 item 3) ─────────────────────────────────────

/** run `fn` with the two door env vars set as given (undefined = unset), restored after */
function withEnv(/** @type {Record<string, string|undefined>} */ vars, /** @type {() => void} */ fn) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fn();
  } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('adaptation: the ledger home is fwdloop\'s configHome(), and the test door (FWDLOOP_CONFIG_HOME) is honoured', (t) => {
  const home = scratch(t);
  assert.equal(ledgerPath(home), join(configHome(home), 'learn', 'ledger.json'));
  withEnv({ NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home }, () => {
    assert.equal(ledgerPath(), join(home, 'learn', 'ledger.json'));
    const [c] = built.get('ms2c0ls7').cards;
    writeLedger(countLedger(emptyLedger(), { runid: 'r', cards: [c], workflow: WF, place: null, specHash: null, trust: 'deterministic', now: NOW }));
    assert.equal(readLedger().ledger.rows.length, 1);
  });
  assert.equal(existsSync(join(home, 'learn', 'ledger.json')), true);
});

test('adaptation: under a test process with no config home given, the ledger path THROWS (the real ~/.config/fwdloop is unreachable)', () => {
  withEnv({ NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: undefined }, () => {
    assert.throws(() => ledgerPath(), /no config home/);
    assert.throws(() => readLedger(), /no config home/);
    assert.throws(() => writeLedger(emptyLedger()), /no config home/);
  });
});

test('adaptation: the file is mode 0600 even when it already existed wider; the directory holds only ledger.json', (t) => {
  const home = scratch(t);
  mkdirSync(join(home, 'learn'));
  writeFileSync(ledgerPath(home), '{}', { mode: 0o644 });
  const file = writeLedger(emptyLedger(), home);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(home, 'learn')), ['ledger.json']);
});

test('adaptation: the ledger keeps every row — a row last seen long ago and one from another workflow survive a later fold', (t) => {
  const home = scratch(t);
  const [c] = built.get('ms2c0ls7').cards;
  const old = new Date(NOW.getTime() - (DECAY_DAYS + 144) * DAY);
  const L = countLedger(emptyLedger(), { runid: 'old', cards: [{ ...c, at: old.toISOString() }], workflow: 'aging-1', place: null, specHash: 'h1', trust: 'deterministic', now: old });
  writeLedger(L, home);
  const det = cardsOf('mvk2e4uy');
  foldRunIntoLedger({ home, runid: 'mvk2e4uy', build: det, workflow: 'aging-2', place: null, specHash: 'h2', trust: 'deterministic', at: det.cards[0].at, now: NOW });
  const rows = readLedger(home).ledger.rows;
  assert.equal(rows.filter((r) => r.workflow === 'aging-1').length, 1, 'the old aging-1 row is still there');
  assert.equal(rows.filter((r) => r.workflow === 'aging-2').length, 1);
  assert.equal(rows.find((r) => r.workflow === 'aging-1').runIds[0], 'old');
});

test('adaptation: hintsForRun (hands hints to the drafter, M8 item 5a) is not in this file yet', () => {
  assert.equal('hintsForRun' in store, false);
});
