import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { signDraft } from '../../src/authoring.js';
import { pageSign } from './page-sign.mjs';
import { makeScratch, cli, FAKE_DRAFT, draftArgs, lsTree, cleanup } from './common.mjs';

const s = makeScratch('a');
const rows = [];
const rec = (id, hypothesisFails, observed, pass) => { rows.push({ id, hypothesisFails, observed, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}\n      fails-if: ${hypothesisFails}\n      observed: ${observed}`); };
const flowsList = () => lsTree(s.flows).join(',') || '(empty)';
const draft = (n, name) => {
  const out = join(s.drafts, n);
  const r = cli(s, draftArgs(s, out, name), { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT });
  if (r.status !== 0) throw new Error(`draft failed: ${r.stderr}`);
  return { out, hash: readFileSync(join(out, 'spec.hash'), 'utf8').trim() };
};

try {
  // a0 (finding): an absolute send folder outside the install dir cannot sign at all
  {
    const d0 = draft('d0', 'flow-zero');
    const abs = join(s.base, 'abs-out');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(abs);
    const p0 = readFileSync(join(d0.out, 'prose.txt'), 'utf8').replace(`file:${s.outRel}`, `file:${abs}`);
    const s2 = { ...s, prose: join(s.inputs, 'prose-abs.txt') };
    writeFileSync(s2.prose, p0);
    const d00 = (() => { const out = join(s.drafts, 'd00'); const rr = cli(s, draftArgs(s2, out, 'flow-zero2'), { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT }); return { rr, out, hash: readFileSync(join(out, 'spec.hash'), 'utf8').trim() }; })();
    const rz = signDraft({ dir: d00.out, approve: d00.hash, signedBy: 'poc', env: {} });
    rec('a0 FINDING: absolute scratch send folder (outside install dir) cannot sign', 'ok:true (any absolute folder signs)', `draft ok (exit ${d00.rr.status}); sign ok=${rz.ok} reds=${JSON.stringify(rz.reds)}`, rz.ok === false);
  }
  // a1: edit declaration.json after the hash was read
  let d = draft('d1', 'flow-one');
  const before = flowsList();
  const decl = readFileSync(join(d.out, 'declaration.json'), 'utf8');
  writeFileSync(join(d.out, 'declaration.json'), decl.replace(/"goal": "/, '"goal": "EDITED '));
  let r = signDraft({ dir: d.out, approve: d.hash, signedBy: 'poc', env: {} });
  rec('a1 declaration.json edited after hash read -> signDraft refuses', 'signDraft ok:true, or flows root changed', `ok=${r.ok} reds=${JSON.stringify(r.reds)} flows before=[${before}] after=[${flowsList()}]`, r.ok === false && before === flowsList() && /does not match/.test(String(r.reds)));
  // sanity: the edit really changed bytes (else the test could not fail)
  rec('a1b control: the edit changed the file', 'file bytes equal to original', `differs=${decl !== readFileSync(join(d.out, 'declaration.json'), 'utf8')}`, decl !== readFileSync(join(d.out, 'declaration.json'), 'utf8'));

  // a1c: prose.txt edit
  d = draft('d2', 'flow-two');
  writeFileSync(join(d.out, 'prose.txt'), `${readFileSync(join(d.out, 'prose.txt'), 'utf8')}\n`);
  r = signDraft({ dir: d.out, approve: d.hash, signedBy: 'poc', env: {} });
  rec('a1c prose.txt edited (trailing newline) -> refused', 'ok:true', `ok=${r.ok} reds=${JSON.stringify(r.reds)} flows=[${flowsList()}]`, r.ok === false && flowsList() === '(empty)');

  // a1d: spec.hash file replaced by the attacker with a hash for tampered content? (approve = stale hash + rewritten spec.hash)
  d = draft('d3', 'flow-three');
  const decl3 = readFileSync(join(d.out, 'declaration.json'), 'utf8');
  writeFileSync(join(d.out, 'declaration.json'), decl3.replace(/"goal": "/, '"goal": "EDITED '));
  const stale = d.hash;
  r = signDraft({ dir: d.out, approve: stale, signedBy: 'poc', env: {} });
  rec('a1d stale hash (the one the page showed) vs tampered files', 'ok:true', `ok=${r.ok}`, r.ok === false);

  // a2: unmodified + right hash -> signs
  d = draft('d4', 'flow-four');
  r = signDraft({ dir: d.out, approve: d.hash, signedBy: 'poc', env: {} });
  rec('a2 unmodified + right hash signs', 'ok:false (the gate refuses a clean draft)', `ok=${r.ok} flowDir=${r.flowDir ? r.flowDir.replace(s.base, '<scratch>') : null} flows=[${flowsList()}]`, r.ok === true && /flow-four/.test(flowsList()));

  // pageSign
  d = draft('d5', 'flow-five');
  const l0 = flowsList();
  for (const [label, typed] of [['missing name (undefined)', undefined], ['empty name', ''], ['wrong name', 'flow-fiv'], ['wrong case', 'Flow-Five'], ['trailing space', 'flow-five ']]) {
    r = pageSign({ dir: d.out, approve: d.hash, typedName: typed });
    rec(`pageSign ${label} -> refused, nothing written`, 'ok:true or flows root changed', `ok=${r.ok} reds=${JSON.stringify(r.reds)} flows=[${flowsList()}]`, r.ok === false && flowsList() === l0);
  }
  // right name but stale hash
  r = pageSign({ dir: d.out, approve: 'f'.repeat(64), typedName: 'flow-five' });
  rec('pageSign right name + wrong hash -> refused (inner gate holds)', 'ok:true', `ok=${r.ok} reds=${JSON.stringify(r.reds)} flows=[${flowsList()}]`, r.ok === false && flowsList() === l0);
  r = pageSign({ dir: d.out, approve: d.hash, typedName: 'flow-five' });
  rec('pageSign right name + right hash -> signs', 'ok:false', `ok=${r.ok} signedBy=${r.signature?.signedBy} flows=[${flowsList()}]`, r.ok === true && /flow-five/.test(flowsList()));
  // double sign: second call same flow name
  const sigBefore = readFileSync(join(s.flows, 'flow-five', 'signature.json'), 'utf8');
  r = pageSign({ dir: d.out, approve: d.hash, typedName: 'flow-five' });
  rec('pageSign again on an already signed flow -> refused, signed flow untouched', 'ok:true or signature bytes changed', `ok=${r.ok} reds=${JSON.stringify(r.reds)} sigUnchanged=${sigBefore === readFileSync(join(s.flows, 'flow-five', 'signature.json'), 'utf8')}`, r.ok === false && sigBefore === readFileSync(join(s.flows, 'flow-five', 'signature.json'), 'utf8'));
} finally { cleanup(s); }
const bad = rows.filter((x) => !x.pass).length;
console.log(`\n(a) ${rows.length - bad}/${rows.length} pass`);
process.exitCode = bad ? 1 : 0;
