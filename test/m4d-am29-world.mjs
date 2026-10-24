// M4d am29 test world (outside the test runner's glob on purpose: a .mjs helper): job2 run end to end with the REAL model step, a fake provider and the
// real step tools, so every diary row and every check record is what the product writes. $0.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow } from '../src/runner.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { resolvePrimitives } from '../src/primitives.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
export const CAT = (() => { const c = loadCatalogue(); if (!c.ok) throw new Error('catalogue'); return c.primitives; })();

const SECTIONS = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft.';
const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 7 };
const turn = (toolCalls, stopReason = 'tool_calls') => ({
  text: '', toolCalls, usage, stopReason, model: 'deepseek-flash', thinkingStatus: 'applied',
});

/** A model that, per step goal, reads a file, tries something it may not (the summary step), emits its artifact, then stops. The summary's first try is far too long. */
function fakeProvider(redoFails = false) {
  let summaries = 0;
  return {
    generate: async (messages) => {
      const goal = JSON.parse(messages[1].content).goal;
      const n = messages.filter((m) => m.role === 'tool').length;
      const emit = (a) => turn([{ id: `e${n}`, name: 'emit_artifact', arguments: { ...a, done: true } }]);
      if (goal.includes('Draft the summary')) {
        if (n === 0) return turn([{ id: 'r1', name: 'read', arguments: { path: 'inputs/jd.md' } }, { id: 'r2', name: 'read', arguments: { path: 'diary.jsonl' } }]);
        if (n === 2) { summaries += 1; return emit({ text: summaries === 1 || (redoFails && summaries >= 3) ? `## summary of work history blurb\n${'word '.repeat(700)}` : SECTIONS }); }
        return turn([], 'stop');
      }
      if (goal.includes('job description markdown')) {
        if (n === 0) return turn([{ id: 'r1', name: 'read', arguments: { path: 'inputs/jd.md' } }]);
        if (n === 1) return emit({ text: 'jd' });
        return turn([], 'stop');
      }
      return n === 0 ? emit({ text: 'x' }) : turn([], 'stop');
    },
  };
}

/**
 * @param {{redo?: boolean, redoFails?: boolean}} [o] `redo`: the human asks for one redo (with a reason) before accepting. `redoFails`: every try of the redone step is too long (am30: the Redo's limit).
 * @returns {Promise<{root: string, home: string, runDir: string, result: any}>}
 */
export async function buildWorld({ redo = false, redoFails = false } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-am29w-'));
  const root = path.join(base, 'flows');
  const src = path.join(base, 'src');
  const home = path.join(base, 'cfg', 'fwdloop');
  for (const d of [root, src, home]) mkdirSync(d, { recursive: true });
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CAT,
  });
  if (!w.ok) throw new Error(w.reds.join('; '));
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const runDir = path.join(root, 'job2', 'runs', 'run-1');
  const inputs = [{ id: 'resume', frozen: path.join(runDir, 'inputs', 'resume.docx') }, { id: 'jd', frozen: path.join(runDir, 'inputs', 'jd.md') }];
  const { tools } = resolvePrimitives(CAT, ['read', 'write', 'readDocx'], { runDir, inputs });
  const modelStep = makeLiveModelStep({ spendPath: path.join(runDir, 'spend.jsonl'), provider: fakeProvider(redoFails), rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
  let asked = 0;
  const askStep = async () => { asked += 1; return redo && asked === 1 ? { decision: 'redo', reason: 'make it shorter' } : { decision: 'accept' }; };
  const result = await runFlow({
    root, name: 'job2', runId: 'run-1', sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }], catalogue: CAT, modelStep, askStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: tools, businessDate: '2026-06-01',
  });
  return {
    root, home, runDir, result,
  };
}
