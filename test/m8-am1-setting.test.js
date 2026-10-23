// M8 am1: `learningHints` is a line in config.json, per user, OFF when absent; a bad or unreadable config reads as OFF.
// Scratch homes only (mkdtemp), cleaned up; the real ~/.config/fwdloop is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { learningHintsOn } from '../src/learnstore.js';
import { readConfig, ConfigError } from '../src/config.js';

const scratch = (/** @type {any} */ t, /** @type {string|null} */ body) => {
  const d = mkdtempSync(join(tmpdir(), 'fwdloop-am1-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  if (body !== null) writeFileSync(join(d, 'config.json'), body);
  return d;
};

test('am1: absent file, absent line and false are OFF; only true is ON', (t) => {
  assert.equal(learningHintsOn(scratch(t, null)), false, 'no config.json');
  assert.equal(learningHintsOn(scratch(t, '{}')), false, 'no line');
  assert.equal(learningHintsOn(scratch(t, '{"learningHints":false}')), false);
  assert.equal(learningHintsOn(scratch(t, '{"learningHints":true}')), true);
});

test('am1: a bad or unreadable config reads as OFF, never throws, never ON', (t) => {
  assert.equal(learningHintsOn(scratch(t, '{ not json')), false, 'unparseable');
  assert.equal(learningHintsOn(scratch(t, '[1]')), false, 'not an object');
  assert.equal(learningHintsOn(scratch(t, '{"learningHints":true,"monthlyLimitUsd":-1}')), false, 'another known field invalid: whole file is bad, so OFF');
  assert.equal(learningHintsOn(scratch(t, '{"learningHints":"yes"}')), false, 'not a boolean');
});

test('am1: config.js accepts learningHints as a boolean only', (t) => {
  assert.equal(readConfig({ home: scratch(t, '{"learningHints":true}') }).learningHints, true);
  assert.throws(() => readConfig({ home: scratch(t, '{"learningHints":1}') }), ConfigError);
});

test('am1: under a test process with no home and no FWDLOOP_CONFIG_HOME the setting is OFF and nothing real is read', () => {
  const was = process.env.FWDLOOP_CONFIG_HOME;
  delete process.env.FWDLOOP_CONFIG_HOME;
  try { assert.equal(learningHintsOn(), false); } finally { if (was !== undefined) process.env.FWDLOOP_CONFIG_HOME = was; }
});

test('am1: the test door (FWDLOOP_CONFIG_HOME) is read when no home is passed', (t) => {
  const was = process.env.FWDLOOP_CONFIG_HOME;
  process.env.FWDLOOP_CONFIG_HOME = scratch(t, '{"learningHints":true}');
  try { assert.equal(learningHintsOn(), true); } finally { if (was === undefined) delete process.env.FWDLOOP_CONFIG_HOME; else process.env.FWDLOOP_CONFIG_HOME = was; }
});
