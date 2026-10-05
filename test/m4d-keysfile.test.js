// M4d piece 1 (docs/wiki/the-module-ladder.md, "M4d", scope item 1; negatives (i), (iii), (iv)):
// the keys file. $0, no network. Every test builds its own home under a tracked mkdtemp dir —
// the real ~/.config/fwdloop is never touched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  writeFileSync, readFileSync, existsSync, statSync, chmodSync, mkdirSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import {
  parseKeysText, loadKeysEnv, keysForDoor, keysFilePath, chmodSentence, KEY_NAMES,
} from '../src/keysfile.js';
import { makeProvider, checkKeyPreflight } from '../src/provider.js';
import { createResumer } from '../src/panel/resume.js';
import { createPanelServer } from '../src/panel/server.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { draftToDir } from '../src/authoring.js';
import { RATES, MODEL, job2Fixture } from './drafter-fixture.mjs';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const FAKE_MODEL_STEP = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const ECHO_BIN = path.join(REPO, 'scripts', 'panel-fixtures', 'panel-resume-echo-key.mjs');
const CANARY = 'sk-canary-m4d-p1-0123456789abcdef';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4d-${p}-`));

/** A test home holding a keys file with `body`, at `mode`. */
function homeWith(body, mode = 0o600) {
  const home = path.join(tmp('home'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), body, { mode });
  chmodSync(keysFilePath(home), mode);
  return home;
}

test('parse: export prefix, comments, quotes; bad names and bad lines skipped; a value is never in an error', () => {
  const p = parseKeysText([
    '# a comment', '', 'A=1', 'export B=two', 'C="three"', "D='four'", '  E = five  ',
    '1BAD=x', 'no equals here SECRET-VALUE-NOT-A-PAIR', '=novalue', 'F-G=y', 'H="unterminated',
  ].join('\n'));
  assert.deepEqual(p, {
    A: '1', B: 'two', C: 'three', D: 'four', E: 'five', H: '"unterminated',
  });
});

test('created 0600 in a 0700 dir when missing: commented key names only, no value; not a refusal', () => {
  const home = path.join(tmp('create'), 'fwdloop');
  const r = loadKeysEnv({ env: {}, home });
  assert.equal(r.ok, true);
  assert.equal(r.exists, true);
  assert.equal(statSync(keysFilePath(home)).mode & 0o777, 0o600);
  assert.equal(statSync(home).mode & 0o777, 0o700);
  const text = readFileSync(keysFilePath(home), 'utf8');
  for (const n of KEY_NAMES) assert.ok(text.includes(`# ${n}=`), `${n} listed as a comment`);
  assert.ok(KEY_NAMES.includes('DEEPSEEK_API_KEY') && KEY_NAMES.includes('SYNTHETIC_API_KEY'));
  for (const line of text.split('\n')) assert.ok(line === '' || line.startsWith('#'), `only comments: ${line}`);
  assert.deepEqual(r.names, []);
  assert.equal(r.env.DEEPSEEK_API_KEY, undefined);
  // an existing file is never touched
  writeFileSync(keysFilePath(home), 'DEEPSEEK_API_KEY=mine\n');
  assert.equal(loadKeysEnv({ env: {}, home }).env.DEEPSEEK_API_KEY, 'mine');
});

test('(iii) a keys file with group or other bits is refused with the exact sentence, and carries no file value', () => {
  for (const mode of [0o640, 0o604, 0o644, 0o660, 0o666, 0o602]) {
    const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`, mode);
    const r = loadKeysEnv({ env: {}, home });
    assert.equal(r.ok, false, `mode ${mode.toString(8)}`);
    assert.equal(r.refusal, `Your keys file can be read by other users. Run: chmod 600 ${keysFilePath(home)}`);
    assert.equal(r.refusal, chmodSentence(home));
    assert.equal(r.env.DEEPSEEK_API_KEY, undefined, 'a refusal never hands out a file key');
    assert.ok(!JSON.stringify(r).includes(CANARY));
  }
  // the default home prints the ~ form
  assert.equal(chmodSentence(), 'Your keys file can be read by other users. Run: chmod 600 ~/.config/fwdloop/.env');
  // 0400 (owner read only) and 0600 are fine
  for (const mode of [0o400, 0o600]) assert.equal(loadKeysEnv({ env: {}, home: homeWith('A=1\n', mode) }).ok, true);
});

test('an unreadable file refuses by name, without its content', () => {
  if (process.getuid && process.getuid() === 0) return; // root reads anything
  const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`, 0o000);
  const r = loadKeysEnv({ env: {}, home });
  assert.equal(r.ok, false);
  assert.match(r.refusal, /could not be read \(EACCES\)/);
  assert.ok(!JSON.stringify(r).includes(CANARY));
});

