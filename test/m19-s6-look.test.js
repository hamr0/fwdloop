// M19 S6 (docs/wiki/the-module-ladder.md, "M19" S6, section 3.7, amendments A and D): the one check-list look. Each test names the break that turns it red.
// The page's own functions are cut out of src/panel/index.html by name and run in node (no DOM), as poc/m19-p7/run.mjs does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { kindOfCheck, splitNotChecked, ncRowsOf, LOOK } from '../src/checklook.js';
import { auditChecksOf } from '../src/auditchecks.js';
import { buildReadout } from '../src/authoring.js';
import { REASON } from '../src/checkblock.js';
import { NO_GUARDRAIL_WORDS, ASK_LINE_REASON } from '../src/blockassemble.js';
import { NO_VALUE_WHY } from '../src/ticketrows.js';
import { dropLine, dropRows, dropSentence } from '../src/pagedropwords.js';
import { lineRules } from '../src/pagebits.js';

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
const page = () => {
  const ctx = vm.createContext({});
  vm.runInContext(['escapeXml', 'glyphClass', 'stateDotHTML', 'tagWordOf', 'byTagOf', 'ckTagHtml', 'ckRowHtml', 'ckGroupHtml', 'planFoldHtml', 'planLegend', 'planViewHtml', 'actionRowHtml', 'planControlHTML', 'auditCheckRowHtml'].map(fnSource).join('\n'), ctx);
  return /** @type {any} */ (ctx);
};
const text = (/** @type {string} */ h) => h.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

// ---- the kind word and the split (copied from the tag, section 3.7) ----------------------------------------------------------------------------------------------
test('kindOfCheck: shape = the form of the items, file = a guard or a line\'s output-file floor, truth = every other check', () => {
  assert.equal(kindOfCheck({ shape: true }), 'shape');
  assert.equal(kindOfCheck({ key: 'L2.$floor' }), 'file');
  assert.equal(kindOfCheck({ key: 'J.$guard.x' }), 'file');
  assert.equal(kindOfCheck({ key: 'L2.~1' }), 'truth', 'break: say file for every `$` row and this reds');
});

test('splitNotChecked: the quotes round a rule go, a long reason is split off, "you judge it at Accept" is the group title\'s', () => {
  assert.deepEqual(splitNotChecked('"tone" — You chose to leave it Not checked.'), { text: 'tone', why: 'You chose to leave it Not checked.' });
  assert.deepEqual(splitNotChecked('"tone" — you judge it at Accept'), { text: 'tone' });
  assert.deepEqual(splitNotChecked('whole'), { text: 'whole' });
});

test('ncRowsOf: a `line N: ` prefix names the owner line, `not checked · ` goes (the group says it), the tag rides along', () => {
  const rows = ncRowsOf(['line 2: "x" — r', 'not checked · "y" — r2'], { 'line 2: "x" — r': 'you' });
  assert.deepEqual(rows, [{ line: 2, text: 'x', why: 'r', by: 'you' }, { line: 0, text: 'y', why: 'r2' }]);
});

