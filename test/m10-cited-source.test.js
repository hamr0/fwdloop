// M10 piece 4: a cited check reads the RUN's own frozen copy, sha-checked against inputs.json - never the drafting copy. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { freezeInputs, freezePage } from '../src/runner.js';
import { readRunSource } from '../src/cited-source.js';
import { PAGE, CHEAT_REVERSED } from './fixtures/m10-map/load.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), `fwdloop-m10-src-${p}-`));
const pageSeam = (text) => async (url) => ({ ok: true, text, url });

test('the run reads its OWN frozen copy: a page that changed between drafting and the run is the run\'s page, not the drafting one', async () => {
  const draft = tmp('draft');
  const run = tmp('run');
  try {
    const d = await freezePage(draft, 'flights', 'https://example.test/f', { fetchPage: pageSeam(PAGE) });
    assert.equal(d.ok, true);
    const r = await freezeInputs(run, [{ id: 'flights', path: 'https://example.test/f' }], { fetchPage: pageSeam(CHEAT_REVERSED) });
    assert.equal(r.ok, true);
    const got = readRunSource(run, 'flights');
    assert.equal(got.ok, true, got.red);
    assert.equal(got.text, CHEAT_REVERSED, 'the run\'s own page');
    assert.notEqual(got.text, PAGE, 'not the drafting copy');
    assert.equal(got.sha256, r.manifest[0].sha256);
  } finally { rmSync(draft, { recursive: true, force: true }); rmSync(run, { recursive: true, force: true }); }
});

test('a frozen copy edited after it was frozen is refused by name, never read', async () => {
  const run = tmp('run');
  try {
    const r = await freezeInputs(run, [{ id: 'flights', path: 'https://example.test/f' }], { fetchPage: pageSeam(PAGE) });
    writeFileSync(r.manifest[0].frozen, PAGE.replace('Nonstop', 'Nonstop!'));
    const got = readRunSource(run, 'flights');
    assert.equal(got.ok, false);
    assert.match(got.red, /input "flights": the frozen copy changed since it was frozen/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('no frozen inputs, an unknown role, a missing file and a spreadsheet are each refused with their own words', async () => {
  const run = tmp('run');
  try {
    assert.match(readRunSource(run, 'flights').red, /this run has no frozen inputs/);
    const r = await freezeInputs(run, [{ id: 'flights', path: 'https://example.test/f' }], { fetchPage: pageSeam(PAGE) });
    assert.match(readRunSource(run, 'hotels').red, /froze no input with that name/);
    rmSync(r.manifest[0].frozen);
    assert.match(readRunSource(run, 'flights').red, /the frozen copy is missing/);
    mkdirSync(join(run, 'inputs'), { recursive: true });
    writeFileSync(join(run, 'inputs.json'), JSON.stringify([{ id: 'aging', source: 'a.csv', frozen: join(run, 'inputs', 'aging.csv'), sha256: 'x', bytes: 1 }]));
    assert.match(readRunSource(run, 'aging').red, /a quote can be checked against a web page, a text file or a .docx here, not "aging.csv"/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('a markdown / text doc input is served the same way', async () => {
  const run = tmp('run');
  const src = tmp('src');
  try {
    const f = join(src, 'notes.md');
    writeFileSync(f, '# Notes\nship 3 things\n');
    const r = await freezeInputs(run, [{ id: 'notes', path: f }]);
    assert.equal(r.ok, true);
    const got = readRunSource(run, 'notes');
    assert.equal(got.ok, true, got.red);
    assert.equal(got.text, '# Notes\nship 3 things\n');
  } finally { rmSync(run, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); }
});
