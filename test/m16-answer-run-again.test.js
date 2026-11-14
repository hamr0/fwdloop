// Live bug 2026-11-14: the LAST answer of a run-again draft (a red run re-drafted as a run of the SAME workflow, run-of.json beside the card) was refused with the flowName
// "already a flow named" refusal, because the answer door's card check did not get the run-of name the draft and revise doors pass. $0: the redraft child is a stub script, no provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createAuthor } from '../src/panel/author.js';
import { tickedConfig } from './m4e-world.mjs';

const ID = 'd-0000000001-abcd';
function askingDraft({ runOf }) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16ra-'));
  mkdirSync(path.join(root, 'job2'), { recursive: true }); // the signed flow whose name is taken
  const dir = path.join(root, '.drafts', ID);
  mkdirSync(path.join(dir, 'draft'), { recursive: true });
  const home = path.join(root, 'cfg');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(home, 'config.json'), JSON.stringify(tickedConfig()));
  const out = path.join(root, 'out');
  mkdirSync(out);
  writeFileSync(path.join(dir, 'card.json'), JSON.stringify({ flowName: 'job2', job: 'Read my resume', capUsd: '0.25', askWait: '1h', destination: out, provider: 'DEEPSEEK_API_KEY', model: 'fake-ticked' }));
  if (runOf) writeFileSync(path.join(dir, 'run-of.json'), JSON.stringify({ flow: 'job2', fromRun: 'run-1' }));
  writeFileSync(path.join(dir, 'draft', 'log.json'), JSON.stringify({ ok: false, reds: [] }));
  writeFileSync(path.join(dir, 'draft', 'questions.json'), JSON.stringify({ questions: [{ line: 1, question: 'Which resume?' }] }));
  const stub = path.join(root, 'stub-bin.mjs');
  writeFileSync(stub, '// stub redraft child: does nothing, calls no provider\n');
  return { root, stub, home };
}
const authorOf = ({ root, stub, home }) => createAuthor({ root, home, bin: stub, skipMonthly: true, loadEnv: () => ({ ok: true, env: { DEEPSEEK_API_KEY: 'sk-test-not-a-real-key-0000' }, refusal: null, keyNames: ['DEEPSEEK_API_KEY'] }), childRunning: () => false });
const flowNameRefusal = (r) => JSON.stringify(r.body).includes('already a flow named');

test('the last answer of a run-again draft is not refused as a taken flow name (break: drop the run-of argument at the answer door)', () => {
  const r = authorOf(askingDraft({ runOf: true })).answer(ID, { k: 1, answer: 'the Rust one', choice: 'rule' });
  assert.equal(flowNameRefusal(r), false, JSON.stringify(r.body));
  assert.equal(r.status, 202, JSON.stringify(r.body));
});

test('a draft that is NOT a run-again with a taken name is still refused at the last answer', () => {
  const r = authorOf(askingDraft({ runOf: false })).answer(ID, { k: 1, answer: 'the Rust one', choice: 'rule' });
  assert.equal(flowNameRefusal(r), true, JSON.stringify(r.body));
  assert.notEqual(r.status, 202);
});
