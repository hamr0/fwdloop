// M4e amendment 7 item 2, negative (b): Draft is the first step. Server: one summary (calls, time, cost add up to the Draft rows; an unknown
// figure is never 0; an older flow says "no draft record"). Page: the Map's first box, the first card line, the Audit group first and closed.
// Real rendering at 1280/390/320 is a browser walk. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draftTotals, getDraftBlock, getRunAudit, getRunDetail, NO_DRAFT_WORDS } from '../src/panel/data.js';
import { loadCatalogue } from '../src/catalogue.js';
import { killChildrenAfter, world } from './m4e-world.mjs';

killChildrenAfter();
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const CAT = loadCatalogue().primitives;

const row = (kind, over = {}) => ({
  kind, n: 0, at: '2026-10-06T10:00:00.000Z', model: 'deepseek-flash', costUsd: 0.01, spendComplete: true, calls: 2, wallMs: 5000, verdict: 'green', hash: 'abcdef012345', gap: null, ...over,
});

test('(b) draftTotals: time, calls and cost are the sums of the draft and change rows; a floor reads "at least"', () => {
  const t = draftTotals([row('draft'), row('change', { n: 1, costUsd: 0.02, calls: 3, wallMs: 7000 })]);
  assert.deepEqual([t.calls, t.timeMs, t.cost, t.modelRows], [5, 12000, '$0.0300', 2]);
  assert.equal(draftTotals([row('draft'), row('change', { spendComplete: false })]).cost, 'at least $0.0200');
});

test('(b) draftTotals: a figure any row did not record is unknown, never 0 and never a partial sum shown as whole', () => {
  const t = draftTotals([row('draft'), row('change', { costUsd: null, calls: null, wallMs: null })]);
  assert.equal(t.calls, null);
  assert.equal(t.timeMs, null);
  assert.equal(t.cost, 'at least $0.0100', 'one row priced: a floor, flagged');
  const none = draftTotals([row('draft', { costUsd: null, spendComplete: false })]);
  assert.equal(none.cost, null, 'nothing priced: no cost at all');
  assert.equal(draftTotals([]).calls, null);
});

test('(b) a flow signed before amendment 6 has no draft record: the summary says so and carries no cost; the Audit says so too', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-a7-draft-'));
  const flowDir = path.join(root, 'old');
  mkdirSync(path.join(flowDir, 'runs', 'run-1'), { recursive: true });
  const b = getDraftBlock(flowDir, path.join(flowDir, 'runs', 'run-1'));
  assert.deepEqual(b.summary, { present: false, why: 'no draft record' });
  assert.equal(b.why, NO_DRAFT_WORDS);
  assert.ok(!('cost' in b.summary) && !('usd' in b.summary), 'no cost key, never $0');
});

