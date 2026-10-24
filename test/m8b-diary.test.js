// M8b piece 2: `diary.jsonl`, one append-only step diary for what were calls.jsonl, tools.jsonl and checks.jsonl; each row carries `kind` (call, tool or checks).
// Torn-line rule as before. The model is denied it as it was denied the three files. $0, in-process, mkdtemp.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync, readdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import {
  DIARY_FILE, diaryPaths, appendCall, appendTool, appendChecks, readCalls, readTools, readChecks, nextRound,
} from '../src/diary.js';

const dirs = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'fwdloop-m8b-diary-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const CALL = { step: 's', try: 1, round: 1, at: 't1', model: 'm', costUsd: 0.1, tokens: { in: 1, out: 2, cache: 0 }, ms: 5, stopReason: 'stop', thinking: { asked: 'off', status: null } };
const TOOL = { step: 's', try: 1, round: 1, at: 't2', tool: 'read', path: 'inputs/a.md', decision: 'allow', rule: null };
const CHECKS = { step: 's', try: 1, at: 't3', lastRound: 1, checks: [{ n: 1, text: 'x', ok: true, result: null, source: 'every step' }], output: null };

test('the three appenders write ONE file, in the order they were called, each row with its kind; the readers return their own kind only', () => {
  const dir = tmp();
  assert.equal(DIARY_FILE, 'diary.jsonl');
  appendCall(dir, CALL);
  appendTool(dir, TOOL);
  appendChecks(dir, CHECKS);
  appendCall(dir, { ...CALL, round: 2 });
  assert.deepEqual(readdirSync(dir), ['diary.jsonl'], 'one file, none of the three old names');
  const rows = readFileSync(path.join(dir, 'diary.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.kind), ['call', 'tool', 'checks', 'call'], 'append order kept');
  assert.deepEqual(readCalls(dir).map((r) => r.round), [1, 2]);
  assert.deepEqual(readTools(dir).map((r) => r.tool), ['read']);
  assert.deepEqual(readChecks(dir).map((r) => r.lastRound), [1]);
  assert.deepEqual(readCalls(dir)[0], { kind: 'call', ...CALL });
  assert.equal(nextRound(dir, 's'), 3, 'a tool or checks row never counts as a round');
});

test('the old three names are not read any more', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'calls.jsonl'), `${JSON.stringify({ step: 's', round: 7 })}\n`);
  writeFileSync(path.join(dir, 'tools.jsonl'), `${JSON.stringify(TOOL)}\n`);
  writeFileSync(path.join(dir, 'checks.jsonl'), `${JSON.stringify(CHECKS)}\n`);
  assert.deepEqual([readCalls(dir), readTools(dir), readChecks(dir)], [[], [], []]);
  assert.equal(nextRound(dir, 's'), 1);
});

test('torn-line rule: a torn last line is skipped on read, and the next row starts on its own line', () => {
  const dir = tmp();
  appendCall(dir, CALL);
  appendFileSync(path.join(dir, 'diary.jsonl'), '{"kind":"tool","step":"s","to');
  appendTool(dir, TOOL);
  assert.deepEqual(readCalls(dir).map((r) => r.round), [1]);
  assert.deepEqual(readTools(dir).map((r) => r.at), ['t2'], 'the new row was not glued to the torn bytes');
});

test('the model is denied the one file; secrets in a row are masked', () => {
  const dir = tmp();
  assert.deepEqual(diaryPaths(dir), [path.join(dir, 'diary.jsonl')]);
  appendTool(dir, { ...TOOL, path: 'no/sk-abcdefghijklmnopqrstuvwxyz012345.md' });
  assert.ok(!readFileSync(path.join(dir, 'diary.jsonl'), 'utf8').includes('abcdefghijklmnop'));
});
