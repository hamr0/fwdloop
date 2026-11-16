// M13 am11 P6: a job signed before am11 that cannot run under its rules is refused at start at $0 with the reason; nothing is rewritten.
// The fixture was signed under the old send lock (the send reads the FIRST of two Asks, with the second Ask between them): the action must read the step right before it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = loadCatalogue().primitives;

test('an old job whose send does not read the step before it is refused at start, $0, naming why; its signed files are byte-identical after', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am11p6-'));
  cpSync(path.join(HERE, 'fixtures', 'm13-am11-old-job'), path.join(root, 'oldjob'), { recursive: true });
  const before = readFileSync(path.join(root, 'oldjob', 'declaration.json'), 'utf8');
  const modelStep = async () => { throw new Error('no model call may be made'); };
  const res = await runFlow({ root, name: 'oldjob', runId: 'run-1', sources: [], catalogue: CATALOGUE, modelStep, askStep: makeParkingAskStep(), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-16' });
  assert.equal(res.outcome, 'refused', JSON.stringify(res));
  assert.match(res.red, /send at line 4 \(steps\[3\]\) must read the output of the step before it \("a2"\)/);
  assert.equal(res.spentUsd ?? 0, 0);
  assert.equal(readFileSync(path.join(root, 'oldjob', 'declaration.json'), 'utf8'), before, 'a signed job is never rewritten');
  const runs = path.join(root, 'oldjob', 'runs');
  assert.equal(existsSync(runs) ? readdirSync(runs).flatMap((r) => (existsSync(path.join(runs, r, 'audit.jsonl')) ? [r] : [])).length : 0, 0, 'no step ran');
});
