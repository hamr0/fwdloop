// F232 / M19 P3: rules first stays byte-identical ($0, no AI, no key). usage: node poc/m19-p3/run.mjs [--answers <p2 answers.json>] [--base <sha>]
// Baseline = a git worktree of the last commit before M19's S1 under .claude/scratch/v061/p3/base (removed afterwards); HEAD = this tree. Read-only over a cp -a copy of ~/.config/fwdloop/flows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const W = path.join(REPO, '.claude', 'scratch', 'v061', 'p3');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const BASE_SHA = arg('base', '1b8a8ff6');
const answersPath = arg('answers', null);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 120000, ...opts });

fs.rmSync(W, { recursive: true, force: true });
fs.mkdirSync(W, { recursive: true });
const flows = path.join(W, 'flows');
sh('cp', ['-a', path.join(os.homedir(), '.config', 'fwdloop', 'flows'), flows]);
const base = path.join(W, 'base');
const worktrees = [];
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
// the tips compared with the baseline: S4's last commit (S1-S4 present, the bar's wording), S5's last, and HEAD (the pre-registered reading). Each is a worktree, removed afterwards.
const TIPS = [['S1-S4 tip', arg('s4', 'ad847e64')], ['S5 tip', arg('s5', '834eb867')], ['HEAD', 'HEAD']];
const addTree = (name, sha) => {
  const dir = path.join(W, name);
  sh('git', ['-C', REPO, 'worktree', 'add', '--detach', dir, sha]);
  worktrees.push(dir);
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
};
const snap = (repo, out) => sh('node', [path.join(HERE, 'snap.mjs'), repo, flows, out], { cwd: W }).trim();
const rd = (f) => JSON.parse(fs.readFileSync(path.join(W, f), 'utf8'));
try {
  const baseDir = addTree('base', BASE_SHA);
  say(`baseline ${sh('git', ['-C', REPO, 'rev-parse', '--short', BASE_SHA]).trim()} (the last commit before M19 S1); this tree HEAD ${sh('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']).trim()}${sh('git', ['-C', REPO, 'status', '--porcelain', '--', 'src']).trim() ? ' (src has uncommitted changes)' : ''}`);
  say(snap(baseDir, path.join(W, 'base.json')));
  const a = rd('base.json');
  for (const [name, sha] of TIPS) {
    const dir = sha === 'HEAD' ? REPO : addTree(name.replace(/\W+/g, '-'), sha);
    const out = `${name.replace(/\W+/g, '-')}.json`;
    snap(dir, path.join(W, out));
    const b = rd(out);
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const changed = [];
    let skipped = 0; let threw = 0;
    const partCount = {};
    for (const k of keys) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        changed.push(k);
        const pa = a[k] ?? {}; const pb = b[k] ?? {};
        for (const p of new Set([...Object.keys(pa), ...Object.keys(pb)])) if (JSON.stringify(pa[p]) !== JSON.stringify(pb[p])) partCount[p] = (partCount[p] ?? 0) + 1;
      }
      if (a[k]?.skipped) skipped += 1;
      for (const part of Object.values(a[k] ?? {})) if (part && typeof part === 'object' && 'threw' in part) { threw += 1; break; }
    }
    say(`half 1 at ${name} (${sh('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']).trim()}): jobs ${keys.length}, skipped (no prose or declaration) ${skipped}, a reader threw at the baseline ${threw}, CHANGED ${changed.length}${changed.length ? ` (readers changed: ${JSON.stringify(partCount)}; first: ${changed.slice(0, 3).join(', ')})` : ''}`);
    say(`  verdict on the letter at ${name}: ${changed.length === 0 ? 'PASS (0 jobs changed)' : 'FAIL (jobs changed with no shape answer)'}`);
  }
  if (answersPath) say(`half 2: answers file ${answersPath} given: run poc/m19-p3/withanswers.mjs`); else say("half 2 (with P2's answers): waits for P2 (no --answers file)");
  fs.writeFileSync(path.join(W, 'RESULT.txt'), `${lines.join('\n')}\n`);
} finally {
  for (const dir of worktrees) { try { sh('git', ['-C', REPO, 'worktree', 'remove', '--force', dir]); } catch (e) { console.error(`worktree remove failed: ${e.message}`); } }
  sh('git', ['-C', REPO, 'worktree', 'prune']);
}
