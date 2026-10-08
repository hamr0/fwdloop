// M4e amendment 7 items 6-7, the page side (negative (d)): the Signed flow rows, the typing filter, Run again in the one action row, and
// nothing picked = nothing runs. Page functions are cut out of index.html and run against plain data; real rendering at 1280/390/320 px
// is a browser walk. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');
const cut = (indent, name) => {
  const head = `${indent}function ${name}(`;
  const start = PAGE.indexOf(`\n${head}`) + 1;
  assert.ok(start > 0, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf(`\n${indent}}\n`, start) + indent.length + 3);
};
const load = (...names) => new Function(`${names.map((n) => cut('  ', n)).join('\n')}\nreturn { ${names.join(', ')} };`)();

const flow = (name, stats, runs = []) => ({ flow: name, stats, runs: runs.map((runId) => ({ runId })) });
const STATS = {
  steps: 4, asks: 1, green: 3, notGreen: 1, avgSpendUsd: 0.0616, avgWallMs: 383000,
};

test('(d) a Signed flow row\'s second line: steps, asks, green, not green, about $ and time a run — money and time from the one formatters', () => {
  const { flowStatLine } = load('countWord', 'money', 'duration', 'flowStatLine');
  assert.equal(flowStatLine(flow('f', STATS)), '4 steps · 1 ask · 3 green · 1 not green · about $0.0616 and 6m23s a run');
  assert.equal(flowStatLine(flow('f', { ...STATS, steps: 1, asks: 2 })), '1 step · 2 asks · 3 green · 1 not green · about $0.0616 and 6m23s a run');
});

test('(d) unknown cost or time is said, never $0 or 0 time', () => {
  const { flowStatLine } = load('countWord', 'money', 'duration', 'flowStatLine');
  assert.match(flowStatLine(flow('f', { ...STATS, avgSpendUsd: null })), /about 6m23s a run, cost not recorded$/);
  assert.match(flowStatLine(flow('f', { ...STATS, avgWallMs: null })), /about \$0\.0616 a run, time not recorded$/);
  const both = flowStatLine(flow('f', { ...STATS, avgSpendUsd: null, avgWallMs: null }));
  assert.match(both, /cost and time not recorded$/);
  assert.doesNotMatch(both, /\$0|0s|0 min/);
});

test('(d) typing filters on any part of a flow or run name; "run-2" lists every flow\'s run-2 as "<flow> (run-2)"; empty text lists every flow', () => {
  const { flowChoices } = load('countWord', 'money', 'duration', 'flowStatLine', 'flowChoices');
  const flows = [flow('job2', STATS, ['run-1', 'run-2']), flow('cv-check', STATS, ['run-2', 'run-3'])];
  assert.deepEqual(flowChoices(flows, '').map((c) => c.label), ['job2', 'cv-check']);
  assert.deepEqual(flowChoices(flows, 'run-2').map((c) => c.label), ['job2 (run-2)', 'cv-check (run-2)']);
  assert.deepEqual(flowChoices(flows, 'v-ch').map((c) => c.label), ['cv-check'], 'a part of a flow name');
  assert.deepEqual(flowChoices(flows, 'RUN-3').map((c) => [c.flow, c.runId]), [['cv-check', 'run-3']], 'any case');
  assert.deepEqual(flowChoices(flows, 'job2 (run-1)').map((c) => c.label), ['job2 (run-1)'], 'the whole label finds it');
  assert.deepEqual(flowChoices(flows, 'nothing'), []);
  assert.equal(flowChoices(flows, 'job2')[0].runId, null, 'a flow row picks the flow, not a run');
  assert.ok(flowChoices(flows, 'job2')[0].meta.startsWith('4 steps'), 'each row carries its meta line');
});

test('(d) nothing picked = no flow, no run: selectedFlow is null and the Run box sends no flow until the human picks (or Run again picks it)', () => {
  const sel = cut('    ', 'selectedFlow');
  const make = (pickedFlow, flows, againEntry) => new Function('pickedFlow', 'flows', 'againEntry', `${sel}\nreturn selectedFlow();`)(pickedFlow, flows, againEntry);
  assert.equal(make(null, [{ flow: 'a' }], null), null);
  assert.equal(make('a', [{ flow: 'a' }], null).flow, 'a');
  assert.equal(make('old', [{ flow: 'a' }], { flow: 'old' }).flow, 'old', 'a flow Run again opened, though not in the list');
  assert.equal(make('gone', [{ flow: 'a' }], null), null);
  assert.match(cut('    ', 'currentRun'), /flow: pickedFlow \|\| ""/);
  assert.match(cut('    ', 'startReady'), /return !!selectedFlow\(\) && /);
  assert.doesNotMatch(PAGE, /<select id="jf-run-flow"/, 'no select that auto-picks its first option');
});

test('(d) Run again, Stop and Resume sit in the ONE action row, Run again first, from the one function', () => {
  const body = cut('  ', 'renderRunActions');
  const at = (t) => body.indexOf(t);
  assert.ok(at('"run-again"') > 0 && at('"run-again"') < at('"run-stop"') && at('"run-stop"') < at('"run-resume"'), 'order: Run again, Stop, Resume');
  assert.match(body, /el\.appendChild\(makeButton\("Run again"/);
  assert.equal((PAGE.match(/data-testid="run-actions"/g) || []).length, 1, 'one action row');
  assert.match(PAGE, /\/api\/author\/run-again\?flow=/);
  assert.match(PAGE, /window\.fwdloopRunAgain = openRunAgain/);
});

test('(d) picking a run fills that run\'s values, picking a flow its own: paintRunFlow reads the picked run\'s values and inputs over the flow\'s', () => {
  const body = cut('    ', 'paintRunFlow');
  assert.match(body, /var v = f \? \(pickedRun \? pickedRun\.values : f\.values\) : null/);
  assert.match(body, /paintRunRows\(f, pickedRun \? pickedRun\.sources : \(f \? f\.lastSources : null\)\)/);
  // the Sign & run test still compares to the FLOW's signed values, never the picked run's
  assert.match(cut('    ', 'runDiffers'), /f\.values\.destination/);
});
