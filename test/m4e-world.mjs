// Shared by the M4e piece 2b tests: a scratch world (flows root, config home 0700 with a keys file holding a CANARY 0600,
// input files, a destination folder) and a real panel on port 0 driven over real HTTP, with the test draft provider and
// the test model step (both $0). Everything lives under mkdtemp dirs removed at exit; `killChildren` kills every child a
// test left running (the draft and start folders' pid files). Never touches the real HOME or config home.
import {
  chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { createPanelServer } from '../src/panel/server.js';
import { keysForDoor, keysFilePath } from '../src/keysfile.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { signDraft } from '../src/authoring.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { BOX_JOB, inputsText } from './m4e-box-fixture.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_DRAFT = path.join(HERE, 'fixtures', 'cli-fake-draft-provider.mjs');
export const FAKE_STEP = path.join(HERE, 'fixtures', 'm4e-fake-model-step.mjs');
export const GATED_STEP = path.join(HERE, 'fixtures', 'm4e-gated-model-step.mjs');
export const CANARY = 'sk-canary-M4E-piece2b-3c9d1e7a5b2f4860bb77';
export const JOB = BOX_JOB;
export const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
export const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4e-2b-${p}-`));

const HANDLES = [];
const ROOTS = [];

/** Kill every child a test started (drafts and starts), then close every panel. Call once per test file. */
export function killChildrenAfter() {
  after(async () => {
    for (const root of ROOTS) {
      for (const sub of ['.drafts', '.starts']) {
        const dd = path.join(root, sub);
        if (!existsSync(dd)) continue;
        for (const id of readdirSync(dd)) {
          try {
            const pid = JSON.parse(readFileSync(path.join(dd, id, 'pid.json'), 'utf8'));
            if (isFwdloopAlive(pid.pid, pid.procStart) === true) process.kill(-pid.pid, 'SIGKILL');
          } catch { /* none */ }
        }
      }
    }
    await Promise.all(HANDLES.map((h) => h.close()));
  });
}

export function rq(port, {
  method = 'GET', url = '/', headers = {}, body,
} = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const hd = { host: `127.0.0.1:${port}`, ...cookieHeader(port), ...headers };
    if (method === 'POST' && hd.origin === undefined) hd.origin = `http://127.0.0.1:${port}`;
    if (hd.origin === null) delete hd.origin;
    if (hd.cookie === null) delete hd.cookie;
    if (data !== undefined) hd['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: hd, agent: false }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const text = Buffer.concat(ch).toString('utf8');
        resolve({ status: res.statusCode, text, json() { try { return JSON.parse(text); } catch { return null; } } });
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}

export async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn(); // eslint-disable-line no-await-in-loop
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`until timed out: ${fn}`);
    await sleep(25); // eslint-disable-line no-await-in-loop
  }
}

/**
 * @param {{ limit?: number, mode?: string, keysMode?: number, step?: string, bin?: string, extraEnv?: Record<string,string> }} [o]
 */
export async function world({
  limit, mode, keysMode = 0o600, step = FAKE_STEP, bin, extraEnv = {},
} = {}) {
  const work = tmp('w');
  const root = path.join(work, 'flows');
  const inDir = path.join(work, 'in');
  const outDir = path.join(work, 'out');
  const home = path.join(work, 'cfg', 'fwdloop');
  for (const d of [root, inDir, outDir]) mkdirSync(d);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), `DEEPSEEK_API_KEY=${CANARY}\n`, { mode: keysMode });
  chmodSync(keysFilePath(home), keysMode);
  if (limit !== undefined) writeFileSync(path.join(home, 'config.json'), JSON.stringify({ monthlyLimitUsd: limit }));
  writeFileSync(path.join(inDir, 'resume.md'), '# R\n');
  writeFileSync(path.join(inDir, 'jd.md'), '# J\n');
  const gate = path.join(work, 'gate');
  const env = {
    PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT, FWDLOOP_TEST_MODEL_STEP: step, FWDLOOP_TEST_GATE: gate, ...(mode ? { FWDLOOP_TEST_DRAFT_MODE: mode } : {}), ...extraEnv,
  };
  const open = async ({ bin: binOverride } = {}) => {
    const h = remember(await createPanelServer({
      port: 0, root, settings: { home, env: {} }, author: { loadEnv: () => keysForDoor({ env, keysHome: home }), ...(binOverride ?? bin ? { bin: binOverride ?? bin } : {}) },
    }));
    HANDLES.push(h);
    return h;
  };
  ROOTS.push(root);
  const h = await open();
  const card = (over = {}) => ({
    flowName: 'job2', job: JOB, capUsd: '0.25', askWait: '1h', destination: outDir,
    inputs: inputsText([['resume', path.join(inDir, 'resume.md')], ['jd', path.join(inDir, 'jd.md')]]), ...over,
  });
  const post = (url, body, headers) => rq(h.port, { method: 'POST', url, body, headers });
  const get = (url, headers) => rq(h.port, { url, headers });
  const w = {
    work, root, inDir, outDir, home, env, gate, h, open, card, post, get,
    dir: (id) => path.join(root, '.drafts', id),
    starts: () => (existsSync(path.join(root, '.starts')) ? readdirSync(path.join(root, '.starts')) : []),
    inputs: () => [{ role: 'resume', path: path.join(inDir, 'resume.md') }, { role: 'jd', path: path.join(inDir, 'jd.md') }],
    /** Draft through the panel's own door, wait green, sign in-process with the CLI's own `signDraft` (what `fwdloop sign` calls). */
    async signedFlow(over = {}) {
      const id = (await post('/api/author/draft', card(over))).json().draftId;
      const g = await until(async () => { const j = (await get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
      if (g.phase !== 'green') throw new Error(`draft not green: ${JSON.stringify(g)}`);
      // the child writes spec.hash and THEN settles its money hold on exit: wait for it to be gone so a test that watches runs.jsonl sees a still ledger
      const pid = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8'));
      await until(() => isFwdloopAlive(pid.pid, pid.procStart) !== true);
      const r = signDraft({ dir: path.join(w.dir(id), 'draft'), approve: g.hash, signedBy: 'test', env: {} });
      if (!r.ok) throw new Error(`sign failed: ${r.reds.join('; ')}`);
      return { id, flow: over.flowName ?? 'job2', flowDir: r.flowDir };
    },
  };
  return w;
}
