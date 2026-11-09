// M10 amendment 16 (2): code keeps a suggested check only if its rule is on bareguard's list, every number is one the guardrail names and every word is a
// word of the guardrail. Also: the scope by code, the plain words of each rule, the answer form, the asks' words. am14 (2) and am15's tests live on here as keep-or-drop tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  keepOrDrop, codeScope, scopedRules, plainWords, rowsFromAnswer, checkAsks, SUGGEST_SCHEMA, SUGGEST_SYSTEM, suggestUserText, OFFERED, CANT_CHECK_WORDS,
} from '../src/checkpick.js';

const kept = (g, s) => { const r = keepOrDrop(g, s); assert.equal(r.kept, true, JSON.stringify(r)); return r.check; };
const dropped = (g, s, why) => { const r = keepOrDrop(g, s); assert.equal(r.kept, false, `kept ${JSON.stringify(r)}`); if (why) assert.match(r.why, why); };

test('keep: the checks F144c proved are kept, with exactly their own fields', () => {
  assert.deepEqual(kept('under 80 words', { line: 5, guardrail: 1, rule: 'maxWords', value: 80 }), { rule: 'maxWords', value: 80 });
  assert.deepEqual(kept('exactly 3 bullets', { rule: 'listItems', value: 3 }), { rule: 'listItems', value: 3 });
  assert.deepEqual(kept('3 sections: Work History, Professional Skills, Soft Skills, all under 600 words', { rule: 'sections', names: ['Work History', 'Professional Skills', 'Soft Skills'] }).names.length, 3);
  assert.deepEqual(kept('3 sections, about 180 words each, under 600 words', { rule: 'maxWords', value: 600 }), { rule: 'maxWords', value: 600 });
});