test('(b) for a flow signed after amendment 6 the Audit group and the Run detail give the SAME Draft summary, and it adds up to the Draft rows', async () => {
  const w = await world();
  const { flowDir } = await w.signedFlow();
  mkdirSync(path.join(flowDir, 'runs', 'run-1'), { recursive: true });
  // a controlled record in place of the fake provider's own: a draft, a note, a change (setup.jsonl is test-written here, as the sign would)
  const rows = [
    { kind: 'card', n: 0, at: '2026-10-06T09:59:00.000Z', card: { flowName: 'job2', job: 'x', capUsd: 0.25 } },
    row('draft', { costUsd: 0.0101, calls: 2, wallMs: 4000 }),
    { kind: 'note', n: 1, at: '2026-10-06T10:01:00.000Z', text: 'put skills first' },
    row('change', { n: 1, costUsd: 0.0202, calls: 3, wallMs: 6500 }),
    { kind: 'sign', n: 0, at: '2026-10-06T10:02:00.000Z', signedBy: 'hamr', hash: 'abcdef012345abcdef', flowHash: null },
  ];
  writeFileSync(path.join(flowDir, 'setup.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const audit = getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1' });
  const detail = getRunDetail({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
  const { rows: _r, ...fromDetail } = detail.draft;
  assert.deepEqual(fromDetail, audit.draft.summary, 'one summary: the Map box, the first card and the Audit group read the same figures');
  assert.deepEqual([audit.draft.summary.calls, audit.draft.summary.timeMs, audit.draft.summary.cost], [5, 10500, '$0.0303']);
  const model = audit.draft.rows.filter((x) => /^(draft|change)/.test(x.action));
  assert.equal(model.length, 2);
  assert.ok(Math.abs(model.reduce((a, x) => a + x.usd, 0) - 0.0303) < 1e-9, 'the cost is the sum of the Draft rows');
  assert.equal(model.reduce((a, x) => a + x.wallMs, 0), 10500, 'the time is the sum of the Draft rows');
  assert.ok(audit.draft.rows.every((x) => x.step === 'drafting'), 'the rows are the Draft group\'s');
  assert.equal(detail.draft.rows.length, audit.draft.rows.length, 'the first card lists the same rows');
});

test('(b) the draft spend row now records the draft\'s time (wallMs) and calls, and setup.jsonl keeps them', () => {
  const src = readFileSync(new URL('../src/authoring.js', import.meta.url), 'utf8');
  assert.match(src, /wallMs: startedAt === null \? null : Math\.max\(0, Date\.now\(\) - Date\.parse\(startedAt\)\)/);
  const setup = readFileSync(new URL('../src/setup.js', import.meta.url), 'utf8');
  assert.match(setup, /calls: Number\.isInteger\(spent\?\.calls\)/);
  assert.match(setup, /wallMs: typeof spent\?\.wallMs === 'number'/);
});

const cut = (name) => {
  const start = PAGE.indexOf(`\n  function ${name}(`) + 1;
  assert.ok(start > 0, `${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};
const load = (...names) => new Function(`${names.map(cut).join('\n')}\nreturn { ${names.join(', ')} };`)();

test('(b) the Draft\'s one line on the first card and in the Audit header: drafting · time · $cost · n calls · ✓; unknown figures say so; no record says so', () => {
  const { draftLineText } = load('countWord', 'money', 'duration', 'draftLineText');
  assert.equal(draftLineText({ present: true, timeMs: 10500, cost: '$0.0303', calls: 5 }), 'drafting · 10.5s · $0.0303 · 5 calls · ✓');
  assert.equal(draftLineText({ present: true, timeMs: null, cost: null, calls: null }), 'drafting · time unknown · cost unknown · calls unknown · ✓');
  assert.equal(draftLineText({ present: false, why: 'no draft record' }), 'drafting · no draft record');
  assert.doesNotMatch(draftLineText({ present: false, why: 'no draft record' }), /\$/);
});

test('(b) the Map: the Draft is the FIRST box, step 1 keeps its own number, an arrow runs between them, no draft record reads in the box', () => {
  const { draftBox, stepTitleText, buildStepMapSVG, buildStepBoxes } = new Function(`${PAGE.slice(PAGE.indexOf('function escapeXml'), PAGE.indexOf('function mapAvailWidth'))}
    return { draftBox, stepTitleText, buildStepMapSVG, buildStepBoxes };`)();
  const steps = buildStepBoxes([{ emits: 'a', goal: 'g', closeClass: 'hitl', attempts: [], tryCount: 0 }, { emits: 'b', goal: 'g', closeClass: 'hitl', attempts: [], tryCount: 0 }]);
  const boxes = [draftBox({ present: true })].concat(steps.map((b, i) => ({ ...b, n: i + 1 })));
  assert.equal(stepTitleText(0, boxes[0]), 'drafting');
  assert.equal(stepTitleText(1, boxes[1]), '1 a', 'step 1 keeps its number although it sits second');
  assert.equal(stepTitleText(2, boxes[2]), '2 b');
  const svg = buildStepMapSVG(boxes, 800);
  assert.ok(svg.indexOf('data-emits="drafting"') > 0 && svg.indexOf('data-emits="drafting"') < svg.indexOf('data-emits="a"'), 'the Draft box comes first');
  assert.equal((svg.match(/marker-end="url\(#sm\d+-arrow\)"/g) || []).length, 2, 'an arrow after the Draft and one after step 1');
  assert.match(buildStepMapSVG([draftBox({ present: false }), boxes[1]], 800), />no draft record</);
  assert.doesNotMatch(buildStepMapSVG([draftBox({ present: true }), boxes[1]], 800), /no draft record/);
});

test('(b) the page: renderRun puts the Draft box first on the Map and its card first under it; a click on either opens the Audit Draft group; Audit lists it first and closed', () => {
  const run = cut('renderRun');
  assert.match(run, /renderStepMap\(stepBoxes\.length \? \[draftBox\(detail\.draft\)\]\.concat\(/);
  assert.match(run, /listEl\.appendChild\(buildDraftCardEl\(detail\.draft\)\);\n\s+stepBoxes\.forEach/, 'the Draft card is appended before the step cards');
  assert.match(cut('buildDraftCardEl'), /openAuditGroup\("drafting"\)/);
  const groups = cut('renderAuditGroups');
  assert.match(groups, /if\(g\.draft && !Object\.prototype\.hasOwnProperty\.call\(auditExpanded, g\.step\)\) isOpen = false;/, 'the Draft never starts open');
  assert.match(groups, /\(draftG \? \[draftG\] : \[\]\)\.concat\(/);
  assert.ok(PAGE.indexOf('data-testid="audit-content"') < PAGE.indexOf('id="audit-groups"'), 'the filters and the groups sit in the same content block');
  assert.doesNotMatch(PAGE.replace(/^\s*\/\/.*$/gm, ''), /Setup/, 'no "Setup" word left on the page');
});
