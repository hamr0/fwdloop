import { readFileSync, readdirSync, lstatSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { signDraft } from '../../src/authoring.js';
import { makeScratch, keysFile, cli, FAKE_DRAFT, FAKE_STEP, draftArgs, cleanup, CANARY, sleep } from './common.mjs';
import { startPanel, waitFor } from './claim-b-lib.mjs';

const results = [];
const rec = (id, failsIf, observed, pass) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}\n      fails-if: ${failsIf}\n      observed: ${observed}`); };

function grepTree(base, needle = CANARY) {
  const hits = {};
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const f = join(p, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) { const n = readFileSync(f, 'utf8').split(needle).length - 1; if (n > 0) hits[relative(base, f)] = n; }
    }
  };
  walk(base);
  return hits;
}
const fmt = (h) => Object.keys(h).length ? Object.entries(h).map(([k, v]) => `${k}=${v}`).join(', ') : '(no file)';
const keysOnlyIn = (s, h) => Object.keys(h).every((k) => k === 'cfg/.env');

/** One full panel-driven pass: draft -> sign -> run (to its park), all via mini-panel children. */
async function pass(tag, { draftMode, stepMode, merge }) {
  const s = makeScratch(`c${tag}`);
  keysFile(s);
  const d = join(s.drafts, 'd1');
  const env1 = { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT, POC_DRAFT_MODE: draftMode };
  const p1 = await startPanel(s, { args: draftArgs(s, d), logPath: `${d}.log`, pidFile: join(s.logs, 'd.pid'), merge }, env1);
  await waitFor(() => existsSync(join(d, 'log.json')) || (existsSync(d) && readdirSync(d).includes('spec.hash')), 20_000);
  await sleep(800);
  p1.panel.kill('SIGKILL');
  let signed = null;
  if (existsSync(join(d, 'spec.hash'))) {
    signed = signDraft({ dir: d, approve: readFileSync(join(d, 'spec.hash'), 'utf8').trim(), signedBy: 'poc', env: { DEEPSEEK_API_KEY: CANARY } });
  }
  let runLog = null;
  if (signed?.ok) {
    const p2 = await startPanel(s, { args: ['run', 'poc-flow', '--root', s.flows, '--source', `resume=${s.inputs}/resume.md`, '--source', `jd=${s.inputs}/jd.md`, '--run-id', 'r1'], logPath: join(s.logs, 'run.log'), pidFile: join(s.logs, 'r.pid'), merge }, { FWDLOOP_TEST_MODEL_STEP: FAKE_STEP, POC_STEP_MODE: stepMode });
    await waitFor(() => existsSync(join(s.flows, 'poc-flow', 'runs', 'r1', 'ask.json')) , 20_000);
    await sleep(1500);
    p2.panel.kill('SIGKILL');
    runLog = readFileSync(join(s.logs, 'run.log'), 'utf8');
  }
  const hits = grepTree(s.base);
  const info = { hits, signed: signed?.ok ?? null, draftLog: existsSync(`${d}.log`) ? readFileSync(`${d}.log`, 'utf8') : null, runLog, draftFiles: existsSync(d) ? readdirSync(d) : [], base: s.base, s };
  return info;
}

const cleanups = [];
try {
  // C1: honest fakes, merged env: canary only in the keys file
  const c1 = await pass('1', { draftMode: 'ok', stepMode: 'ok', merge: true }); cleanups.push(c1.s);
  rec('c1 fakes that never echo, merged env, draft+sign+run to park: canary only in cfg/.env', 'canary found in any file other than the keys file', `signed=${c1.signed} hits: ${fmt(c1.hits)}`, c1.signed === true && keysOnlyIn(c1.s, c1.hits) && c1.hits['cfg/.env'] === 1);

  // C2: echoing fakes, merged env: raw child log captures it (M4d (a)); what else?
  const c2 = await pass('2', { draftMode: 'echo', stepMode: 'echo', merge: true }); cleanups.push(c2.s);
  const h2 = c2.hits;
  const logs = Object.keys(h2).filter((k) => k.startsWith('drafts/d1.log') || k === 'logs/run.log');
  const nonLog = Object.keys(h2).filter((k) => k !== 'cfg/.env' && !logs.includes(k));
  rec('c2a child that ECHOES the key to stdout/stderr: raw child log holds it (expected, same as M4d (a))', 'no canary in either child log (then the log is safe)', `signed=${c2.signed} hits: ${fmt(h2)}`, logs.length === 2);
  rec('c2b ...and nothing ELSE (draft dir, audit, books, runs.jsonl, state, spend) holds it', 'canary in any file besides cfg/.env and the two child logs', `unexpected files: ${nonLog.length ? nonLog.join(', ') : '(none)'}`, nonLog.length === 0);
  const modes = [join(c2.s.drafts + '.log'), ''].filter(() => false);
  console.log(`      note: raw log counts draft=${h2['drafts/d1.log'] ?? 0} run=${h2['logs/run.log'] ?? 0} (stdout+stderr echo = 2 each)`);

  // C3: unmerged panel env, echoing fakes: does the child even see the key?
  const c3 = await pass('3', { draftMode: 'echo', stepMode: 'echo', merge: false }); cleanups.push(c3.s);
  rec('c3 panel does NOT merge the keys file: child env lacks the key, so an echoing child prints "undefined" (the wiring rule: merged env is what leaks or protects)',
    'canary in a child log', `signed=${c3.signed} hits: ${fmt(c3.hits)}; draft log: ${JSON.stringify((c3.draftLog ?? '').split('\n')[0])}`, !Object.keys(c3.hits).some((k) => /\.log$/.test(k)) && /key=undefined/.test(c3.draftLog ?? ''));

  // C4: a draft model that QUOTES the key into its declaration
  const c4 = await pass('4', { draftMode: 'quote', stepMode: 'ok', merge: true }); cleanups.push(c4.s);
  rec('c4a draft model puts the key in a step GOAL: the drafter overwrites goals with the signed line, so it is dropped (signs; no canary beside the keys file)', 'canary in any file besides cfg/.env', `signed=${c4.signed} hits: ${fmt(c4.hits)}`, keysOnlyIn(c4.s, c4.hits));
  const c4b = await pass('4b', { draftMode: 'quote-emits', stepMode: 'ok', merge: true }); cleanups.push(c4b.s);
  rec('c4b draft model puts the key in `emits` (not machine-set): red draft; the draft dir and the child log hold no canary', 'canary in the draft dir, its rejected/log files, or the child log', `signed=${c4b.signed} hits: ${fmt(c4b.hits)}; draft files=[${c4b.draftFiles}]; draft log=${JSON.stringify((c4b.draftLog ?? '').trim().slice(0, 200))}`, keysOnlyIn(c4b.s, c4b.hits));
  // run quote needs a signable draft: C5 uses ok draft + quoting step
  const c5 = await pass('5', { draftMode: 'ok', stepMode: 'quote', merge: true }); cleanups.push(c5.s);
  rec('c5 a run step that QUOTES the key into its artifact: no canary in any book/artifact/ask/state', 'canary in run dir, flows root, runs.jsonl', `signed=${c5.signed} hits: ${fmt(c5.hits)}`, !Object.keys(c5.hits).some((k) => k.startsWith('flows/') || k === 'cfg/runs.jsonl'));
} finally { for (const s of cleanups) cleanup(s); }
const bad = results.filter((x) => !x).length;
console.log(`\n(c) ${results.length - bad}/${results.length} pass`);
process.exitCode = bad ? 1 : 0;
