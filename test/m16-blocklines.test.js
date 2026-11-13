// M16 am1 (docs/wiki/the-module-ladder.md, "M16"): the block is given STEP lines only, and adds no `$` cited default row. Fixtures: test/fixtures/m16-block/{m14-walk-5,flights,csv}
// (copied from the F185 POC 2 cases; m14-walk-5/run-5 holds the real accepted run-5 artifacts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRubric, checkStep } from 'bareguard';
import { blockJobLines, newJobBlock } from '../src/blocklines.js';
import { CheckBlock } from '../src/checkblock.js';

const rd = (/** @type {string} */ f) => readFileSync(new URL(`./fixtures/m16-block/${f}`, import.meta.url), 'utf8');
const walk = { prose: rd('m14-walk-5/prose.txt'), notes: rd('m14-walk-5/notes.md') };

/** the typed Agree, no AI */
const agree = (/** @type {any} */ b) => { b.drive({ answer: (/** @type {any} */ q) => (q.offers.agree ? { choice: 'agree' } : null) }); return b.reconcile(); };

function walkBlock(/** @type {any} */ mk = newJobBlock) {
  const r = /** @type {any} */ (blockJobLines(walk.prose));
  const b = mk({ texts: { notes: walk.notes }, jobLines: r.jobLines });
  b.reconcile();
  return { r, b, close: agree(b) };
}

test('(a) m14-walk-5: no cited row on lines 1, 3, 5; the $ floor stays on each', () => {
  const { r, b } = walkBlock();
  assert.deepEqual(r.jobLines.map((/** @type {any} */ l) => l.n), [1, 3, 5]);
  assert.deepEqual(b.rows.filter((/** @type {any} */ x) => x.kind === 'cited'), []);
  for (const n of [1, 3, 5]) assert.equal(b.rows.filter((/** @type {any} */ x) => x.line === n && x.kind === 'floor' && x.state === 'built').length, 1, `floor on line ${n}`);
});

test('(a) red-first guard: the raw block (cited default on) DOES add a cited row on lines 1, 3, 5', () => {
  const { b } = walkBlock((/** @type {any} */ o) => { const x = new CheckBlock({ texts: o.texts, labels: Object.keys(o.texts), asks: true, split: true }); x.fromJob(o.jobLines); return x; });
  assert.deepEqual(b.rows.filter((/** @type {any} */ x) => x.kind === 'cited').map((/** @type {any} */ x) => x.line), [1, 3, 5]);
});

test('(b) ask and send lines get zero rows', () => {
  for (const [prose, ask, send] of [[walk.prose, [2, 4, 6], [7]], [rd('flights/draft-prose.txt'), [3, 5], [6]]]) {
    const r = /** @type {any} */ (blockJobLines(/** @type {string} */ (prose)));
    assert.deepEqual(r.skipped.ask, ask);
    assert.deepEqual(r.skipped.send, send);
    const b = newJobBlock({ texts: { notes: 'x' }, jobLines: r.jobLines });
    const out = new Set([.../** @type {number[]} */ (ask), .../** @type {number[]} */ (send)]);
    assert.deepEqual(b.rows.filter((/** @type {any} */ x) => out.has(x.line)), []);
    assert.ok(b.rows.length > 0);
  }
});

test('(c) a CSV job: the sheet line gets zero rows once the declaration says it reads the sheet', () => {
  const prose = rd('csv/prose.txt');
  const decl = JSON.parse(rd('csv/signed-declaration.json'));
  const r = /** @type {any} */ (blockJobLines(prose, decl));
  assert.deepEqual(r.skipped.sheet, [2]);
  assert.ok(!r.jobLines.some((/** @type {any} */ l) => l.n === 2));
  const b = newJobBlock({ texts: { file: rd('csv/file.csv') }, jobLines: r.jobLines });
  assert.deepEqual(b.rows.filter((/** @type {any} */ x) => x.line === 2), []);
  // before a declaration exists nothing in fwd names a sheet line, so line 2 is given (the caller passes the declaration when it has one)
  assert.ok(/** @type {any} */ (blockJobLines(prose)).jobLines.some((/** @type {any} */ l) => l.n === 2));
});

/** one bareguard rubric over ONE built part (a count check on the answer's `text`) */
async function gradePart(/** @type {any} */ part, /** @type {string} */ text) {
  const { check, text: _t, class: _c, rules: _r, ...args } = part;
  const rubric = createRubric({ schema: 1, goal: 'softgreen', checkpoints: { close: { gating: true, checks: [{ id: 'p', rule: check, field: 'text', ...args }] } } });
  return (await checkStep(rubric, 'close', { text }, {})).verdict;
}
const run5 = (/** @type {string} */ n) => JSON.parse(rd(`m14-walk-5/run-5/${n}.json`)).text;

test('(d) F185 POC 2 bar (c): every part the block builds for m14-walk-5 passes real bareguard on the real accepted run-5 output', async () => {
  const { close } = walkBlock();
  const artifact = { 3: run5('week_jobs'), 5: run5('neighbour_note') };
  assert.equal(close.parts.length, 2);
  assert.ok(!close.parts.some((/** @type {any} */ p) => p.check === 'cited'));
  for (const m of close.map) assert.equal(await gradePart(close.parts[m.part], /** @type {any} */ (artifact)[m.line]), 'green', `line ${m.line} ${close.parts[m.part].check}`);
  // the grader can fail: a 4-bullet answer and a 100-word note go red
  const p3 = close.parts[close.map.find((/** @type {any} */ m) => m.line === 3).part];
  const p5 = close.parts[close.map.find((/** @type {any} */ m) => m.line === 5).part];
  assert.notEqual(await gradePart(p3, '1. a\n2. b\n3. c\n4. d'), 'green');
  assert.notEqual(await gradePart(p5, Array(100).fill('word').join(' ')), 'green');
});

test('(e) flights: every look `!` row is [agent] with words on the page or Not checked with a reason; the four ~ rules are [you] rows', () => {
  const r = /** @type {any} */ (blockJobLines(rd('flights/draft-prose.txt')));
  const page = rd('flights/flights.txt');
  const look = JSON.parse(rd('flights/page-look.json'));
  const b = newJobBlock({ texts: { flights: page }, jobLines: r.jobLines });
  b.addLook(look.look.facts, look.look.dropped); // as F185 POC 2: the look's own `{facts, dropped}`
  b.reconcile();
  const bangs = b.rows.filter((/** @type {any} */ x) => x.by === 'agent');
  assert.ok(bangs.length > 0);
  for (const x of bangs) {
    if (x.state === 'not-checked' || x.state === 'suggested') assert.ok(x.reason, `${x.key} needs a reason`);
    else { assert.ok((x.words ?? []).length > 0); for (const w of x.words) assert.ok(page.toLowerCase().includes(String(w).toLowerCase()), `${w} on the page`); }
  }
  const rules = b.rows.filter((/** @type {any} */ x) => x.kind === 'rule');
  assert.equal(rules.filter((/** @type {any} */ x) => !x.parent).length, 4);
  assert.ok(rules.every((/** @type {any} */ x) => x.by === 'you'));
  assert.equal(b.rows.filter((/** @type {any} */ x) => x.kind === 'cited').length, 0);
});
