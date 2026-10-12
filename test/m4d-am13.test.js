// M4d amendment 13 (docs/wiki/the-module-ladder.md): one cap. The card's Cap $ (the cap signed in the prose) also caps drafting; the separate
// $0.10 draft limit and the CLI --budget flag are gone. $0, fake providers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft } from '../src/drafter.js';
import * as authoring from '../src/authoring.js';
import { ceilingCostUsd } from '../src/provider.js';
import {
  MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIG = { in: 0.003, out: 0.008 }; // 32 * 0.003 + 16 * 0.008 = $0.224 for one worst-case round
const withCap = (prose, cap) => {
  assert.match(prose, /guardrail: cap \$0\.25 per run/);
  return prose.replace('guardrail: cap $0.25 per run', `guardrail: cap $${cap} per run`);
};
const go = (cap, extra = {}) => {
  const fx = job2Fixture();
  const p = fakeProvider([toolReply(validArgs())]);
  return draft({ proseText: withCap(fx.prose, cap), provider: p, rates: BIG, modelId: MODEL, ...extra }).then((r) => ({ r, p }));
};

test('the worst case of the test rates is $0.224', () => {
  assert.ok(Math.abs(ceilingCostUsd(BIG) - 0.224) < 1e-9);
});

test('Cap $0.50 on a model whose worst round is $0.224 is not refused (it used to be, by the separate $0.10 limit)', async () => {
  const { r, p } = await go('0.50');
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(p.calls.length, 1);
});

test('Cap $0.10 is refused at $0, before any call, in the signed words', async () => {
  const { r, p } = await go('0.10');
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'pre-flight');
  assert.equal(p.calls.length, 0);
  assert.equal(r.reds[0], `Cap $0.10 is below one drafting round's worst case for ${MODEL}, $0.2240. Raise Cap $ or pick another model.`);
});

test('a draft takes its budget from the signed cap only: there is no budgetUsd option and no default limit', async () => {
  // an old caller's budgetUsd is ignored: the cap decides (Cap $0.50 passes even if a caller still sends 0.10)
  const { r } = await go('0.50', { budgetUsd: 0.10 });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(authoring.DRAFT_BUDGET_USD, undefined);
});

test('a prose with no signed cap is refused at $0 by the signed-text check, never defaulted', async () => {
  const fx = job2Fixture();
  const p = fakeProvider([toolReply(validArgs())]);
  const r = await draft({ proseText: fx.prose.replace(/^guardrail: cap .*\n/m, ''), provider: p, rates: BIG, modelId: MODEL });
  assert.equal(r.ok, false);
  assert.equal(p.calls.length, 0);
  assert.match(r.reds.join(' '), /capUsd/);
});

test('the CLI has no --budget flag', () => {
  const src = readFileSync(path.join(HERE, '..', 'bin', 'fwdloop'), 'utf8');
  assert.doesNotMatch(src, /budget/i);
  assert.ok(existsSync(path.join(HERE, '..', 'bin', 'fwdloop')));
  const r = spawnSync(process.execPath, [path.join(HERE, '..', 'bin', 'fwdloop'), 'draft', 'x.txt', '--out', '/nonexistent/o', '--root', '/nonexistent/r', '--name', 'n', '--budget', '5'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /budget/);
});