test('(iv) the shell wins: a shell value beats the file; the file only fills unset or empty names', () => {
  const home = homeWith(`DEEPSEEK_API_KEY=from-file-1\nSYNTHETIC_API_KEY=from-file-2\n`);
  const r = loadKeysEnv({ env: { DEEPSEEK_API_KEY: 'from-shell', SYNTHETIC_API_KEY: '' }, home });
  assert.equal(r.env.DEEPSEEK_API_KEY, 'from-shell');
  assert.equal(r.env.SYNTHETIC_API_KEY, 'from-file-2');
  assert.deepEqual(r.shellOnly, ['DEEPSEEK_API_KEY'].filter((n) => !r.names.includes(n)));
});

test('loading returns a NEW env and never mutates process.env or the base env', () => {
  const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`);
  const base = { PATH: '/x' };
  const before = JSON.stringify(process.env);
  const r = loadKeysEnv({ env: base, home });
  assert.equal(r.env.DEEPSEEK_API_KEY, CANARY);
  assert.notEqual(r.env, base);
  assert.deepEqual(base, { PATH: '/x' });
  assert.equal(JSON.stringify(process.env), before);
  assert.ok(!Object.values(process.env).includes(CANARY));
  loadKeysEnv({ home }); // default base = process.env
  assert.equal(JSON.stringify(process.env), before);
  assert.ok(!Object.values(process.env).includes(CANARY), 'the file key never lands in process.env');
  assert.equal(base.DEEPSEEK_API_KEY, undefined);
});

test('names-only info: names, path, exists, shellOnly — no value anywhere but env', () => {
  const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n# SYNTHETIC_API_KEY=\n`);
  const r = loadKeysEnv({ env: { SYNTHETIC_API_KEY: 'shellval-123456' }, home });
  const { env, ...info } = r;
  assert.deepEqual(info.names, ['DEEPSEEK_API_KEY']);
  assert.deepEqual(info.shellOnly, ['SYNTHETIC_API_KEY']);
  assert.equal(info.exists, true);
  assert.equal(info.path, keysFilePath(home));
  assert.ok(!JSON.stringify(info).includes(CANARY) && !JSON.stringify(info).includes('shellval'));
});

test('keysForDoor: an injected env alone, or NODE_ENV=test without a home, never reads or creates a file', () => {
  const r = keysForDoor({ env: { A: '1' } });
  assert.equal(r.skipped, true);
  assert.equal(r.env.A, '1');
  const r2 = keysForDoor({ env: {}, keysHome: homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`) });
  assert.equal(r2.skipped, false);
  assert.equal(r2.env.DEEPSEEK_API_KEY, CANARY);
});

test('(i) makeProvider and checkKeyPreflight take the merged env: the file key is used, process.env is not consulted', () => {
  const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`);
  const { env } = loadKeysEnv({ env: {}, home });
  assert.equal(process.env.DEEPSEEK_API_KEY === CANARY, false);
  assert.equal(checkKeyPreflight('deepseek', env).ok, true);
  const built = makeProvider('deepseek', { env });
  assert.equal(built.provider.apiKey, CANARY);
  // without the merged env the same call refuses (the shell has no key): the env option is what carries it
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    assert.throws(() => makeProvider('deepseek', { env: {} }), /DEEPSEEK_API_KEY is not set/);
    assert.throws(() => makeProvider('deepseek'), /DEEPSEEK_API_KEY is not set/);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});

test('(i) a file key is scrubbed from a drafter red exactly like a shell key', async () => {
  const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`);
  const { env } = loadKeysEnv({ env: {}, home });
  const fx = job2Fixture();
  const work = tmp('draft');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const provider = { lastMalformedToolCall: null, async generate() { throw new Error(`401 invalid Authorization: Bearer ${CANARY}`); } };
  const r = await draftToDir({
    proseFile, dir: path.join(work, 'd'), root: path.join(work, 'flows'), name: 'job2', provider, rates: RATES, modelId: MODEL, env,
  });
  assert.equal(r.ok, false);
  assert.ok(!r.reds.join(' ').includes(CANARY), 'the file key never leaves in a red');
  assert.match(r.reds.join(' '), /\[redacted-key\]/);
  for (const f of readdirSync(path.join(work, 'd'))) assert.ok(!readFileSync(path.join(work, 'd', f), 'utf8').includes(CANARY), f);
});

/** Drive the real resumer with the echo-key child; `home` is the keys home the resumer's loadEnv reads. */
async function resumeWith(home, { loadEnv }) {
  const dir = tmp('resume');
  const runDir = path.join(dir, 'run');
  mkdirSync(runDir);
  const echoed = path.join(dir, 'echoed');
  const release = path.join(dir, 'release');
  const logDir = path.join(dir, 'logs');
  const resumer = createResumer({
    root: dir, loadEnv: () => loadEnv({ ECHOED_FILE: echoed, RELEASE_FILE: release }), bin: ECHO_BIN, logDir, maxTries: 1, windowMs: 30000, slotMs: 30000,
  });
  resumer.start({
    flow: 'f', runId: 'r1', runDir, askId: 'a1',
  });
  return {
    resumer, echoed, release, logDir,
  };
}

test('(i) panel resume: the merged file-key env is the spawn env AND the scrub list — canary absent from the refusal text; the raw child log (0600 dir) is the only holder', async () => {
  const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`);
  const {
    resumer, echoed, release, logDir,
  } = await resumeWith(home, { loadEnv: (extra) => keysForDoor({ env: { PATH: process.env.PATH, ...extra }, keysHome: home }) });
  for (let i = 0; i < 200 && !existsSync(echoed); i += 1) await sleep(50);
  assert.ok(existsSync(echoed), 'the child ran and echoed the file key (the scan can see it)');
  const live = readdirSync(logDir).map((f) => readFileSync(path.join(logDir, f), 'utf8')).join('\n');
  assert.ok(live.includes(CANARY), 'control: the child received the file key through the merged env');
  writeFileSync(release, '');
  await sleep(300);
  const rec = resumer.get('f', 'r1');
  assert.ok(!(rec.refusal ?? '').includes(CANARY));
  assert.ok(!JSON.stringify(rec).includes(CANARY));
  assert.ok(!Object.values(process.env).includes(CANARY));
});

