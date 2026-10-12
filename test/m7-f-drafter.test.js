// M7 piece 6: the drafter is told WHEN to reach for compress, peek and stash (and only those three),
// and only for a verb that is on its menu. The lines carry no number (am25 A5: no number in the prompt).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSystemPrompt } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';

const arbiter = { asks: [], sends: [], sources: [] };
const lines = [{ n: 1, text: 'do a thing', guardrail: null }];
const prompt = (menu) => buildSystemPrompt({ menu, lines, arbiter, factsInfo: [] });
const useLines = (p) => p.split('\n').filter((l) => /^- Use [a-z]+ /.test(l));

test('M7: the prompt carries a "when to use" line for compress, peek and stash, and for no other new verb', () => {
  const got = useLines(prompt(wiredMenu(['core'])));
  assert.equal(got.length, 3, got.join('\n'));
  for (const verb of ['compress', 'peek', 'stash']) assert.ok(got.some((l) => l.startsWith(`- Use ${verb} `)), verb);
  assert.ok(!/^- Use (recall|get|recent|related|impact|edit) /m.test(prompt(wiredMenu(['core']))));
});

test('M7: a verb that is not on the menu gets no line (the menu is the inventory)', () => {
  const menu = wiredMenu(['core']).filter((e) => e.verb !== 'compress');
  const got = useLines(prompt(menu));
  assert.equal(got.length, 2);
  assert.ok(!got.some((l) => l.startsWith('- Use compress')));
  assert.deepEqual(useLines(prompt(wiredMenu(['core']).filter((e) => ['read', 'write'].includes(e.verb)))), []);
});

test('M7: the added lines hold no digit', () => {
  for (const l of useLines(prompt(wiredMenu(['core'])))) assert.ok(!/[0-9]/.test(l), l);
});
