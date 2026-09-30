// M4c amendment 2 POC ($0). NOT shipped, NOT imported by src/.
// Riskiest assumption: a run whose resumer was kill -9'd can be resumed again by a "try again".
// Case 1: killed after the lock, before the answer is consumed (probed by planting the state).
// Case 2: killed mid-step AFTER rename-to-consume (real: hang model step, real kill -9).
// Prints exactly what is on disk after each kill, then runs `fwdloop resume` again (lock removed by hand,
// to isolate "does resumeRun have anything to act on").
//   usage: node poc/m4c/stuck-probe.mjs [scratch-dir]   (default: a fresh mkdtemp under os.tmpdir(), removed at the end)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeFlow } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const FAKE = path.join(REPO, 'test', 'fixtures', 'cli-fake-model-step.mjs');
const HANG = path.join(REPO, 'test', 'fixtures', 'm4c-hang-model-step.mjs');
const fx = (n) => readFileSync(path.join(REPO, 'test', 'fixtures', n), 'utf8');
const ownScratch = process.argv[2] === undefined;
const scratch = ownScratch ? mkdtempSync(path.join(os.tmpdir(), 'stuck-probe-')) : path.resolve(process.argv[2]);
const root = path.join(scratch, 'root');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const env = (m) => ({ PATH: process.env.PATH, NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: m });
const cli = (args, m = FAKE) => spawnSync(process.execPath, [BIN, ...args], { env: env(m), encoding: 'utf8' });

const w = writeFlow({ root, name: 'job2', proseText: fx('job2-with-sources.signed.txt'), declaration: JSON.parse(fx('job2.m1.declaration.json')),
  signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: loadCatalogue().primitives });
if (!w.ok) throw new Error('writeFlow refused');
const src = path.join(scratch, 'in'); mkdirSync(src);
writeFileSync(path.join(src, 'resume.docx'), 'Resume.'); writeFileSync(path.join(src, 'jd.md'), 'JD.');
const runDir = path.join(root, 'job2', 'runs', 'r1');
const out = cli(['run', 'job2', '--root', root, '--source', `resume=${src}/resume.docx`, '--source', `jd=${src}/jd.md`, '--run-id', 'r1']).stdout;
const askId = /askId=(\S+)/.exec(out)[1];
console.log('parked, askId', askId);
const a = cli(['answer', askId, 'redo', 'make it shorter', '--root', root]);
console.log('answer:', a.status, a.stdout.trim().split('\n')[0]);

const dump = (label) => {
  console.log(`\n--- disk after ${label}`);
  console.log('files:', readdirSync(runDir).join(' '));
  console.log('resume.lock bytes:', existsSync(path.join(runDir, 'resume.lock')) ? readFileSync(path.join(runDir, 'resume.lock')).length : 'absent');
  const st = JSON.parse(readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  console.log('state.json keys:', Object.keys(st).join(','), 'stepIndex', st.stepIndex, 'askId', st.askId);
  console.log('pids.jsonl:', existsSync(path.join(runDir, 'pids.jsonl')) ? readFileSync(path.join(runDir, 'pids.jsonl'), 'utf8').trim() : 'absent');
  const au = readFileSync(path.join(runDir, 'audit.jsonl'), 'utf8').trim().split('\n');
  console.log('audit rows', au.length, 'tail:', au.at(-1).slice(0, 160));
};

// Case 2: real resumer, hang step, consumed, kill -9
const child = spawn(process.execPath, [BIN, 'resume', 'r1', '--flow', 'job2', '--root', root], { env: env(HANG), stdio: 'ignore' });
const consumed = path.join(runDir, `answer.${askId}.consumed.json`);
for (let i = 0; i < 100 && !existsSync(consumed); i += 1) await new Promise((r) => setTimeout(r, 100));
await new Promise((r) => setTimeout(r, 500));
process.kill(child.pid, 'SIGKILL');
await new Promise((r) => setTimeout(r, 300));
dump('kill -9 of a real resumer mid-step (case 2)');

console.log('\n--- second resume attempt, lock still present (today)');
let r = cli(['resume', 'r1', '--flow', 'job2', '--root', root]);
console.log(r.status, (r.stderr || r.stdout).trim());
rmSync(path.join(runDir, 'resume.lock'));
console.log('\n--- second resume attempt, lock removed by hand (what (d) would achieve)');
r = cli(['resume', 'r1', '--flow', 'job2', '--root', root]);
console.log(r.status, (r.stderr || r.stdout).trim());
dump('second attempt');
if (ownScratch) rmSync(scratch, { recursive: true, force: true });
