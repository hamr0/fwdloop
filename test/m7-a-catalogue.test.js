// M7 piece 1 (docs/wiki/the-module-ladder.md, "M7 scope — SIGNED", item 1): the nine
// in-run tools are catalogue verbs, each resolving against the real installed package;
// item 2: remember and forget stay behind the unsigned "memory" skill.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCatalogue, resolveEntry } from '../src/catalogue.js';

const NINE = ['edit', 'recall', 'get', 'recent', 'related', 'impact', 'compress', 'peek', 'stash'];

test('M7: the nine signed in-run tools are all in the catalogue, skill core', () => {
  const cat = loadCatalogue();
  assert.equal(cat.ok, true);
  for (const verb of NINE) {
    const e = cat.primitives.find((x) => x.verb === verb);
    assert.ok(e, `catalogue has no "${verb}"`);
    assert.equal(e.skill, 'core', `${verb} must be a core skill verb`);
  }
});

test('M7: every one of the nine resolves against the installed package', async () => {
  const cat = loadCatalogue();
  for (const verb of NINE) {
    const r = await resolveEntry(cat.primitives.find((x) => x.verb === verb));
    assert.equal(r.resolved, true, `${verb}: ${r.reason}`);
  }
});

test('M7: remember and forget stay behind the "memory" skill, which a core-only flow never signs', () => {
  const cat = loadCatalogue();
  for (const verb of ['remember', 'forget']) {
    assert.equal(cat.primitives.find((x) => x.verb === verb).skill, 'memory');
  }
});
