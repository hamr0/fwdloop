// F235 / M19 am4 ($0, no AI, no key). usage: node poc/readout-model/run.mjs [--base <sha>]
// before = a git worktree of --base (default HEAD, the commit before the change); after = this tree. Read-only over cp -a copies of the draft folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ncRowsOf } from '../../src/checklook.js';
import { EVERY_STEP_TEXTS } from '../../src/try-checks.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const W = path.join(REPO, '.claude', 'scratch', 'readout-model', 'poc');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', timeout: 240000, ...o });
const BASE = arg('base', 'HEAD');
const AFTER = arg('after', 'repo'); // 'repo' = this tree; or a path
fs.rmSync(W, { recursive: true, force: true });
fs.mkdirSync(W, { recursive: true });
const sets = { home: path.join(os.homedir(), '.config', 'fwdloop', 'flows', '.drafts'), walk: path.join(REPO, '.claude', 'scratch', 'm19-walk-YBSm', 'flows', '.drafts') };
for (const [k, v] of Object.entries(sets)) sh('cp', ['-a', v, path.join(W, `${k}-drafts`)]);
// the harness tests the two trees by copying the checked-in sha to a worktree
const base = path.join(W, 'base');
sh('git', ['-C', REPO, 'worktree', 'add', '--detach', base, BASE]);
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(base, 'node_modules'));
const lines = []; const say = (s) => { lines.push(s); console.log(s); };
let bad = false;
try {
  const snap = (repo, tag) => { for (const k of Object.keys(sets)) sh('node', [path.join(REPO, 'poc', 'readout-model', 'snap.mjs'), repo, path.join(W, `${k}-drafts`), path.join(W, `${tag}-${k}.json`)], { timeout: 280000 }); };
  snap(base, 'before'); snap(AFTER === 'repo' ? REPO : AFTER, 'after');
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(W, f), 'utf8'));
  const before = [...rd('before-home.json'), ...rd('before-walk.json')];
  const after = [...rd('after-home.json'), ...rd('after-walk.json')];
  const fmt = (t) => `${t.by}|${t.kind}|${t.text}`;
  // the page's own rule for what a line's card shows (planOfState, planViewHtml), the tuples written here, not by the code under test
  const expectedFor = (p, n) => {
    const one = p.jobLines.length === 1;
    const own = (x) => p.jobLines.includes(x);
    const checks = p.card.rows.filter((r) => r.line === n && r.state === 'built').map((r) => ({ by: r.by, kind: r.kind || 'truth', text: r.text }));
    if (one) checks.push(...EVERY_STEP_TEXTS.map((text) => ({ by: 'default', kind: 'file', text })));
    const nc = ncRowsOf(p.nc.items, p.nc.by).filter((r) => r.line === n || (one && !own(r.line))).map((r) => ({ by: r.by ?? 'default', kind: '', text: `${r.text}${r.why ? ` — ${r.why}` : ''}` }));
    const sg = p.card.suggested.filter((x) => x.line === n || (one && !own(x.line))).map((x) => ({ by: 'agent', kind: /\.shape\./.test(x.key) ? 'shape' : 'truth', text: x.text + (x.dropped ? ' (you dropped it)' : '') }));
    return { checks, nc, sg };
  };
  // what a readout says of one job line: its rows by group (fixed columns of readoutGroups)
  const blocksOf = (text) => {
    const L = text.split('\n'); const out = {}; let cur = null; let grp = null; let inSteps = false;
    for (const l of L) {
      if (l === 'STEPS') { inSteps = true; continue; }
      if (!inSteps) continue;
      if (l === '' || /^[A-Z]/.test(l)) { if (l !== '' && l !== 'STEPS') inSteps = false; cur = null; continue; }
      const m = /^ {2}\d+\. \(line (\d+)\)/.exec(l);
      if (m) { cur = Number(m[1]); out[cur] ??= { checks: [], nc: [], sg: [] }; grp = null; continue; }
      if (/^ {2}EVERY LINE$/.test(l)) { cur = null; continue; }
      if (cur === null) continue;
      if (/^ {5}CHECKED ·/.test(l)) grp = 'checks'; else if (/^ {5}NOT CHECKED ·/.test(l)) grp = 'nc'; else if (/^ {5}SUGGESTED ·/.test(l)) grp = 'sg';
      else if (grp && /^ {7}\[/.test(l)) out[cur][grp].push({ by: l.slice(8, 16).replace(/[\]\s]/g, ''), kind: l.slice(18, 23).trim(), text: l.slice(25) });
      else grp = null;
    }
    return out;
  };
  // am4 item 3: the lines that must not change, filtered out of a readout
  const item3 = (text) => {
    const L = text.split('\n'); const keep = []; let sec = ''; let every = false;
    for (const l of L) {
      if (l === '' ) every = false;
      if (/^[A-Z]/.test(l)) sec = l;
      if (sec !== 'STEPS') { keep.push(l); continue; }
      if (/^ {2}EVERY LINE$/.test(l)) every = true;
      if (every || /^ {2}\d+\. \(line/.test(l) || /^ {5}(grants|tools):/.test(l) || /^ {5}cells only from column/.test(l) || /sections: /.test(l)) keep.push(l);
    }
    return keep;
  };
  const kindOf = (l) => (/^ {5}(CHECKED|NOT CHECKED|SUGGESTED)/.test(l) ? 'group head' : /^ {7}\[/.test(l) ? 'group row' : /^ {5}sheet check: /.test(l) ? 'sheet check line' : /fact ·|you picked:/.test(l) ? 'hand-built fact/pick line' : /^ {5}/.test(l) ? 'other step line' : 'outside steps');
  let n = 0, skipped = 0, threw = 0, cardPlans = 0, noCard = 0, aBad = 0, aRows = 0, cBad = 0, dBad = 0; const diffKinds = {}; const aFirst = []; const cFirst = []; const dFirst = [];
  for (let i = 0; i < before.length; i++) {
    const b = before[i]; const a = after[i];
    if (b.skipped || a.skipped) { skipped++; continue; }
    n++;
    if (b.threw || a.threw) { threw++; say(`THREW ${b.id}: before=${b.threw ?? '-'} after=${a.threw ?? '-'}`); continue; }
    if (!a.cardList) {
      noCard++;
      if (a.readout !== b.readout) { dBad++; if (dFirst.length < 3) dFirst.push(a.id); }
      continue;
    }
    cardPlans++;
    const ba = blocksOf(a.readout);
    for (const ln of a.cardLines) {
      if (!a.jobLines.includes(ln)) continue;
      const e = expectedFor(a, ln); const g = ba[ln] ?? { checks: [], nc: [], sg: [] };
      for (const k of ['checks', 'nc', 'sg']) {
        aRows += e[k].length;
        if (JSON.stringify(e[k].map(fmt)) !== JSON.stringify(g[k].map(fmt))) { aBad++; if (aFirst.length < 4) aFirst.push(`${a.id} line ${ln} ${k}: want ${JSON.stringify(e[k].map(fmt)).slice(0, 220)} got ${JSON.stringify(g[k].map(fmt)).slice(0, 220)}`); }
      }
    }
    const ib = item3(b.readout); const ia = item3(a.readout);
    if (JSON.stringify(ib) !== JSON.stringify(ia)) { cBad++; if (cFirst.length < 3) cFirst.push(a.id); }
    // the difference list, by kind, of the lines outside item 3
    const lb = b.readout.split('\n'); const la = a.readout.split('\n');
    const cnt = (arr) => arr.reduce((m, l) => (m.set(l, (m.get(l) ?? 0) + 1), m), new Map());
    const cb = cnt(lb); const ca = cnt(la);
    for (const [l, c] of cb) { const d = c - (ca.get(l) ?? 0); if (d > 0) diffKinds[`removed: ${kindOf(l)}`] = (diffKinds[`removed: ${kindOf(l)}`] ?? 0) + d; }
    for (const [l, c] of ca) { const d = c - (cb.get(l) ?? 0); if (d > 0) diffKinds[`added: ${kindOf(l)}`] = (diffKinds[`added: ${kindOf(l)}`] ?? 0) + d; }
  }
  const rt = after.find((x) => x.id.endsWith('d-00mwp4ftwv-b5f0/draft')); const rtb = before.find((x) => x.id.endsWith('d-00mwp4ftwv-b5f0/draft'));
  const shape = (x) => (x?.readout ? (blocksOf(x.readout)[2]?.checks ?? []).filter((r) => r.kind === 'shape').length : -1);
  const pass = { a: aBad === 0 && cardPlans > 0, b: shape(rt) === 3 && shape(rtb) === 0, c: cBad === 0, d: dBad === 0, e: threw === 0 };
  say(`plans read ${n} (skipped ${skipped}); with card list ${cardPlans}; without ${noCard}; threw ${threw}`);
  say(`(a) ${pass.a ? 'PASS' : 'FAIL'}: ${aBad} line-groups differ from the card of ${aRows} expected rows${aFirst.length ? `; first: ${aFirst.join(' || ')}` : ''}`);
  say(`(b) ${pass.b ? 'PASS' : 'FAIL'}: research-tracker line 2 shape rows before ${shape(rtb)}, after ${shape(rt)}`);
  say(`(c) ${pass.c ? 'PASS' : 'FAIL'}: ${cBad} drafts whose item-3 lines differ${cFirst.length ? ` (${cFirst.join(', ')})` : ''}`);
  say(`    differences by kind over drafts with a card list: ${JSON.stringify(diffKinds)}`);
  say(`(d) ${pass.d ? 'PASS' : 'FAIL'}: ${dBad} of ${noCard} no-card-list drafts differ${dFirst.length ? ` (${dFirst.join(', ')})` : ''}`);
  say(`(e) ${pass.e ? 'PASS' : 'FAIL'}: ${threw} threw`);
  bad = !Object.values(pass).every(Boolean);
  say(bad ? 'RESULT: FAIL' : 'RESULT: PASS');
} finally {
  try { sh('git', ['-C', REPO, 'worktree', 'remove', '--force', base]); } catch { /* leave it */ }
  fs.writeFileSync(path.join(REPO, '.claude', 'scratch', 'readout-model', 'RESULT.txt'), `${lines.join('\n')}\n`);
}
process.exit(bad ? 1 : 0);
