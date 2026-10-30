// M12 piece 3 (hamr 2026-10-30): a SKIPPED run is a normal grey ending, never a refused start. The panel read a dead child with no pid row as "refused" and the empty Chat
// card showed "skipped / Nothing spent." for a trigger start it never made. Root cause: `readStart` (src/panel/authorstart.js) knew only "started" (pid row) or "refused";
// a skipped run ends before its first pid row. $0, no network: start folders and run folders are laid down by hand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createStarter } from '../src/panel/authorstart.js';
import { updateConfig } from '../src/config.js';
import { writeModelRecord } from '../src/flowmodel.js';
import { skippedWorld } from './m12-p3-world.mjs';

const BIN = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'fwdloop');
const ID = 's-0000000001-abcd';

/** a start folder whose child is dead; `ended`: the history row the run wrote (or none) */
function rootWith(t, { kind, log, ended }) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p3-start-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const d = path.join(root, '.starts', ID);
  mkdirSync(d, { recursive: true });
  mkdirSync(path.join(root, 'tk', 'runs', 'run-7'), { recursive: true });
  writeFileSync(path.join(d, 'start.json'), JSON.stringify({ kind, flow: 'tk', runId: 'run-7', sources: [], startedAt: 'x' }));
  writeFileSync(path.join(d, 'pid.json'), JSON.stringify({ pid: 999999, procStart: '1', startedAt: 1 }));
  writeFileSync(path.join(d, 'child.log'), log);
  if (ended) writeFileSync(path.join(root, 'tk', 'history.jsonl'), `${JSON.stringify({ runId: 'run-7', at: 'x', outcome: ended, spentUsd: 0, spendComplete: true, capUsd: 1, wallMs: 1, signatureHash: 'a'.repeat(64) })}\n`);
  return root;
}

test('a skipped trigger run leaves no refusal: its start reads as started/ended, and the Chat card\'s open-start lookup is null', (t) => {
  const s = createStarter({ root: rootWith(t, { kind: 'trigger', log: 'fwdloop: skipped\n', ended: 'skipped' }) });
  const g = s.get(ID, []).body;
  assert.notEqual(g.phase, 'refused', JSON.stringify(g));
  assert.equal(g.phase, 'started');
  assert.equal(s.newestOpen([]), null);
});

test('a skipped run started from the Chat card (kind run) is not a refusal either', (t) => {
  const s = createStarter({ root: rootWith(t, { kind: 'run', log: 'fwdloop: skipped\n', ended: 'skipped' }) });
  assert.equal(s.get(ID, []).body.phase, 'started');
  assert.equal(s.newestOpen([]), null);
});

test('a trigger start never writes into the Chat card at all: even a dead child with no run record is not offered to it', (t) => {
  const s = createStarter({ root: rootWith(t, { kind: 'trigger', log: 'fwdloop: some refusal\n' }) });
  assert.equal(s.newestOpen([]), null);
});

test('a real refused start still shows its red sentence', (t) => {
  const s = createStarter({ root: rootWith(t, { kind: 'run', log: 'fwdloop: run: the input is unreadable\n' }) });
  const v = s.newestOpen([]);
  assert.equal(v.phase, 'refused');
  assert.equal(v.say, 'run: the input is unreadable\nNothing spent.');
});

test('a run that ended red without a pid row (an unreadable input) is still a refusal, not "skipped"', (t) => {
  const s = createStarter({ root: rootWith(t, { kind: 'run', log: 'fwdloop: preflight-red — freeze: input "a" is unreadable\n', ended: 'preflight-red' }) });
  assert.equal(s.newestOpen([]).phase, 'refused');
});

test('the CLI exits 0 on a skipped run, like a complete one (a skip is not a failure)', async (t) => {
  const w = await skippedWorld(t);
  writeModelRecord(path.join(w.root, 'tick'), { slot: 'DEEPSEEK_API_KEY', model: 'fake-ticked' });
  updateConfig({ models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: true, inPerM: 0.75, outPerM: 1.625 }] } }, { home: path.join(w.home, 'cfg') });
  const r = spawnSync(process.execPath, [BIN, 'run', 'tick', '--root', w.root, '--source', 'issues=https://github.com/flutter/flutter/issues', '--ticket', '102', '--run-id', 'run-9'], {
    encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: w.home, NODE_ENV: 'test', DEEPSEEK_API_KEY: 'sk-fake', FWDLOOP_CONFIG_HOME: path.join(w.home, 'cfg') },
  });
  // the world's fake server answers the last ticket it wrote (closed #103): skipped
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /skipped/, out);
  assert.equal(r.status, 0, out);
});
