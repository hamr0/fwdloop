// M10 piece 6 item 4: vetCard's "cap not above what is already spent" check (M4d am24) also guards Revise and the answer redraft, not only Start over. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { world, killChildrenAfter, until, HERE } from './m4e-world.mjs';
import { isFwdloopAlive } from '../src/liveness.js';
import { spendRow, finish } from './m4d-am19-helpers.mjs';
import { raw } from './fixtures/m10-map/load.mjs';

killChildrenAfter();
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm10-map');
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const SAY = /^The cap must be above what is already spent \(at least \$\d+\.\d\d\)\.$/;

test('Revise with a Cap at or below what the draft already spent is refused 400 with the Cap note words; no revise starts', async () => {
  const w = await world({ limit: 0.5 });
  const { id } = await finish(w);
  writeFileSync(path.join(w.dir(id), 'draft', 'spend.jsonl'), spendRow(0.12));
  const r = await w.post(`/api/author/${id}/revise`, w.card({ capUsd: 0.12 }));
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json().refused, 'card');
  assert.equal(r.json().refusals[0].field, 'capUsd');
  assert.match(r.json().refusals[0].say, SAY);
  assert.equal(existsSync(path.join(w.dir(id), 'card-1.json')), false, 'no revise was made');
});

test('the answer that redrafts, with a Cap at or below what the draft already spent, is refused 400 and the answer is not saved', async () => {
  const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['Select flight'] }] });
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt') } });
  const jobOf = (rules) => ['Read my resume,', ...rules.map((r) => `~ ${r}`), 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ 3 sections, all under 600 words', 'Ask 30m: check it with me,', '~ nothing goes out before I accept', 'and once I accept, write it out.'].join('\n');
  const job = jobOf(['under $150', 'not a red-eye', 'nonstop']);
  const card = w.card({ flowName: 'job2', job, inputs: `${w.card().inputs}\nflights: ${ADDRESS}` });
  const id = (await w.post('/api/author/draft', card)).json().draftId;
  const s = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['questions-open', 'green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(s.phase, 'questions-open', JSON.stringify(s));
  const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8'));
  await until(() => isFwdloopAlive(p.pid, p.procStart) !== true);
  writeFileSync(path.join(w.dir(id), 'draft', 'spend.jsonl'), spendRow(0.30));
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'agree' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json().refusals[0].field, 'capUsd');
  assert.match(r.json().refusals[0].say, SAY);
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), false, 'a refused redraft leaves the question open');
});
