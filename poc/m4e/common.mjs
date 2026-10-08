// M4e POC shared helpers. $0, stub providers only; every child gets a scratch HOME + FWDLOOP_CONFIG_HOME.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const BIN = join(REPO, 'bin', 'fwdloop');
export const SCRATCH_PARENT = process.env.M4E_SCRATCH_PARENT ?? '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/d78a267f-2e0a-405d-9222-3cdec47d1f6b/scratchpad';

export const CANARY = 'sk-canary-M4E-7f3a9c1d2b8e4f60aa55';

/** One scratch tree: home/, cfg/, flows/, drafts/, runs-in/ (inputs), out/ (send folder), logs/. */
export function makeScratch(tag) {
  mkdirSync(SCRATCH_PARENT, { recursive: true });
  const base = mkdtempSync(join(SCRATCH_PARENT, `m4e-${tag}-`));
  const d = Object.fromEntries(['home', 'cfg', 'flows', 'drafts', 'inputs', 'logs'].map((n) => [n, join(base, n)]));
  // FINDING: src/runner.js:344 joins the signed `file:<path>` to the INSTALL dir (REPO_ROOT) and refuses anything outside it,
  // so an absolute scratch send folder cannot sign. The send folder must be repo-relative: made here, removed by cleanup().
  d.outRel = `poc/m4e/scratch-out-${base.slice(-6)}`;
  d.out = join(REPO, d.outRel);
  for (const p of Object.values(d)) if (typeof p === 'string' && p.startsWith(base)) mkdirSync(p, { recursive: true });
  mkdirSync(d.out, { recursive: true });
  writeFileSync(join(d.inputs, 'resume.md'), '# Jo Doe\n\nSenior engineer, ten years.\n');
  writeFileSync(join(d.inputs, 'jd.md'), '# About the role\n\nBuild things.\n\n## Responsibilities\n\nShip.\n');
  const prose = readFileSync(join(REPO, 'test/fixtures/job2-m6a.prose.txt'), 'utf8')
    .replace('@RESUME@', join(d.inputs, 'resume.md')).replace('@JD@', join(d.inputs, 'jd.md'))
    .replace('file:poc/m0/out', `file:${d.outRel}`);
  d.prose = join(d.inputs, 'prose.txt');
  writeFileSync(d.prose, prose);
  d.base = base;
  return d;
}

export function keysFile(s, key = CANARY) {
  const f = join(s.cfg, '.env');
  writeFileSync(f, `DEEPSEEK_API_KEY=${key}\n`, { mode: 0o600 });
  chmodSync(f, 0o600);
  return f;
}

/** Child env: scrubbed of the shell's keys; scratch HOME + config home; test hooks. Never the real HOME. */
export function childEnv(s, extra = {}) {
  const env = {
    PATH: process.env.PATH, HOME: s.home, XDG_RUNTIME_DIR: s.home, XDG_CACHE_HOME: join(s.home, '.cache'),
    FWDLOOP_CONFIG_HOME: s.cfg, NODE_ENV: 'test', ...extra,
  };
  return env;
}

export function cli(s, args, extra = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { env: childEnv(s, extra), encoding: 'utf8', timeout: 60_000 });
}

export const FAKE_DRAFT = join(HERE, 'fake-draft.mjs');
export const FAKE_STEP = join(HERE, 'fake-step.mjs');

export function draftArgs(s, out, name = 'poc-flow') {
  return [s.prose ? 'draft' : 'draft', s.prose, '--out', out, '--root', s.flows, '--name', name];
}

export function lsTree(dir) {
  const out = [];
  const walk = (p, rel) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      out.push(e.isDirectory() ? `${r}/` : r);
      if (e.isDirectory()) walk(join(p, e.name), r);
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out.sort();
}

export function cleanup(s) { for (const p of [s.base, s.out]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } } }
export const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
export function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
