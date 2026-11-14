// M13 am10: a skipped Tickets run points at "Run it anyway" only where the panel has it (a job with a new-ticket schedule). Real panel data path (getRunDetail), $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync } from 'node:fs';

import { loadCatalogue } from '../src/catalogue.js';
import { getRunDetail } from '../src/panel/data.js';
import { p5World } from './m13-p5-world.mjs';

const nextOf = (w) => getRunDetail({ root: w.root, flow: 'tk', runId: 'run-1', catalogue: loadCatalogue().primitives, triggerRead: (f) => w.door.read(f) }).summary.ended;

test('By hand (no schedule): the skipped run says only "Nothing to do." and points at no button', (t) => {
  const w = p5World();
  t.after(() => rmSync(w.dir, { recursive: true, force: true }));
  w.run('run-1', { ticket: 4, rows: [['skipped', w.clock.t]] });
  const e = nextOf(w);
  assert.equal(e.next, 'Nothing to do.');
  assert.match(e.reason, /^.*Skipped: /);
});

test('a new-ticket schedule: the skipped run keeps the pointer, byte for byte', (t) => {
  const w = p5World();
  t.after(() => rmSync(w.dir, { recursive: true, force: true }));
  w.sign();
  w.run('run-1', { ticket: 4, rows: [['skipped', w.clock.t]] });
  assert.equal(nextOf(w).next, 'Nothing to do. Run it anyway from the ticket list in the Result tab.');
});
