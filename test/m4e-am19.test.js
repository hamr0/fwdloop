// M4e amendment 19 (SIGNED 2026-10-09): 1 (old roll-ups of "process gone" runs), 2 ("N more" counts blocks), 3 (one stopped-ask
// label reader), 4 (every softgreen check built before the first model call). $0: no provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendFileSync, mkdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as monthly from '../src/monthly.js';

// ---- 1 ----
const NOW = Date.parse('2026-10-08T12:00:00Z');
const iso = (d) => new Date(NOW - d * 86400000).toISOString();
test('1 an OLD rolled row for a "process gone" run is ignored: month and total equal the disk', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-am19-1-'));
  try {
    const home = path.join(base, 'cfg');
    mkdirSync(home, { mode: 0o700 });
    const d = path.join(base, 'runs', 'gone');
    mkdirSync(d, { recursive: true });
    const spend = (usd) => `${JSON.stringify({ kind: 'step', provider: 'deepseek', costUsd: usd, spendComplete: true, at: iso(1) })}\n`;
    writeFileSync(path.join(d, 'spend.jsonl'), spend(0.01));
    const L = [
      { kind: 'hold', holdId: 'g', what: 'run', flow: 'j', runId: 'gone', runDir: d, pid: 1, procStart: null, holdUsd: 0.25, spentAtHold: 0, at: iso(1) },
      { kind: 'settled', holdId: 'g', at: iso(1), why: 'process gone' },
      // written by a build before amendment 17 3A: it stands in for the dir
      { kind: 'rolled', at: iso(1), seen: 2, dirs: { [d]: [{ u: 0.01, c: true, t: 0, w: null, p: 'deepseek', a: iso(1) }] } },
    ];
    writeFileSync(path.join(home, 'runs.jsonl'), `${L.map((l) => JSON.stringify(l)).join('\n')}\n`);
    appendFileSync(path.join(d, 'spend.jsonl'), spend(0.5));
    const s = monthly.spendSummary({ home, now: () => NOW });
    assert.ok(Math.abs(s.month.usd - 0.51) < 1e-9, `month ${s.month.usd}`);
    assert.ok(Math.abs(s.total.usd - 0.51) < 1e-9, `total ${s.total.usd}`);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