test('drop: a rule that is not on bareguard\'s list, or on it but not offered', () => {
  dropped('under 80 words', { rule: 'maxChars', value: 80 }, /not on bareguard's list/);
  dropped('under 80 words', { rule: 'cells', value: 80 }, /not offered/);
  dropped('under 80 words', { rule: 'none' }, /^none$/);
  dropped('under 80 words', null, /unreadable/);
});

test('drop: a number the guardrail never names (am14 (2): F137 shape, a made-up 80 on "exactly 3 bullets")', () => {
  dropped('exactly 3 bullets', { rule: 'maxWords', value: 80 }, /not a number the guardrail names/);
  dropped('under 80 words', { rule: 'maxWords', value: 99 }, /99/);
  dropped('3 sections, about 180 words each, under 600 words', { rule: 'maxWords', value: 180 }, /180/); // 180 is a per-section size, not the whole output's
  dropped('exactly 3 bullets', { rule: 'listItems', value: 0 }, /whole number/);
  dropped('exactly 3 bullets', { rule: 'listItems', value: 3.5 }, /whole number/);
});

test('drop: a word the guardrail never names (am15: F138 draft 2 made up "job")', () => {
  dropped('exactly 3 bullets', { rule: 'mustCarry', phrases: ['job'] }, /not in the guardrail's words/);
  dropped('3 sections: Work History, Professional Skills, Soft Skills, all under 600 words', { rule: 'sections', names: ['Work History', 'Summary', 'Soft Skills'] }, /Summary/);
  dropped('under 100 words', { rule: 'sections', names: ['Summary'] });
});

test('keep/drop: mustCarry words of the guardrail pass (word edges, any case); a part of a word does not; a per-invoice size is the guardrail\'s own number', () => {
  const g = 'Each invoice has 3 lines per invoice, with a Total and a due date';
  assert.deepEqual(kept(g, { rule: 'blockLines', size: 3, phrases: ['total', 'Due Date'] }), { rule: 'blockLines', size: 3, phrases: ['total', 'Due Date'] });
  dropped(g, { rule: 'blockLines', size: 3, phrases: ['tot'] }, /word "tot"/);
  dropped(g, { rule: 'blockLines', size: 3, phrases: ['totals'] });
  dropped(g, { rule: 'blockLines', size: 4, phrases: ['total'] }, /size 4/);
});

test('drop: a section count that differs from the guardrail\'s, a field the rule does not take, a missing required field, an empty list', () => {
  dropped('3 sections: Work History, Professional Skills, Soft Skills, all under 600 words', { rule: 'sections', names: ['Work History', 'Professional Skills'] }, /3 sections/);
  dropped('under 80 words', { rule: 'maxWords', value: 80, names: ['x'] }, /does not take names/);
  dropped('under 80 words', { rule: 'maxWords' }, /needs value/);
  dropped('3 sections: A, B, C', { rule: 'sections', names: [] }, /list of words/);
  dropped('3 sections: A, B, C', { rule: 'sections', names: ['A', ' '] }, /list of words/);
});

test('the filter holds rule, number and word only: a wrong meaning with the right number is kept (the prompt\'s job, F144c "wrong kept")', () => {
  assert.equal(keepOrDrop('exactly 3 bullets', { rule: 'maxLines', value: 3 }).kept, true);
});

test('scope by code: a CSV or page input routes its guardrails elsewhere unless the guardrail is a count (word number, items, sections)', () => {
  const csv = [{ kind: 'file', role: 'a', path: '/x/a.csv' }];
  const page = [{ kind: 'page', role: 'p', path: 'https://x.test/' }];
  const doc = [{ kind: 'file', role: 'd', path: '/x/n.md' }];
  assert.equal(codeScope(csv, 'Amount over 500'), 'out');
  assert.equal(codeScope(page, 'under $40'), 'out');
  assert.equal(codeScope(page, 'under 100 words'), 'in'); // the F144b caveat: a page job whose guardrail carries a word number counts as in
  assert.equal(codeScope(page, 'exactly 3 bullets'), 'in'); // M10 am23
  assert.equal(codeScope(doc, 'exactly 3 bullets'), 'in');
  assert.equal(codeScope([], 'exactly 3 bullets'), 'in');
});

test('scoped rules: step lines only (no ask or send line), rule numbers as the line numbers them, a repeated rule once', () => {
  const lines = [
    { n: 1, text: 'Write notes', guardrail: 'exactly 3 bullets; under 80 words; Under 80 words' },
    { n: 2, text: 'Ask: check', guardrail: 'under 5 words' },
    { n: 3, text: 'Write it out', guardrail: 'under 7 words' },
    { n: 4, text: 'Plain', guardrail: '' },
  ];
  const arbiter = { asks: [{ line: 2 }], sends: [{ line: 3 }], sources: [] };
  assert.deepEqual(scopedRules(lines, arbiter), [{ line: 1, rule: 1, text: 'exactly 3 bullets' }, { line: 1, rule: 2, text: 'under 80 words' }]);
  const routed = { ...arbiter, sources: [{ kind: 'page', role: 'p', path: 'https://x.test/' }] };
  // M10 am23: a count (bullets here) is in scope on a routed job too
  assert.deepEqual(scopedRules(lines, routed), [{ line: 1, rule: 1, text: 'exactly 3 bullets' }, { line: 1, rule: 2, text: 'under 80 words' }]);
});

test('plain words: one fixed phrase per offered rule', () => {
  const says = {
    nonEmpty: plainWords({ rule: 'nonEmpty' }),
    maxWords: plainWords({ rule: 'maxWords', value: 80 }),
    minWords: plainWords({ rule: 'minWords', value: 5 }),
    maxLines: plainWords({ rule: 'maxLines', value: 4 }),
    listItems: plainWords({ rule: 'listItems', value: 3 }),
    sections: plainWords({ rule: 'sections', names: ['A', 'B'] }),
    sectionOrder: plainWords({ rule: 'sectionOrder', names: ['A', 'B'] }),
    sectionWords: plainWords({ rule: 'sectionWords', names: ['A', 'B'], wordsPerSection: 90 }),
    mustCarry: plainWords({ rule: 'mustCarry', phrases: ['x', 'y'] }),
    blockLines: plainWords({ rule: 'blockLines', size: 3, phrases: ['x'] }),
  };
  assert.deepEqual(Object.keys(says), [...OFFERED].sort((a, b) => Object.keys(says).indexOf(a) - Object.keys(says).indexOf(b)));
  assert.equal(says.maxWords, 'at most 80 words');
  assert.equal(says.listItems, 'exactly 3 list items');
  assert.equal(says.sections, 'sections named A, B');
  assert.equal(says.blockLines, 'blocks of 3 lines, each carrying x');
  assert.equal(new Set(Object.values(says)).size, OFFERED.length);
});

test('the answer form: one variant per offered rule plus none, only that rule\'s own fields, no id/field/strict/text, nothing else allowed', () => {
  const v = SUGGEST_SCHEMA.properties.checks.items.anyOf;
  assert.equal(v.length, OFFERED.length + 1);
  for (const x of v) {
    assert.equal(x.additionalProperties, false);
    for (const banned of ['id', 'field', 'strict', 'text']) assert.equal(banned in x.properties, false, `${x.properties.rule.const} offers ${banned}`);
  }
  const words = v.find((x) => x.properties.rule.const === 'maxWords');
  assert.deepEqual(Object.keys(words.properties).sort(), ['guardrail', 'line', 'rule', 'value']);
  assert.deepEqual(words.required.sort(), ['guardrail', 'line', 'rule', 'value']);
});

test('the prompt names the checks the checker can run and the user text sends only the scoped guardrails, numbered by rule', () => {
  assert.match(SUGGEST_SYSTEM, /listItems/);
  assert.match(SUGGEST_SYSTEM, /Do not set id, field, strict or text/);
  const t = suggestUserText([{ n: 1, text: 'Write notes' }, { n: 2, text: 'Plain' }], [{ line: 1, rule: 2, text: 'under 80 words' }]);
  assert.equal(t, 'The job:\n1. Write notes\n   g2: under 80 words\n2. Plain');
});

test('rows: one per scoped guardrail; a missing entry is dropped as "no entry"; an entry for a guardrail not sent is ignored', () => {
  const scoped = [{ line: 1, rule: 1, text: 'exactly 3 bullets' }, { line: 1, rule: 2, text: 'under 80 words' }];
  const rows = rowsFromAnswer(scoped, { checks: [{ line: 1, guardrail: 1, rule: 'listItems', value: 3 }, { line: 9, guardrail: 1, rule: 'maxWords', value: 1 }] });
  assert.deepEqual(rows.map((r) => [r.line, r.rule, r.check, r.why]), [[1, 1, { rule: 'listItems', value: 3 }, null], [1, 2, null, 'no entry']]);
  assert.deepEqual(rowsFromAnswer(scoped, null).map((r) => r.why), ['no entry', 'no entry']);
});

test('asks: a kept check is `Line n, guardrail "<...>": I propose <plain words>.`; nothing kept is `I can\'t check this. Your own words, or Not checked?`; only the second counts', () => {
  const rows = [
    { line: 3, rule: 1, text: 'exactly 3 bullets', check: { rule: 'listItems', value: 3 }, why: null },
    { line: 5, rule: 1, text: 'tone is warm', check: null, why: 'none' },
  ];
  const [a, b] = checkAsks(rows);
  assert.match(a.question, /^Line 3, guardrail "exactly 3 bullets": I propose exactly 3 list items\. /);
  assert.equal(a.ask, 'check'); assert.equal(a.counted, false); assert.equal(a.reading, 'exactly 3 list items'); assert.deepEqual(a.check, { rule: 'listItems', value: 3 });
  assert.match(b.question, /^Line 5, guardrail "tone is warm": I can't check this\. Your own words, or Not checked\? /);
  assert.ok(b.question.includes(CANT_CHECK_WORDS));
  assert.equal(b.ask, 'no-check'); assert.equal(b.counted, true); assert.equal(b.check, undefined);
});
