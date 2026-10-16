// M6 am9 test helpers: a signed job2 (plan A) in a flows root, and a second signed plan (plan B, a different cap so a different signature)
// that a run keeps as ITS plan (`runs/<id>/job/` + `plan.json`).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CAT = loadCatalogue().primitives;
export const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
export const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');

/** A flows root holding a signed `job2` (plan A, cap $0.25) with its input files and send folder. */
export function planWorld(tag = 'x') {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-am9-${tag}-`));
  const w = { base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src') };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  w.prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  w.decl = JSON.parse(fixture('job2.m1.declaration.json'));
  w.sign = (root, name, over = {}) => {
    const r = writeFlow({
      root, name, proseText: over.prose ?? w.prose, declaration: w.decl, signedBy: 'hamr', signedAt: over.at ?? '2026-10-10T10:00:00Z', catalogue: CAT, ...(over.replaces ? { replaces: over.replaces } : {}),
    });
    assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
    return r;
  };
  w.flowDir = path.join(w.root, 'job2');
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  return w;
}

/** Plan B = the same job signed with another cap, made in a scratch root; its three files are put in `<runDir>/job/` and `plan.json` marks the run as running them. */
export function givePlanB(w, runId = 'run-1', cap = '0.30') {
  const scratch = path.join(w.base, 'scratch');
  mkdirSync(scratch, { recursive: true });
  const b = w.sign(scratch, 'job2', { prose: w.prose.replace('cap $0.25', `cap $${cap}`), at: '2026-10-11T10:00:00Z' });
  const runDir = path.join(w.flowDir, 'runs', runId);
  mkdirSync(path.join(runDir, 'job'), { recursive: true });
  for (const f of ['prose.txt', 'declaration.json', 'signature.json']) writeFileSync(path.join(runDir, 'job', f), readFileSync(path.join(b.dir, f), 'utf8'));
  writeFileSync(path.join(runDir, 'plan.json'), `${JSON.stringify({ own: true })}\n`);
  return { runDir, flow: b.signature.flow };
}