// ---- amendment D: the words of section 3.7 are the tag's ------------------------------------------------------------------------------------------------------------
test('D Must-fail 1: the group titles, the tail, the tags, the kind words and the reason toggle are section 3.7\'s words', () => {
  assert.deepEqual(LOOK, { checked: 'CHECKED', notChecked: 'NOT CHECKED', notCheckedTail: 'you judge these at Accept', suggested: 'SUGGESTED · add if you want it', everyLine: 'Every line' });
  const p = page();
  const plan = {
    lines: [{ n: 1, text: 'one', rules: [], checks: [{ name: 'at most 80 words', by: 'you', kind: 'truth', key: 'L1.~1' }, { name: 'the file exists', by: 'default', kind: 'file', key: 'L1.$floor' }, { name: 'tag', by: 'agent', kind: 'shape', key: 'L1.shape.tag', drop: true }] }, { n: 2, text: 'two', rules: [], checks: [] }],
    suggested: [{ key: 'L1.x', line: 1, text: 'Nonstop', dropped: true }], ncRows: [{ line: 1, text: 'tone', why: 'because', by: 'you' }, { line: 0, text: 'loose', by: 'agent' }], readNotes: [], alwaysOn: ['the model said done: true'],
  };
  const h = p.planViewHtml(plan, p.planControlHTML);
  const t = text(h);
  assert.match(t, /CHECKED · 3/);
  assert.match(t, /NOT CHECKED · 1 · you judge these at Accept/);
  assert.match(t, /SUGGESTED · add if you want it/);
  assert.match(t, /Every line/);
  assert.match(t, /▸ why/);
  assert.match(t, /Nonstop \(you dropped it\)/);
  assert.match(h, /data-by="you">\[you\]/);
  assert.deepEqual([...h.matchAll(/data-testid="ck-kind">([a-z]+)</g)].map((m) => m[1]).sort(), ['file', 'file', 'shape', 'truth', 'truth']);
  assert.ok(!/Always checked|Shape checks|other checks/.test(t), 'the old group words go');
  assert.equal(p.byTagOf('you').replace(/<[^>]*>/g, ''), ' ~ [you]');
  assert.equal(p.byTagOf('agent').replace(/<[^>]*>/g, ''), ' ! [agent]');
  assert.equal(p.byTagOf('default').replace(/<[^>]*>/g, ''), ' $ [default]');
  assert.equal(p.byTagOf('agent', 'shape').replace(/<[^>]*>/g, ''), ' ! [agent] [shape]');
});

