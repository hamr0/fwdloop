// F234 / M19 am3: no can't-check ask ($0, no AI, no key). usage: node poc/m19-am3/run.mjs [--base <sha>]
// Baseline = a git worktree of the commit before the change (default: the F234 pre-registration's parent); this tree = after. Read-only over cp -a copies of the draft folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const W = path.join(REPO, '.claude', 'scratch', 'v061', 'am3');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', timeout: 240000, ...o });
fs.rmSync(W, { recursive: true, force: true });
fs.mkdirSync(W, { recursive: true });
sh('cp', ['-a', path.join(os.homedir(), '.config', 'fwdloop', 'flows', '.drafts'), path.join(W, 'home-drafts')]);
sh('cp', ['-a', path.join(REPO, '.claude', 'scratch', 'm19-walk-YBSm', 'flows', '.drafts'), path.join(W, 'walk-drafts')]);
const base = path.join(W, 'base');
sh('git', ['-C', REPO, 'worktree', 'add', '--detach', base, arg('base', '6d58aff7')]);
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(base, 'node_modules'));
const lines = []; const say = (s) => { lines.push(s); console.log(s); };
const RT = 'd-00mwp03sp5-7d14/draft/prose.txt';
try {
  const run = (repo, tag) => { for (const set of ['home', 'walk']) sh('node', [path.join(REPO, 'poc', 'm19-am3', 'snap.mjs'), repo, path.join(W, `${set}-drafts`), path.join(W, `${tag}-${set}.json`)], { cwd: W }); };
  run(base, 'before'); run(REPO, 'after');
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(W, f), 'utf8'));
  const kind = (q) => q.split('@')[0];
  for (const set of ['walk', 'home']) {
    const a = rd(`before-${set}.json`); const b = rd(`after-${set}.json`);
    let changed = 0; let skipped = 0; let threw = 0; let bad = 0; const kinds = {}; const detail = [];
    for (const k of Object.keys(a)) {
      if (a[k].skipped) { skipped += 1; continue; }
      if (a[k].threw || b[k]?.threw) { threw += 1; continue; }
      if (JSON.stringify(a[k].open) !== JSON.stringify(b[k].open)) {
        changed += 1;
        const gone = a[k].open.filter((q) => !b[k].open.includes(q)); const added = b[k].open.filter((q) => !a[k].open.includes(q));
        for (const q of gone) kinds[kind(q)] = (kinds[kind(q)] ?? 0) + 1;
        if (added.length || gone.some((q) => kind(q) !== 'cant-check' && kind(q) !== 'no-check')) bad += 1;
        detail.push(`${k}: gone [${gone.map(kind).join(',')}] added [${added.map(kind).join(',')}]`);
      }
    }
    say(`(c) ${set} drafts: ${Object.keys(a).length} folders, skipped ${skipped}, threw ${threw}, open list CHANGED ${changed}; questions gone by kind ${JSON.stringify(kinds)}; drafts where a reading/check ask changed or one was added ${bad}`);
    for (const d of detail.slice(0, 40)) say(`   ${d}`);
  }
  const a = rd('before-walk.json')[RT]; const b = rd('after-walk.json')[RT];
  say(`research-tracker (${RT}): BEFORE open ${JSON.stringify(a.open)} candidates ${JSON.stringify(a.candidates)}`);
  say(`research-tracker: AFTER  open ${JSON.stringify(b.open)} candidates ${JSON.stringify(b.candidates)}`);
  const noAsk = b.open.every((q) => !/^(cant-check|no-check)@/.test(q));
  say(`(a) after: no can't-check question ${noAsk}; candidates ${b.candidates.length} of 3 -> ${noAsk && b.candidates.length === 3 ? 'PASS' : 'FAIL'}`);
  say(`(b) before: candidates ${a.candidates.length}, can't-check questions ${a.open.filter((q) => /^(cant-check|no-check)@/.test(q)).length} -> ${a.candidates.length === 0 ? 'PASS (bar can fail)' : 'FAIL'}`);
  fs.writeFileSync(path.join(W, 'RESULT.txt'), `${lines.join('\n')}\n`);
} finally {
  try { sh('git', ['-C', REPO, 'worktree', 'remove', '--force', base]); } catch (e) { console.error(e.message); }
  sh('git', ['-C', REPO, 'worktree', 'prune']);
}
