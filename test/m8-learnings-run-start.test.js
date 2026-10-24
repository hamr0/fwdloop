// M8: a reused red run's draft leaves learnings.json in the run folder before the run starts (flowmodel takeLearningsRecord);
// the CLI start must not read it as "a run already lives here". $0: the test model step, scratch dirs.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { LEARNINGS_FILE } from '../src/flowmodel.js';
import { loadCatalogue } from '../src/catalogue.js';
import { sandboxSend } from './send-sandbox.js';
import { killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const kids = [];
after(() => { for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } } });

test('a run starts when its folder holds only what draft and sign left, learnings.json included', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m8-lstart-'));
  const r = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-30T12:00:00Z', catalogue: loadCatalogue().primitives,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  const runDir = path.join(root, 'job2', 'runs', 'run-8');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, LEARNINGS_FILE), `${JSON.stringify({ phase: 'draft', text: '', ids: [], chars: 0 })}\n`);
  const src = mkdtempSync(path.join(tmpdir(), 'fwdloop-m8-lstart-src-'));
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const res = await new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, 'run', 'job2', '--root', root, '--run-id', 'run-8', '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`], { env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE }, stdio: ['ignore', 'pipe', 'pipe'] });
    kids.push(c);
    let err = '';
    c.stderr.on('data', (b) => { err += b; });
    c.on('exit', (code) => resolve({ code, err }));
  });
  assert.doesNotMatch(res.err, /already exists/);
  assert.equal(res.code, 0, res.err);
  assert.ok(existsSync(path.join(runDir, LEARNINGS_FILE)), 'the record stays with the run');
});
