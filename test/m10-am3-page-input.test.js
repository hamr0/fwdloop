// M10 amendment 3 (docs/wiki/the-module-ladder.md): a web page's address is signed with the job, never typed per run.
// Spelling of the signed line: `guardrail: source <role> = page:<http(s) address>`. Written red-first; each forced red is named in the commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { parseSignedText } from '../src/signed-text.js';
import { cardFields, cardToProse, checkCard } from '../src/panel/authorcard.js';
import { BOX_JOB } from './m4e-box-fixture.mjs';

const URL1 = 'https://www.google.com/travel/flights?q=BOS:CHI&d=2026-11-01';
const block = (line) => `1. Read it,\n\nArbiter guardrails:\nguardrail: cap $0.25 per run\nguardrail: ${line}\n`;

function scene() {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10am3-'));
  const root = path.join(work, 'flows'); const outDir = path.join(work, 'out'); const inDir = path.join(work, 'in');
  for (const d of [root, outDir, inDir]) mkdirSync(d);
  writeFileSync(path.join(inDir, 'resume.md'), '# R\n');
  const card = (inputs) => cardFields({ flowName: 'job2', job: BOX_JOB, capUsd: '0.25', askWait: '1h', destination: outDir, inputs });
  return { root, inDir, card };
}

test('the signed line `source <role> = page:<address>` parses to a page source; a file line is unchanged', () => {
  const p = parseSignedText(block(`source flights = page:${URL1}`));
  assert.equal(p.ok, true, JSON.stringify(p.reds));
  assert.deepEqual(p.arbiter.sources, [{ role: 'flights', kind: 'page', path: URL1 }]);
  const f = parseSignedText(block('source resume = file:/tmp/x.md'));
  assert.deepEqual(f.arbiter.sources, [{ role: 'resume', kind: 'file', path: '/tmp/x.md' }]);
});

test('page: with a non-web address or nothing is a red; two sources on one line is a red', () => {
  for (const bad of ['page:/tmp/x', 'page:ftp://x/y', 'page:', 'page:https://']) {
    const p = parseSignedText(block(`source flights = ${bad}`));
    assert.equal(p.ok, false, bad);
  }
  assert.equal(parseSignedText(block(`source a = page:${URL1}; source b = page:${URL1}`)).ok, false);
});

test('card: `name: https://...` is a page input written as page:, never file:https; files beside it are unchanged', () => {
  const s = scene();
  const file = path.join(s.inDir, 'resume.md');
  const r = checkCard(s.card(`resume: ${file}\nflights: ${URL1}`), { root: s.root });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.prose.includes(`guardrail: source resume = file:${file}\n`));
  assert.ok(r.prose.includes(`guardrail: source flights = page:${URL1}\n`));
  assert.ok(!r.prose.includes('file:http'));
  assert.deepEqual(parseSignedText(r.prose).arbiter.sources.map((x) => x.kind), ['file', 'page']);
  assert.ok(cardToProse(s.card(`flights: ${URL1}`)).includes('source flights = page:'));
});

test('card: malformed lines refuse with today\'s words; a bad address is refused by line', () => {
  const s = scene();
  const f = (inputs) => { const r = checkCard(s.card(inputs), { root: s.root }); return r.ok ? [] : r.refusals.map((x) => `${x.field}:${x.say}`); };
  assert.match(f('flights').join('|'), /^inputs:Line 1: write it as name: path/);
  assert.match(f('flights https://x.com/a')[0], /^inputs:Line 1: The role "flights https" must be lowercase/, 'a missing colon splits at the one in https: today\'s role refusal');
  assert.match(f(`Flights!: ${URL1}`)[0], /^inputs:Line 1: The role "Flights!"/);
  assert.match(f(`flights: ${URL1}\nflights: ${URL1}`)[0], /^inputs:Line 2: The role "flights" is used twice/);
  assert.match(f('flights: https://').join('|'), /Line 1:/);
  assert.match(f('flights: relative/file.md')[0], /must be a full path/);
});
