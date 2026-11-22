// M19 S7 (docs/wiki/the-module-ladder.md, "M19" S7, section 3.7, amendment D): the Audit's check list is one block per job line and an "Every line" block for the rows no line owns
// (a one-line job: those rows join its Line 1 block); the run detail carries `lines` and `jobNotChecked`; a failed row carries the reason its check recorded. Each test names the break that turns it red.
// The page's own functions are cut out of src/panel/index.html by name and run in node over a tiny element stub (no browser), as test/m19-s6-look.test.js does for the card.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { auditChecksOf } from '../src/auditchecks.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(path.join(HERE, '../src/panel/index.html'), 'utf8').split('\n');
const fnSource = (/** @type {string} */ name) => {
  const i = HTML.findIndex((l) => new RegExp(`^\\s*function ${name}\\(`).test(l));
  assert.ok(i >= 0, `the page has ${name}`);
  const indent = HTML[i].match(/^\s*/)?.[0] ?? '';
  if (HTML[i].trimEnd().endsWith('}') && !HTML[i].trimEnd().endsWith('{')) return HTML[i];
  let j = i + 1;
  while (j < HTML.length && HTML[j] !== `${indent}}`) j++;
  return HTML.slice(i, j + 1).join('\n');
};
class El {
  constructor() { this.children = []; this.attrs = {}; this.style = {}; this.className = ''; this.innerHTML = ''; this.textContent = ''; this.hidden = false; this.classList = { toggle() {} }; }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attrs[k] = v; }
  appendChild(/** @type {any} */ c) { this.children.push(c); return c; }
  addEventListener() {}
}
/** the Audit's checks fold, drawn by the page's own `auditChecksEl`; returns its body's html */
const drawn = (/** @type {any} */ ac) => {
  const ctx = vm.createContext({ document: { createElement: () => new El() }, auditExpanded: {} });
  vm.runInContext(['escapeXml', 'glyphClass', 'stateDotHTML', 'tagWordOf', 'byTagOf', 'ckTagHtml', 'ckRowHtml', 'ckGroupHtml', 'auditCheckRowHtml', 'auditChecksSignClass', 'auditChecksEl'].map(fnSource).join('\n'), ctx);
  const wrap = /** @type {El} */ (/** @type {any} */ (ctx).auditChecksEl(ac));
  return wrap.children.find((c) => c.attrs['data-testid'] === 'audit-checks-body').innerHTML;
};
const text = (/** @type {string} */ h) => h.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const count = (/** @type {string} */ h, /** @type {string} */ needle) => h.split(needle).length - 1;

const row = (/** @type {any} */ o) => ({ state: 'built', ...o });
const decl = () => ({
  steps: [
    { fromLine: 1, emits: 'a1', goal: 'one', primitives: [], reads: [], close: { class: 'hitl' } },
    { fromLine: 2, emits: 'a2', goal: 'two', primitives: [], reads: ['a1'], close: { class: 'softgreen', shape: { picked: [{ rule: 'maxWords', value: 80 }, { rule: 'listItems', value: 3 }] } } },
  ],
  checkList: [
    row({ key: 'L1.$floor', line: 1, kind: 'floor', by: 'default' }),
    row({ key: 'L2.$floor', line: 2, kind: 'floor', by: 'default' }),
    row({ key: 'L2.~1', line: 2, kind: 'rule', by: 'you', part: { line: 2, part: 0 } }),
    row({ key: 'L2.count', line: 2, kind: 'count', by: 'agent', part: { line: 2, part: 1 } }),
  ],
});
const LINES = [{ n: 1, text: 'Write the intro' }, { n: 2, text: 'Write the body' }];
const EVERY = [{ n: 1, text: "the output exists and isn't empty", ok: true, source: 'every step' }, { n: 2, text: 'the model said done: true', ok: true, source: 'every step' }];
const diary = () => [{ kind: 'checks', step: 'a2', try: 1, checks: [...EVERY, { n: 3, text: 'at most 80 words', ok: true, part: 0, by: 'you', source: 'line 2 ~' }, { n: 4, text: 'exactly 3 list items', ok: false, result: 'it has 2 items', part: 1, by: 'agent', source: 'line 2 ~' }] }];
const NC2 = 'line 2: "tone" — You chose to leave it Not checked.';
const NC0 = 'not checked · "overall" — r0';
const nc = () => ({ items: [NC2, NC0], by: { [NC2]: 'you' } });

