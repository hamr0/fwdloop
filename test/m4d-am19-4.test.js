// M4d amendment 19, item 4: the tool words are true (docs/wiki/the-module-ladder.md). $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { world, killChildrenAfter, until } from './m4e-world.mjs';
import {
  tmp, spendRow, newHome, cli, proseAt, finish,
} from './m4d-am19-helpers.mjs';
import { job2Fixture } from './drafter-fixture.mjs';

killChildrenAfter();
import { loadCatalogue } from '../src/catalogue.js';
import { buildSystemPrompt } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';

test('4: recall, impact and related say code and markdown files only; recent says it finds nothing inside a run; get, peek, stash are unchanged; the drafter prompt carries them', () => {
  const cat = loadCatalogue().primitives;
  const desc = (v) => cat.find((e) => e.verb === v).desc;
  for (const v of ['recall', 'impact', 'related']) assert.match(desc(v), /code and markdown files only/, v);
  assert.match(desc('recent'), /finds nothing inside a run/);
  assert.equal(desc('get'), 'Fetch the full text of one parked item by its id, or one part of a file by the pointer recall gave.');
  assert.equal(desc('stash'), 'Park a large piece of text outside the prompt under an id, to fetch back later.');
  assert.equal(desc('peek'), "Preview a parked item's start and end without loading all of it.");
  const prompt = buildSystemPrompt({ menu: wiredMenu(['core']), lines: [{ n: 1, text: 'x', guardrail: null }], arbiter: { asks: [], sends: [], sources: [] }, factsInfo: [] });
  assert.match(prompt, /- recall: .*code and markdown files only/);
  assert.match(prompt, /- recent: .*finds nothing inside a run/);
});
