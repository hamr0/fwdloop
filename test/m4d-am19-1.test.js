// M4d amendment 19, item 1: a draft reserves what is left of the cap against the monthly limit (docs/wiki/the-module-ladder.md). $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { world, killChildrenAfter, until } from './m4e-world.mjs';
import {
  tmp, spendRow, newHome, cli, proseAt, finish,
} from './m4d-am19-helpers.mjs';
import { job2Fixture } from './drafter-fixture.mjs';

killChildrenAfter();
import { draftHoldUsd } from '../src/draftspend.js';
import { readRuns } from '../src/monthly.js';

test('1: draftHoldUsd is the cap minus what the job\'s drafting already spent (the whole cap for a plain draft)', () => {
  const s = tmp('s');
  mkdirSync(path.join(s, 'draft'), { recursive: true });
  writeFileSync(path.join(s, 'card.json'), '{}');
  writeFileSync(path.join(s, 'draft', 'spend.jsonl'), spendRow(0.1));
  const prose = job2Fixture().prose; // cap $0.25
  assert.equal(draftHoldUsd(prose, path.join(s, 'draft-1'), 0.0288), 0.15);
  assert.equal(draftHoldUsd(prose, path.join(tmp('plain'), 'd'), 0.0288), 0.25);
  assert.equal(draftHoldUsd('not a signed text', path.join(tmp('x'), 'd'), 0.0288), 0.0288, 'an unparseable prose falls back to one round (the draft itself refuses it at $0)');
});

test('1: `fwdloop draft` holds the pot left against the month: a limit that fits one round but not the cap refuses at $0 saying what it needs; with room it books that hold', () => {
  const work = tmp('draft');
  const prose = proseAt(work);
  const tight = newHome(0.1); // one round is $0.0288, the cap is $0.25
  const r = cli(['draft', prose, '--out', path.join(work, 'd'), '--root', path.join(work, 'flows'), '--name', 'x'], tight);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Max \$0\.10 left this month \(monthly limit \$0\.10\); this needs \$0\.25\./);
  const roomy = newHome(5);
  const ok = cli(['draft', prose, '--out', path.join(work, 'd2'), '--root', path.join(work, 'flows'), '--name', 'x'], roomy);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(readRuns(roomy).find((x) => x.kind === 'hold').holdUsd, 0.25);
});

