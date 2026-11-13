// borrowed-from: bareloop tests/checklist.test.js@v0.56.0 (3383cce + f148028e for the agree-follower tests), imports pointed at fwd's files, fixtures under test/fixtures/m16-block/
// The row vocabulary of a rubric job's check list and its extra-check call (src/checklist.js): the week-only reader and the list call. The rows themselves are tested on the block (tests/checkblock-rows.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CL from '../src/checklist.js';

const texts = { Changelog: '## [0.54.1] - 2026-11-04\n### Fixed\n- one\n- two\n' };
const jobLines = [{ n: 1, text: 'Summarise the latest release', rule: 'exactly 3 bullets', rules: ['exactly 3 bullets'] }];

test('A8 weekOnly reads a version or a date, not a price, a percent or plain words', () => {
  for (const t of ['0.54.1', 'v1.2', '2026-11-04', '04/11/2026', 'Nov 4, 2026', '4 November 2026', 'November 2026', 'released 0.54.1 on Nov 4']) assert.equal(CL.weekOnly(t), true, t);
  for (const t of ['## [', '$4.50', '12.5%', '1 result', 'Fixed', 'crushed eggshell', 'may', '3 bullets']) assert.equal(CL.weekOnly(t), false, t);
});

// ---- A3: the one paid call -----------------------------------------------------------------------------------------------------------------
const scripted = (args, seen = []) => async (m, tools) => {
  seen.push({ tools: tools.map((t) => t.name), user: m.at(-1).content });
  if (args !== null) await tools.find((t) => t.name === CL.LEDGER_TOOL).execute(args);
  return { text: '', error: null, msgs: [], metrics: { costUsd: 0.0009, unpricedRounds: 0 } };
};

// bareloop's two runLedgerSuggest tests are not ported: the paid call itself is not taken (see the header of src/checklist.js)
test('A3 the call system text is the signed one (count and phrase only, up to 3, or an empty list)', () => {
  assert.equal(CL.LEDGER_SYSTEM, 'You look at the inputs of a job and name checks the inputs themselves support, beyond the guardrails the person wrote.\n'
    + 'Call suggest_extra_checks once with up to 3 entries, or with an empty list.\n'
    + '- kind "count": how many results the input shows or the job asks for (min and/or max, whole numbers).\n'
    + '- kind "phrase": fixed words copied verbatim from an input (phrase, and source = that input\'s label).\n'
    + 'Use only what you can see in the inputs. Do not repeat a guardrail the person wrote. If the inputs support none, send an empty list.');
  assert.deepEqual(CL.LEDGER_SCHEMA.properties.extra.items.properties.kind.enum, ['count', 'phrase']);
});

// ---- A6 / A7 / A8: after each try -------------------------------------------------------------------------------------------------------------
const decl = (parts, extra = {}) => ({ stages: [{ name: 'changed', kind: 'files-changed', params: {} }, { name: 'line-1', kind: 'rubric-step', fromLine: [1], params: { step: 1, parts } }], ...extra });
const partsOf = (d) => d.stages[1].params.parts;

// ---- A9: every row ends built / not-checked (reason) / dropped (reason) ----------------------------------------------------------------------

// ---- A5: the drafter's block ------------------------------------------------------------------------------------------------------------------