test('(a) a multi-line job: one block per job line, then an "Every line" block with the two every-step rows and the Not checked row no line owns', () => {
  const ac = auditChecksOf(decl(), diary(), nc(), { lines: LINES });
  assert.ok(ac);
  assert.deepEqual(ac.lines.map((l) => [l.n, l.text, l.checks.length, l.notChecked.length]), [[1, 'Write the intro', 0, 0], [2, 'Write the body', 2, 1]], 'break: do not split the rows by their line and this reds');
  assert.deepEqual(ac.lines[1].checks.map((r) => r.text), ['at most 80 words', 'exactly 3 list items'], 'the words carry no `line N · ` prefix');
  assert.deepEqual(ac.jobNotChecked.map((r) => r.text), ['overall']);
  const h = drawn(ac);
  assert.equal(count(h, 'data-testid="audit-line"'), 2, 'break: draw one block for the whole job and this reds');
  assert.equal(count(h, 'data-testid="audit-job-level"'), 1);
  assert.match(text(h), /Line 1 Write the intro/);
  assert.match(text(h), /Line 2 Write the body .*CHECKED · 2/);
  const rest = h.slice(h.indexOf('data-testid="audit-job-level"'));
  assert.match(text(rest), /Every line CHECKED · 2 .*the output exists.*NOT CHECKED · 1 .*overall/, 'the every-step rows and the line-less Not checked row sit under Every line');
  assert.ok(!text(h.slice(0, h.indexOf('data-testid="audit-job-level"'))).includes('the output exists'), 'break: put the every-step rows in each line block and this reds');
});

test('(b) a one-line job has no "Every line" block: the rows no line owns join its Line 1 block', () => {
  const d = decl();
  d.steps = [d.steps[1]].map((s) => ({ ...s, fromLine: 1 }));
  d.checkList = d.checkList.filter((r) => r.line === 2).map((r) => ({ ...r, line: 1, key: r.key.replace('L2', 'L1'), ...(r.part ? { part: { line: 1, part: r.part.part } } : {}) }));
  const dia = [{ kind: 'checks', step: 'a2', try: 1, checks: [...EVERY, { n: 3, text: 'at most 80 words', ok: true, part: 0, by: 'you', source: 'line 1 ~' }, { n: 4, text: 'exactly 3 list items', ok: true, part: 1, by: 'agent', source: 'line 1 ~' }] }];
  const ac = auditChecksOf(d, dia, { items: ['not checked · "overall" — r0'], by: {} }, { lines: [LINES[0]] });
  assert.ok(ac);
  const h = drawn(ac);
  assert.equal(count(h, 'data-testid="audit-line"'), 1);
  assert.equal(count(h, 'data-testid="audit-job-level"'), 0, 'break: always draw the rest block and this reds');
  assert.ok(!text(h).includes('Every line'));
  const t = text(h);
  for (const w of ['at most 80 words', 'exactly 3 list items', "the output exists and isn't empty", 'the model said done: true', 'overall']) assert.ok(t.includes(w), `Line 1 holds ${w}: ${t}`);
});

test('(c) a line\'s output-file check reads kind `file` (a row of the "Every line" block and of a one-line job\'s Line 1), a line\'s own checks stay `truth`', () => {
  const ac = auditChecksOf(decl(), diary(), nc(), { lines: LINES });
  assert.ok(ac);
  assert.deepEqual(ac.always.map((r) => r.kind), ['file', 'file'], 'break: leave the kind off an every-step row and this reds');
  assert.deepEqual(ac.lines[1].checks.map((r) => r.kind), ['truth', 'truth']);
  const h = drawn(ac);
  assert.equal(count(h.slice(h.indexOf('data-testid="audit-job-level"')), '<span class="kind" data-testid="ck-kind">file</span>'), 2);
});

