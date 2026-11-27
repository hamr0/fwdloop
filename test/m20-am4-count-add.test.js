// M20 am4 (docs/wiki/the-module-ladder.md): a suggested count the person Adds is theirs. The fixture is hamr's draft d-00mwxqfzaw-3c6d (draft-2, 2026-11-26): the card offered
// `[agent] fact · results — 1 to 4 results` on line 4 and Add was refused ("the result count has the number 1, but 1 is not in your words on line 4").
// A count the drafter wrote on its own (not Added) is still refused. The fixture's paths are rewritten into a temp dir, so nothing depends on this machine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { rowEditPlan } from '../src/planrebuild.js';
import { countReds } from '../src/citedwords.js';
import { addedCountsOf } from '../src/pickrecord.js';
import { parseSignedText } from '../src/signed-text.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm20-am4-count-add');

/** a copy of the fixture in a temp dir, `@@DIR@@` pointing at it; returns the plan folder */
function plan() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am4-'));
  cpSync(FIX, dir, { recursive: true });
  // the saved JSON files carry a `.fixture` suffix so the repo's fixture scans (which read every *.json under test/fixtures) leave them alone
  for (const n of readdirSync(path.join(dir, 'plan')).filter((x) => x.endsWith('.fixture'))) renameSync(path.join(dir, 'plan', n), path.join(dir, 'plan', n.slice(0, -'.fixture'.length)));
  for (const n of ['prose.txt', 'readout.txt', 'target.json']) {
    const f = path.join(dir, 'plan', n);
    writeFileSync(f, readFileSync(f, 'utf8').replaceAll('@@DIR@@', dir));
  }
  return { dir, planDir: path.join(dir, 'plan') };
}

test('am4: Add of the suggested `[agent]` count (1 to 4 results) is taken: the new plan holds the count under CHECKED (red on the old count check)', () => {
  const { dir, planDir } = plan();
  try {
    const made = rowEditPlan({ planDir, op: 'add', key: 'L4.count.1-4', asks: true });
    assert.equal(made.ok, true, made.ok ? '' : made.say);
    const card = JSON.parse(made.files['log.json']).checkCard;
    const row = card.rows.find((r) => r.key === 'L4.count.1-4');
    assert.ok(row, 'the count is a row of the new plan\'s card');
    assert.ok(!card.suggested.some((r) => r.key === 'L4.count.1-4'), 'it is no longer under SUGGESTED');
    // the new plan's record carries the Add, so the sign-time check (which reads the record) reads the count as said
    const lines = parseSignedText(readFileSync(path.join(planDir, 'prose.txt'), 'utf8')).lines;
    const added = addedCountsOf(JSON.parse(made.files['picks-record.json']).rowChoices, lines);
    assert.ok(added.has('4:min:1') && added.has('4:max:4'), [...added].join());
    assert.equal(JSON.parse(made.files['declaration.json']).steps.some((s) => s.close?.facts?.some?.((p) => p.count) || JSON.stringify(s.close ?? {}).includes('"count"')), true, 'the count is in the signed checks');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('am4: a count the drafter wrote on its own, not Added, is still refused when its number is not in the line\'s words', () => {
  const reds = countReds({ part: { count: { min: 1, max: 4 } }, jobLine: { n: 4, text: 'Read the notes and sum them up in a short summary' } });
  assert.equal(reds.length, 2);
  assert.match(reds[0].detail, /the result count has the number 1, but 1 is not in your words on line 4/);
  // an Add on another line, or of another number, says nothing for this one
  assert.equal(countReds({ part: { count: { min: 1, max: 4 } }, jobLine: { n: 4, text: 'x' }, added: new Set(['3:min:1', '3:max:4', '4:min:2']) }).length, 2);
  assert.equal(countReds({ part: { count: { min: 1, max: 4 } }, jobLine: { n: 4, text: 'x' }, added: new Set(['4:min:1', '4:max:4']) }).length, 0, 'the person\'s Add says the numbers');
});
