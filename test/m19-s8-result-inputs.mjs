// M19 S8: hand-made inputs for `buildResult` (src/panel/result.js): a run folder with artifacts, a log.json, and the declaration's steps. No panel, no model.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { putCited } from './line-checks-fixture.mjs';

/** @param {Record<string, any>} artifacts @param {any} [log] */
export function runFolder(artifacts, log = null) {
  const root = mkdtempSync(join(tmpdir(), 'fwdloop-m19s8-'));
  const runDir = join(root, 'job', 'runs', 'run-1');
  mkdirSync(join(runDir, 'artifacts'), { recursive: true });
  for (const [id, v] of Object.entries(artifacts)) writeFileSync(join(runDir, 'artifacts', `${id}.json`), JSON.stringify(v));
  if (log) writeFileSync(join(runDir, 'log.json'), JSON.stringify(log));
  return { root, runDir };
}

export const HISTORY = { outcome: 'complete' };
export const ARBITER = { asks: [], sends: [], sources: [{ role: 'notes', kind: 'file', path: '/x/notes.md' }] };

/** a text line (1), a facts line (2, its cited record put by the caller) and a plain line (3), none a shape line */
export function nonShapeInputs() {
  const { root, runDir } = runFolder({ t1: { text: 'a short note', done: true, blocker: null }, f2: { results: [{ quote: 'it costs 9', values: { price: '9' } }], done: true, blocker: null }, t3: { text: 'last words' } });
  putCited(runDir, { lines: [{ n: 2, source: 'page', passed: true, facts: [{ name: 'price', kind: 'value', sentence: 'the price is a number' }], rows: [{ n: 1, quote: 'it costs 9', cells: ['9'] }], notChecked: ['whether it is right'] }] });
  const lines = [{ n: 1, text: 'Write a note' }, { n: 2, text: 'Quote the price', guardrail: 'under 10' }, { n: 3, text: 'Say goodbye', guardrail: 'short; kind' }];
  const declaration = { steps: [
    { fromLine: 1, goal: 'Write a note', emits: 't1', close: { class: 'hitl' } },
    { fromLine: 2, goal: 'Quote the price', emits: 'f2', close: { class: 'green', cited: { source: 'page', facts: [{ name: 'price', shape: 'number' }] } } },
    { fromLine: 3, goal: 'Say goodbye', emits: 't3', close: { class: 'softgreen', shape: { wordsPerSection: 5 } } },
  ] };
  return { flow: 'job', runId: 'run-1', runDir, root, flowRead: { declaration, lines }, arbiter: ARBITER, historyRow: HISTORY, auditRows: [], logJson: null, notChecked: ['one rule'], readNotes: [], setupRows: [], door: null };
}
