// F92 H6 (+ timing note): freezeInputs, the function a run start calls, on a 404 issue and on issue 30. $0, no provider, no model.
// Runs against the F92 SCRATCH copy (needs the ticket change in scratch.diff). Run: node poc/tickets/f92/h6.mjs
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freezeInputs } from '../../../src/runner.js';
const dir = mkdtempSync(join(tmpdir(), 'f92-h6-'));
const t0 = Date.now();
const bad = await freezeInputs(join(dir, 'bad'), [{ id: 'issue', path: 'https://github.com/hamr0/bareagent/issues/999999', ticket: true }]);
const badMs = Date.now() - t0;
const files = existsSync(join(dir, 'bad', 'inputs')) ? readdirSync(join(dir, 'bad', 'inputs')) : [];
const R = { badMs, bad, framesFrozen: files, H6: !bad.ok && /input "issue"/.test(bad.red) && /HTTP 404/.test(bad.red) && files.length === 0 ? 'PASS' : 'FAIL' };
const t1 = Date.now();
const good = await freezeInputs(join(dir, 'good'), [{ id: 'issue', path: 'https://github.com/hamr0/bareagent/issues/30', ticket: true }]);
R.goodMs = Date.now() - t1;
R.good = good.ok ? { entry: good.manifest ?? good.entries ?? Object.keys(good) } : good;
console.log(JSON.stringify(R, null, 2));