test('(iii)+(i) panel resume with a group-readable keys file: refused with the chmod sentence, nothing spawned, canary absent', async () => {
  const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`, 0o640);
  const {
    resumer, echoed, logDir,
  } = await resumeWith(home, { loadEnv: (extra) => keysForDoor({ env: { PATH: process.env.PATH, ...extra }, keysHome: home }) });
  for (let i = 0; i < 100 && resumer.get('f', 'r1').state === 'in-flight'; i += 1) await sleep(20);
  const rec = resumer.get('f', 'r1');
  assert.equal(rec.state, 'stuck');
  assert.equal(rec.refusal, chmodSentence(home));
  assert.ok(!JSON.stringify(rec).includes(CANARY));
  assert.equal(existsSync(echoed), false, 'no child was spawned');
  assert.ok(!existsSync(logDir) || readdirSync(logDir).length === 0 || !readdirSync(logDir).some((f) => readFileSync(path.join(logDir, f), 'utf8').includes(CANARY)));
});

test('panel resume re-reads the keys file before each spawn: fixing the mode needs no restart', async () => {
  const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`, 0o640);
  const loadEnv = (extra) => keysForDoor({ env: { PATH: process.env.PATH, ...extra }, keysHome: home });
  const first = await resumeWith(home, { loadEnv });
  for (let i = 0; i < 100 && first.resumer.get('f', 'r1').state === 'in-flight'; i += 1) await sleep(20);
  assert.equal(first.resumer.get('f', 'r1').state, 'stuck');
  chmodSync(keysFilePath(home), 0o600);
  const dir = tmp('resume2');
  const runDir = path.join(dir, 'run');
  mkdirSync(runDir);
  const echoed = path.join(dir, 'echoed');
  const release = path.join(dir, 'release');
  const resumer = createResumer({
    root: dir, loadEnv: () => loadEnv({ ECHOED_FILE: echoed, RELEASE_FILE: release }), bin: ECHO_BIN, logDir: path.join(dir, 'logs'), maxTries: 1, windowMs: 30000, slotMs: 30000,
  });
  resumer.start({
    flow: 'f', runId: 'r1', runDir, askId: 'a1',
  });
  for (let i = 0; i < 200 && !existsSync(echoed); i += 1) await sleep(50);
  writeFileSync(release, '');
  assert.ok(existsSync(echoed), 'after chmod 600 the same resumer-shape loader lets the child run');
});

/** A spawned CLI with a clean env (never a spread of process.env). */
const cli = (args, env) => spawnSync(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 15000 });

