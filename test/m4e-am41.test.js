// M4e amendment 41 (items 6-7; item 5, the 7-sub-card cap, moved to M11: test/m11-b-page.test.js): the Job tab has a "The job" title;
// each failed plan check on the Chat card is one plain sentence with the raw checker text folded under it. $0. The layout is a browser walk.
import assert from 'node:assert/strict';
import { RULES_PRELUDE } from './plan-check-rules.mjs';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const fn = (name) => {
  const start = PAGE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};

test('item 6: the Job tab has a "The job" title (a field label, like the Chat card) under Model and above the signed lines, with a unique id', () => {
  const model = PAGE.indexOf('id="details-model"');
  const title = PAGE.indexOf('id="details-job-title"');
  const prose = PAGE.indexOf('id="details-prose"');
  assert.ok(model !== -1 && title > model && prose > title, `order model ${model} < title ${title} < prose ${prose}`);
  assert.match(PAGE, /<label id="details-job-title">The job<\/label>/);
  assert.equal((PAGE.match(/id="details-job-title"/g) || []).length, 1);
});

// ---- item 7: the Chat card's failed plan checks ----
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));
function fnSrc(name) {
  const start = CHAT.indexOf(`    function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in the Chat block`);
  return CHAT.slice(start, CHAT.indexOf('\n    }\n', start) + 7);
}
const load = (name, prelude = '') => new Function(`${prelude}\n${fnSrc(name)}\nreturn ${name};`)();

// real checker texts, copied from the templates in src/declaration.js (one per red kind)
const KINDS = [
  'declaration: steps[1].close.shape.sections names "Skills", which is not in the job line\'s words — change the job line on the card to change what it names',
  'declaration: steps[1] the job line says A, then B; the check says B, then A — change the job line on the card to change the order',
  'declaration: steps[1] the guardrail says 3 sections; the check has 2',
  'declaration: steps[1].close.shape.sections "Skills and more" contains "Skills" — one section name may not contain another',
  'declaration: steps[1] the check has wordsPerSection 50; the guardrail says 80 words each — change the guardrail',
  'declaration: steps[1].close.shape cannot be built into a check — bad thing',
  'declaration: steps[0].goal is not its signed line 1 verbatim (expected "a", got "b") — the goal is the human\'s line, never reworded',
  'declaration: steps[0].primitives names "fly", which is not in the catalogue',
  'declaration: steps[1] reads artifact "x" that no earlier step declared',
  'declaration: ask at line 4 has no step bound to it',
  'declaration: send at line 5 (steps[3]) has no signed ask at an earlier line to read from',
  'declaration: step "sent" (line 5) is hitl after the last signed ask — nothing may leave unseen',
  'declaration: job line 2 ("Do x") is neither served by any step\'s fromLine nor refused with a reason',
  'declaration: steps[0].picks["data"] names "Nope" — invented name, not in the source',
  'declaration: "steps" must be a non-empty array',
  'line 3\'s guardrail gives 100 words for each section but not how many sections. Say the number of sections in the guardrail.',
];

test('item 7: each known red kind reads as one plain sentence (no "declaration:" code words, one line), the raw text kept as is', () => {
  const plain = load('plainPlanCheck', RULES_PRELUDE);
  const generic = plain('zzz unknown').say;
  for (const raw of KINDS) {
    const r = plain(raw);
    assert.equal(r.raw, raw, 'the raw checker text is kept word for word');
    assert.notEqual(r.say, generic, `a known kind must not fall to the generic sentence: ${raw}`);
    assert.doesNotMatch(r.say, /declaration|steps\[|\.close\.|fromLine|verbatim/, r.say);
    assert.doesNotMatch(r.say, /\n/);
    assert.match(r.say, /\.$/, 'a sentence');
  }
});

test('item 7: an unknown red gets the generic plain sentence and still carries its raw text; nothing is dropped', () => {
  const plain = load('plainPlanCheck', RULES_PRELUDE);
  const r = plain('something the checker said that we never mapped');
  assert.ok(r.say.length > 10);
  assert.equal(r.raw, 'something the checker said that we never mapped');
  assert.equal(plain('').raw, '');
  assert.equal(plain(null).raw, '');
});

test('item 7 (replaced by am15): a failed list line carries no details and no raw text any more (the reason lives in the server\'s line, the history in Audit); renderProgress still draws a fold for any row that has one', () => {
  const plain = load('plainPlanCheck', RULES_PRELUDE);
  const steps = new Function(`${RULES_PRELUDE}\n${fnSrc('plainPlanCheck')}\n${fnSrc('failedDetails')}\n${fnSrc('stepsFor')}\nreturn stepsFor;`)();
  const reds = [KINDS[0], 'zzz'];
  const red = steps({ phase: 'red', reds }, { model: 'm', starting: false });
  assert.deepEqual([red[1].details, red[1].raw], [[], undefined]);
  assert.equal(plain(reds[0]).say.length > 10, true);
  const rev = steps({ phase: 'red', card: {}, reds: [], revises: [{ n: 1, phase: 'red', reds: [KINDS[2]] }] }, { model: 'm', starting: false });
  const f = rev.find((s) => s.id === 'revise-1');
  assert.deepEqual([f.details, f.raw], [[], undefined]);
  const rp = fnSrc('renderProgress');
  assert.match(rp, /<details class="step-raw" data-fold=.*<summary>details<\/summary>/);
  assert.match(rp, /escapeXml\(raw\[/);
});

// am41 item 7 fix: an opened "details" fold stays open across the poll re-render until the person closes it.
function progressHarness(openMap) {
  const row = { _h: '', writes: 0, hidden: false, get innerHTML() { return this._h; }, set innerHTML(v) { this.writes++; this._h = v; } };
  const mk = new Function('progressRow', 'openMap', `var progressHtml = ""; var progressOpen = openMap;\n${fn('escapeXml')}\n${fnSrc('renderProgress')}\nreturn renderProgress;`);
  return { row, render: mk(row, openMap) };
}
const STEPS = [{ id: 'plan', label: 'Plan check', status: 'failed', details: ['one plain sentence'], raw: ['raw checker text'] }];

test('item 7 fold: an identical poll re-render does not rewrite the list (a rewrite snaps an opened fold shut)', () => {
  const { row, render } = progressHarness({});
  assert.equal(render(STEPS), true);
  const w = row.writes;
  assert.equal(render(STEPS), false);
  assert.equal(row.writes, w, 'second identical render must not touch innerHTML');
});

test('item 7 fold: when the list does change, a fold the person opened is drawn open again; one never opened stays shut', () => {
  const { row, render } = progressHarness({ 'plan:0': true });
  render(STEPS);
  assert.match(row.innerHTML, /<details class="step-raw" data-fold="plan:0" open>/);
  const { row: row2, render: render2 } = progressHarness({});
  render2(STEPS);
  assert.doesNotMatch(row2.innerHTML, /open>/);
});
