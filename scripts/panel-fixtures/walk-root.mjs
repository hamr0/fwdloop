// Lives outside test/ on purpose: `node --test` runs every file under test/ as a test.
// M4b piece 4: a flows root for a REAL browser walk of the answer doors, built at $0
// (the CLI's test-only fake model step; no provider, no network, no key).
//   usage: node scripts/panel-fixtures/walk-root.mjs [<root-dir>] [<port>]
// Builds job2 with three runs:
//   run-open   parked at an open ask      -> the three doors
//   run-stuck  answer saved, resume.lock left by a DEAD holder -> [II] stuck, pulsing; try-again clears it
//   run-stuck-empty  answer saved, EMPTY resume.lock (pre-amendment) -> [II] stuck; try-again refuses by name
//   run-done   accepted and completed      -> [✓] and the sent artifact in the Run tab
// and prints the exact command to start the panel on it.
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { procStartOf } from '../../src/liveness.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFlow } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const FAKE = path.join(REPO, 'test', 'fixtures', 'cli-fake-model-step.mjs');
const fx = (n) => readFileSync(path.join(REPO, 'test', 'fixtures', n), 'utf8');

const root = path.resolve(process.argv[2] ?? path.join(process.cwd(), 'walk-root'));
const port = process.argv[3] ?? '4811';
const env = { PATH: process.env.PATH, NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE };
const cli = (args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fwdloop ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
};

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const w = writeFlow({
  root,
  name: 'job2',
  proseText: fx('job2-with-sources.signed.txt'),
  declaration: JSON.parse(fx('job2.m1.declaration.json')),
  signedBy: 'hamr',
  signedAt: '2026-09-25T12:00:00Z',
  catalogue: loadCatalogue().primitives,
});
if (!w.ok) throw new Error(`writeFlow refused: ${JSON.stringify(w)}`);

const src = path.join(root, '..', `${path.basename(root)}-inputs`);
rmSync(src, { recursive: true, force: true });
mkdirSync(src, { recursive: true });
writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
const park = (runId) => {
  const out = cli(['run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`,
    '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', runId]);
  return /askId=(\S+)/.exec(out)[1];
};

// (c) completed
const doneAsk = park('run-done');
cli(['answer', doneAsk, 'accept', '--root', root]);
cli(['resume', 'run-done', '--flow', 'job2', '--root', root]);
// (b) answer saved, resume blocked by a held lock
// M4c amendment 2 (d): a lock names its holder. A holder that is gone: a real process that has exited.
const deadHolder = spawnSync(process.execPath, ['-e', '']);
const stuckAsk = park('run-stuck');
cli(['answer', stuckAsk, 'accept', '--root', root]);
writeFileSync(path.join(root, 'job2', 'runs', 'run-stuck', 'resume.lock'), JSON.stringify({ pid: deadHolder.pid, procStart: procStartOf('self') }));
// and a pre-amendment lock with no holder at all (what a kill -9'd resumer used to leave)
const emptyAsk = park('run-stuck-empty');
cli(['answer', emptyAsk, 'accept', '--root', root]);
writeFileSync(path.join(root, 'job2', 'runs', 'run-stuck-empty', 'resume.lock'), '');
// (a) parked at an open ask
park('run-open');

process.stdout.write(`root: ${root}
  run-open   open ask, three doors
  run-stuck  answer saved, resume.lock names a dead holder ("try the resume again" clears it and resumes)
  run-stuck-empty  answer saved, empty resume.lock ("try the resume again" refuses by name; rm ${path.join(root, 'job2', 'runs', 'run-stuck-empty', 'resume.lock')} by hand)
  run-done   completed [✓]
start the panel (answers resume with the fake model step, $0):
  NODE_ENV=test FWDLOOP_TEST_MODEL_STEP=${FAKE} node ${path.join(REPO, 'bin', 'fwdloop')} panel --root ${root} --port ${port}
then open http://127.0.0.1:${port}/ (desktop and 390 px)
`);
