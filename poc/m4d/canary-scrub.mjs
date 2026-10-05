// POC m4d (a): does a key loaded from a FILE (merged into the child's env, NOT in process.env) leak into the
// panel resume child's log? Drives the real createResumer (src/panel/resume.js) with the echo-key fixture.
// Three cases: control (canary in process.env + opts.env -> scrubbed), merged-env (canary only in opts.env),
// and mismatch (child gets merged env but resumer's scrub env lacks it: the M4d wiring mistake to guard).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createResumer } from '../../src/panel/resume.js';

const REPO = resolve(new URL('../..', import.meta.url).pathname);
const BIN = join(REPO, 'scripts/panel-fixtures/panel-resume-echo-key.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = (t, s) => t.split(s).length - 1;

async function runCase(name, { childEnv, canary, useProcessEnv = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'm4d-canary-'));
  const runDir = join(dir, 'run'); mkdirSync(runDir);
  const logDir = join(dir, 'logs');
  const echoed = join(dir, 'echoed'); const release = join(dir, 'release');
  // clean exit deletes the log, so snapshot it while the child is alive (as the real test does)
  if (useProcessEnv) Object.assign(process.env, { ECHOED_FILE: echoed, RELEASE_FILE: release });
  const resumer = createResumer({
    root: dir, ...(useProcessEnv ? {} : { env: { ...childEnv, ECHOED_FILE: echoed, RELEASE_FILE: release } }), bin: BIN, logDir, maxTries: 1, windowMs: 30000, slotMs: 30000,
  });
  resumer.start({ flow: 'f', runId: 'r1', runDir, askId: 'a1' });
  for (let i = 0; i < 200 && !existsSync(echoed); i += 1) await sleep(50);
  const logs = existsSync(logDir) ? readdirSync(logDir).map((f) => readFileSync(join(logDir, f), 'utf8')) : [];
  writeFileSync(release, '');
  await sleep(300);
  // the refusal text path (sliceOfLog -> scrub) only fires on non-zero exit; call it via the 'slow' path:
  // here we report the raw log (what lands on disk) and the record's refusal text if any.
  const rec = resumer.get('f', 'r1');
  const log = logs.join('\n');
  const out = { name, echoedWritten: logs.length > 0, logOccurrences: count(log, canary), refusalOccurrences: count(rec?.refusal ?? '', canary), refusalState: rec?.state, refusalRedactedMarkers: count(rec?.refusal ?? '', '[redacted-key]') };
  rmSync(dir, { recursive: true, force: true });
  return out;
}

const canary = `sk-canary-m4d-${randomBytes(4).toString('hex')}`;
const base = { ...process.env }; delete base.DEEPSEEK_API_KEY;
const results = [];
// control: canary in process.env itself, opts.env omitted (production today: env = process.env)
process.env.DEEPSEEK_API_KEY = canary;
results.push(await runCase('control (canary in process.env, opts.env omitted)', { canary, useProcessEnv: true }));
delete process.env.DEEPSEEK_API_KEY;
// file-loaded: canary only in the merged env handed to the resumer; process.env has none
results.push(await runCase('merged-env (file-loaded canary in opts.env only)', { childEnv: { ...base, DEEPSEEK_API_KEY: canary }, canary }));
console.log(JSON.stringify({ processEnvHasCanaryAfterControl: Object.values(process.env).includes(canary), results }, null, 2));