test('a failed row carries the reason its check recorded, indented under it; a passed row and an unrecorded failure carry none', () => {
  const ac = auditChecksOf(decl(), diary(), nc(), { lines: LINES });
  assert.ok(ac);
  assert.deepEqual(ac.lines[1].checks.map((r) => [r.result, r.why ?? null]), [['passed', null], ['failed', 'it has 2 items']], 'break: do not read the diary result for a failed check and this reds');
  assert.match(drawn(ac), /data-testid="audit-check-why">it has 2 items</);
  const bad = auditChecksOf(decl(), [{ kind: 'checks', step: 'a2', try: 1, checks: [...EVERY, { n: 3, text: 'x', ok: false, part: 0, by: 'you', source: 'line 2 ~' }] }], null, { lines: LINES });
  assert.ok(bad && bad.lines[1].checks[0].result === 'failed' && !('why' in bad.lines[1].checks[0]), 'no recorded reason, none invented');
  const every = auditChecksOf(decl(), [{ kind: 'checks', step: 'a1', try: 1, checks: [{ n: 1, text: "the output exists and isn't empty", ok: false, result: 'nothing was saved', source: 'every step' }] }], null, { lines: LINES });
  assert.ok(every && every.always[0].result === 'failed' && every.always[0].why === 'nothing was saved');
});

test('(e) an old run with no per-line data keeps the flat groups: no job text, or a row owned by a line the job text lacks, loses no row', () => {
  const none = auditChecksOf(decl(), diary(), nc());
  assert.ok(none);
  assert.deepEqual(none.lines, [], 'no job lines, no blocks');
  const h = drawn(none);
  assert.equal(count(h, 'data-testid="audit-line"'), 0);
  const t = text(h);
  for (const w of ['at most 80 words', 'exactly 3 list items', "the output exists and isn't empty", 'the model said done: true', 'tone', 'overall']) assert.ok(t.includes(w), `${w} kept: ${t}`);
  assert.match(t, /CHECKED · 4/);
  assert.match(t, /NOT CHECKED · 2/);
  // job text that lacks line 2: its checks have no block, so the flat groups are drawn
  const short = auditChecksOf(decl(), diary(), nc(), { lines: [LINES[0]] });
  assert.ok(short);
  assert.deepEqual(short.lines, [], 'break: draw blocks for the lines known and drop line 2\'s rows, and this reds');
  assert.ok(text(drawn(short)).includes('exactly 3 list items'));
  // a plan with a data object that predates `lines` (the page reads `ac.lines` absent)
  const old = { checks: none.checks, notChecked: none.notChecked, always: none.always, readNotes: [] };
  const t2 = text(drawn(old));
  assert.ok(t2.includes('exactly 3 list items') && t2.includes('overall'), t2);
});

test('(d) the run detail carries `lines` and `jobNotChecked` (a real run, real panel route)', async () => {
  const w = await world();
  const { flow } = await w.signedFlow();
  const started = (await w.post('/api/author/run', { flow, inputs: w.inputs(), runId: 'r1' })).json();
  assert.ok(started.startId, JSON.stringify(started));
  const audit = await until(async () => {
    const j = (await w.get(`/api/runs/${flow}/r1/audit`)).json();
    return j?.auditChecks?.always?.every((r) => r.result !== 'none') ? j : null;
  }, 20000);
  const ac = audit.auditChecks;
  assert.ok(Array.isArray(ac.lines) && ac.lines.length > 0, `lines shipped: ${JSON.stringify(ac.lines)}`);
  assert.ok(Array.isArray(ac.jobNotChecked), 'break: leave them out of the route\'s answer and this reds');
  // every row of the flat sections is in exactly one place of the blocks
  const inBlocks = ac.lines.reduce((n, l) => n + l.checks.length, 0);
  assert.equal(inBlocks, ac.checks.length);
  assert.equal(ac.lines.reduce((n, l) => n + l.notChecked.length, 0) + ac.jobNotChecked.length, ac.notChecked.length);
  assert.ok(ac.lines.every((l) => typeof l.n === 'number' && typeof l.text === 'string' && l.text !== ''));
});