test('(iii) CLI: run, resume, draft and sign refuse a group-readable keys file at $0 — the sentence, no run dir, no ledger, no canary', () => {
  // Test seam: FWDLOOP_CONFIG_HOME, honored ONLY when NODE_ENV=test (same two-gate shape as FWDLOOP_TEST_MODEL_STEP).
  const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`, 0o640);
  const root = tmp('cli-root');
  const env = { NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE_MODEL_STEP, FWDLOOP_CONFIG_HOME: home };
  const sentence = chmodSentence(home);
  const cases = [
    ['run', 'job2', '--root', root, '--run-id', 'run-1'],
    ['resume', 'run-1', '--flow', 'job2', '--root', root],
    ['draft', path.join(root, 'p.txt'), '--out', path.join(root, 'd'), '--root', root, '--name', 'x'],
    ['sign', path.join(root, 'd'), '--approve', 'h'],
  ];
  for (const args of cases) {
    const r = cli(args, env);
    assert.equal(r.status, 1, `${args[0]}: ${r.stderr}`);
    assert.ok(r.stderr.includes(sentence), `${args[0]} says the chmod sentence: ${r.stderr}`);
    assert.ok(!(r.stderr + r.stdout).includes(CANARY), `${args[0]} never prints the key`);
  }
  assert.deepEqual(readdirSync(root), [], 'nothing was created under the root (no run dir, no ledger)');
  // the same file at 0600 is NOT a refusal of the keys file (the command goes on and fails for its own reason)
  chmodSync(keysFilePath(home), 0o600);
  const ok = cli(cases[0], env);
  assert.ok(!ok.stderr.includes('keys file'), ok.stderr);
  assert.ok(!(ok.stderr + ok.stdout).includes(CANARY));
});

test('CLI under NODE_ENV=test with no FWDLOOP_CONFIG_HOME never reads or creates the real keys file', () => {
  const fakeHome = tmp('nohome');
  const r = cli(['run', 'job2', '--root', fakeHome, '--run-id', 'run-1'], { NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE_MODEL_STEP, HOME: fakeHome });
  assert.ok(!r.stderr.includes('keys file'), r.stderr);
  assert.equal(existsSync(path.join(fakeHome, '.config')), false, 'no ~/.config/fwdloop created');
});

test('panel server wiring: a real POST /api/answer through createPanelServer reads the keys file (group-readable -> stuck with the chmod sentence, no child)', async () => {
  // a parked job #2 run, built at $0 through the CLI with the fake model step (no keys file involved: no FWDLOOP_CONFIG_HOME in the child)
  const fx = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
  const root = tmp('srv-root');
  const src = tmp('srv-src');
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fx('job2-with-sources.signed.txt')), declaration: JSON.parse(fx('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: loadCatalogue().primitives,
  });
  assert.equal(w.ok, true);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const childEnv = { PATH: process.env.PATH, NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE_MODEL_STEP, DEEPSEEK_API_KEY: 'sk-test-m4d-wiring-0001' };
  const parked = spawnSync(process.execPath, [BIN, 'run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'run-1'], { env: childEnv, encoding: 'utf8' });
  assert.equal(parked.status, 0, parked.stderr);
  const runDir = path.join(root, 'job2', 'runs', 'run-1');
  const askId = JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8')).askId;

  const home = homeWith(`DEEPSEEK_API_KEY=${CANARY}\n`, 0o640);
  const saved = { NODE_ENV: process.env.NODE_ENV, FWDLOOP_CONFIG_HOME: process.env.FWDLOOP_CONFIG_HOME };
  process.env.NODE_ENV = 'test';
  process.env.FWDLOOP_CONFIG_HOME = home;
  const logDir = tmp('srv-logs');
  const h = remember(await createPanelServer({ port: 0, root, resume: { env: childEnv, logDir, maxTries: 1 } }));
  try {
    const hdr = { host: `127.0.0.1:${h.port}`, origin: `http://127.0.0.1:${h.port}`, ...cookieHeader(h.port), 'content-type': 'application/json' };
    const post = await fetch(`http://127.0.0.1:${h.port}/api/answer`, { method: 'POST', headers: hdr, body: JSON.stringify({ flow: 'job2', runId: 'run-1', askId, decision: 'redo', reason: 'again' }) });
    assert.equal(post.status, 202);
    let data;
    for (let i = 0; i < 200; i += 1) {
      data = await (await fetch(`http://127.0.0.1:${h.port}/api/runs/job2/run-1`, { headers: hdr })).json();
      if (data.resume && !['in-flight', 'starting'].includes(data.resume.state)) break;
      await sleep(25);
    }
    assert.equal(data.resume.state, 'not-started', JSON.stringify(data.resume));
    assert.ok(String(data.resume.reason).includes(chmodSentence(home)), JSON.stringify(data.resume));
    assert.ok(!JSON.stringify(data).includes(CANARY));
    assert.equal(existsSync(path.join(runDir, `answer.${askId}.consumed.json`)), false, 'no child ran: the answer was not consumed');
  } finally {
    await h.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