test('D Must-fail 1 (readout): the readout tells CHECKED · n, NOT CHECKED · n · you judge these at Accept, SUGGESTED, EVERY LINE, rows `[tag]  kind  words`; the old `always:` and REFUSED / NOT CHECKED sections are not told', () => {
  const decl = {
    flowType: 'plain', inputFacts: {},
    steps: [{ fromLine: 1, emits: 'a1', goal: 'one', primitives: [], reads: [], close: { class: 'hitl' } }, { fromLine: 2, emits: 'a2', goal: 'two', primitives: [], reads: ['a1'], close: { class: 'softgreen', shape: { picked: [{ rule: 'maxWords', value: 80 }] } } }],
    checkList: [{ key: 'L2.~1', line: 2, kind: 'rule', by: 'you', state: 'built', part: { line: 2, part: 0 } }],
  };
  const out = buildReadout({ declaration: decl, arbiter: { sources: [], asks: [], sends: [], capUsd: 1 }, lines: [{ n: 1, text: 'a' }, { n: 2, text: 'b' }], name: 'x', modelId: 'm', costUsd: 0, rounds: 1, spendComplete: true, root: '/r', notChecked: ['line 2: "tone" — why'], notCheckedBy: { 'line 2: "tone" — why': 'you' }, suggested: [{ line: 2, text: 'Nonstop' }] });
  assert.match(out, /\n {5}CHECKED · 1\n {7}\[you\] {6}truth {2}at most 80 words\n {5}NOT CHECKED · 1 · you judge these at Accept\n {7}\[you\] {13}tone — why\n {5}SUGGESTED · add if you want it\n {7}\[agent\] {4}truth {2}Nonstop\n/);
  assert.match(out, /\n {2}EVERY LINE\n {5}CHECKED · 2\n {7}\[default\] {2}file {3}the output exists and isn't empty\n/);
  assert.ok(!/\nalways:|WRITE FENCE/.test(out));
});

test('D Must-fail 1 (Audit): the result word is at the right of the row, a failed row\'s reason is indented under it, a Not checked row has its why and no result word', () => {
  const p = page();
  const failed = p.auditCheckRowHtml({ text: 'line 2 · at most 80 words', by: 'you', kind: 'truth', result: 'failed', why: 'it has 90 words' });
  assert.match(failed, /class="ck-right">.*failed/);
  assert.match(failed, /class="hint ck-under" data-testid="audit-check-why">it has 90 words</);
  assert.match(failed, /data-testid="ck-kind">truth</);
  const nc = p.auditCheckRowHtml({ text: 'tone', by: 'you', result: 'not-checked', why: 'You chose to leave it Not checked.' });
  assert.ok(!/ck-right/.test(nc), 'a Not checked row has no result word');
  assert.match(nc, /▸ why/);
});

// ---- amendment D: a fwd row is not lost -----------------------------------------------------------------------------------------------------------------------------
const ASK_ITEM = `not checked · "exactly 3 bullets" — ${ASK_LINE_REASON}`;
const listDecl = () => ({
  steps: [{ fromLine: 1, emits: 'a1', goal: 'one', primitives: [], reads: [], close: { class: 'softgreen', shape: { picked: [{ rule: 'maxWords', value: 80 }] } } }],
  checkList: [{ key: 'L1.$floor', line: 1, kind: 'floor', by: 'default', state: 'built' }, { key: 'L1.~1', line: 1, kind: 'rule', by: 'you', state: 'built', part: { line: 1, part: 0 } }],
});

test('D Must-fail 2: an Ask line\'s `~` row, the action row, a Tickets filter row, a watch row and "How the page was read" are on the card and the Audit', () => {
  const p = page();
  const watch = 'run a ticket again when its state changes';
  const items = [ASK_ITEM, `not checked · "priority P1 only" — ${NO_VALUE_WHY}`, `not checked · "${watch}" — ${NO_VALUE_WHY}`];
  const by = Object.fromEntries(items.map((i) => [i, 'you']));
  // the card
  const html = p.planViewHtml({ lines: [{ n: 1, text: 'one', rules: [], checks: [] }], suggested: [], ncRows: ncRowsOf(items, by), readNotes: ['a note on how the page was read'], alwaysOn: [] });
  const t = text(html);
  for (const w of ['exactly 3 bullets', 'priority P1 only', watch, 'a note on how the page was read', 'How the page was read']) assert.ok(t.includes(w), `the card lost ${w}`);
  assert.ok(html.includes('you judge it at the Ask'), 'the Ask line\'s reason stays at the Ask');
  assert.match(text(p.actionRowHtml({ line: 5, by: 'agent' })), /line 5 writes everything before it ! \[agent\]/);
  // the Audit
  const a = auditChecksOf(listDecl(), [], { items: [...items, 'how the page was read · ignored'], by });
  assert.ok(a);
  const ours = a.notChecked.map((r) => `${r.text} ${r.why ?? ''}`).join('|');
  for (const w of ['exactly 3 bullets', 'priority P1 only', watch]) assert.ok(ours.includes(w), `the Audit lost ${w}`);
  assert.ok(ours.includes(ASK_LINE_REASON));
});

test('D Must-fail 2 (readout): a Tickets filter and a watch row are in the readout', () => {
  const out = buildReadout({ declaration: { flowType: 'tickets', inputFacts: {}, steps: [], ticketFilter: { priority: ['P1'] }, ticketWatch: ['state'] }, arbiter: { sources: [], asks: [], sends: [], capUsd: 1 }, lines: [], name: 'x', modelId: 'm', costUsd: 0, rounds: 1, spendComplete: true, root: '/r' });
  assert.match(out, /ticket filter: priority P1/);
  assert.match(out, /ticket watch: state/);
});

test('D Must-fail 3: the card and the Job tab read one model: the same signed Not checked items give the same rows from the one splitter', () => {
  const items = ['line 1: "tone" — You chose to leave it Not checked.', ASK_ITEM];
  const rows = ncRowsOf(items);
  const src = readFileSync(path.join(HERE, '../src/panel/author.js'), 'utf8') + readFileSync(path.join(HERE, '../src/panel/data.js'), 'utf8');
  assert.equal((src.match(/ncRowsOf\(/g) ?? []).length, 2, 'the card (author.js) and the Job tab (data.js) both read ncRowsOf; no second splitter');
  assert.deepEqual(rows.map((r) => r.text), ['tone', 'exactly 3 bullets']);
  const a = auditChecksOf(listDecl(), [], { items, by: {} });
  assert.ok(a && a.notChecked.length === 2, 'the Audit tells the same two rows');
});

// ---- amendment A: "at Accept" ---------------------------------------------------------------------------------------------------------------------------------------
test('A Must-fail 1: a list reason says "at Accept", never "at the Ask", for a rule that is not on an Ask line', () => {
  const rows = dropRows([{ line: 1, fact: 'Price', word: 'US dollars', reason: 'r1l', other: 'US dollars' }]);
  assert.ok(rows.length > 0);
  for (const w of [REASON.noPick, REASON.nothingOnPage, NO_GUARDRAIL_WORDS, NO_VALUE_WHY]) {
    assert.match(w, /judge it at Accept\.$/, w);
    assert.ok(!/at the Ask/.test(w), w);
  }
  assert.equal(REASON.noPick, 'No check was picked for it, so you judge it at Accept.');
  assert.equal(typeof dropLine, 'function');
  assert.equal(typeof lineRules, 'function');
});

test('A Must-fail 2: a rule on a signed Ask line keeps its reason, at the Ask', () => {
  assert.equal(ASK_LINE_REASON, 'you judge it at the Ask');
  assert.match(ASK_ITEM, /you judge it at the Ask$/);
});

// ---- amendment 2 (M19 am2): two S6 screen words beside section 3.7 --------------------------------------------------------------------------------------------------
test('am2 Must-fail 1: the card and Job tab legend equals the tag\'s words (bareloop v0.61.0 src/panel/index.html), never the old `every › check`', () => {
  // the tag's legend, frozen from bareloop src/panel/index.html@v0.61.0 (fc56e1f3); no bareloop checkout is read (CI has none)
  const fx = JSON.parse(readFileSync(path.join(HERE, 'fixtures/m19-legend-tag.json'), 'utf8'));
  assert.equal(fx.tag, 'v0.61.0');
  assert.ok(fx.legend, 'the tag has a legend');
  const legend = fx.legend;
  assert.equal(legend, 'Done when every check below passes');
  const ours = HTML.join('\n');
  assert.equal(ours.split(legend).length - 1, 1, 'the one plan view (card and Job tab) carries the tag\'s legend');
  assert.ok(!/Done when every ›/.test(ours), 'the old legend is gone');
  const h = page().planViewHtml({ lines: [{ n: 1, text: 'one', rules: [], checks: [{ name: 'a', by: 'you', kind: 'truth', key: 'L1.~1' }] }], suggested: [], ncRows: [], readNotes: [], alwaysOn: [] }, page().planControlHTML);
  assert.ok(text(h).includes(legend), 'the rendered card shows the legend');
});

test('am2 Must-fail 2: no card, Job tab or readout NOT CHECKED row starts with `not checked · `', () => {
  const items = ['not checked · "tone" — You chose to leave it Not checked.', `not checked · "exactly 3 bullets" — ${ASK_LINE_REASON}`, 'line 2: not checked · "x" — r'];
  for (const r of ncRowsOf(items)) assert.ok(!/^not checked · /.test(r.text), `row text "${r.text}"`);
  const h = page().planViewHtml({ lines: [{ n: 1, text: 'one', rules: [], checks: [] }], suggested: [], ncRows: ncRowsOf(items), readNotes: [], alwaysOn: [] });
  assert.ok(!/not checked ·/.test(text(h)), 'the card has no prefix');
  const decl = { flowType: 'plain', inputFacts: {}, steps: [{ fromLine: 1, emits: 'a1', goal: 'one', primitives: [], reads: [], close: { class: 'hitl' } }] };
  const nc = ['not checked · "tone" — why'];
  const out = buildReadout({ declaration: decl, arbiter: { sources: [], asks: [], sends: [], capUsd: 1 }, lines: [{ n: 1, text: 'a' }], name: 'x', modelId: 'm', costUsd: 0, rounds: 1, spendComplete: true, root: '/r', notChecked: nc, notCheckedBy: { [nc[0]]: 'you' } });
  assert.match(out, /NOT CHECKED · 1/);
  assert.match(out, /tone — why/);
  assert.ok(!/not checked ·\s+"?tone|not checked · "tone/.test(out.replace(/NOT CHECKED · \d+/g, '')), 'the readout row has no prefix');
});

test('am2 Must-fail 3: an Audit Not checked row keeps its `not checked · ` prefix', () => {
  const items = ['not checked · "tone" — You chose to leave it Not checked.'];
  const a = auditChecksOf(listDecl(), [], { items, by: { [items[0]]: 'you' } });
  assert.ok(a && a.notChecked.length === 1);
  assert.match(a.notChecked[0].text, /^not checked · /, 'the Audit row keeps the prefix');
});
