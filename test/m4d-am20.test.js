// M4d amendment 19 item 5 + amendment 20: ONE function writes the cap-too-small sentence; "drafting" on the Chat card and in the drafter, "run" for Run a signed flow and Resume.
// The "needs at least $… per run" words are gone. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capTooSmallText } from '../src/draftspend.js';
import { draft } from '../src/drafter.js';
import { ceilingCostUsd } from '../src/provider.js';
import { MODEL, job2Fixture, validArgs, fakeProvider, toolReply } from './drafter-fixture.mjs';
import { world, killChildrenAfter } from './m4e-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const want = (kind, cap, min) => `Cap ${cap} is below one ${kind} round's worst case for fake-ticked, ${min}. Raise Cap $ or pick another model.`;

test('the writer: only "drafting" / "run" differs', () => {
  assert.equal(capTooSmallText('drafting', 0.1, 0.224, 'claude-sonnet-5-5'), "Cap $0.10 is below one drafting round's worst case for claude-sonnet-5-5, $0.2240. Raise Cap $ or pick another model.");
  assert.equal(capTooSmallText('run', 0.001, 0.05, 'fake-ticked'), "Cap $0.001 is below one run round's worst case for fake-ticked, $0.0500. Raise Cap $ or pick another model.");
});

test('the drafter\'s own refusal is the writer\'s sentence (same words, proved equal)', async () => {
  const BIG = { in: 0.003, out: 0.008 };
  const fx = job2Fixture();
  const r = await draft({ proseText: fx.prose.replace('guardrail: cap $0.25 per run', 'guardrail: cap $0.10 per run'), provider: fakeProvider([toolReply(validArgs())]), rates: BIG, modelId: MODEL });
  assert.equal(r.reds[0], capTooSmallText('drafting', 0.1, ceilingCostUsd(BIG), MODEL));
});

test('Chat card: a cap under the floor is refused with the signed drafting sentence, at the draft door and in the Cap note', async () => {
  const w = await world();
  const r = await w.post('/api/author/draft', w.card({ capUsd: '0.04' }));
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json().refusals.find((x) => x.field === 'capUsd').say, want('drafting', '$0.04', '$0.0500'));
  const note = (await w.get('/api/author/monthly-check?cap=0.04&provider=DEEPSEEK_API_KEY&model=fake-ticked')).json();
  assert.equal(note.floorText, want('drafting', '$0.04', '$0.0500'));
});

test('Run a signed flow and Resume: the same sentence with "run" in place of "drafting"', async () => {
  const w = await world();
  await w.signedFlow();
  w.seedPassed('job2');
  for (const url of ['/api/author/run-prepare', '/api/author/run']) {
    const r = await w.post(url, { flow: 'job2', inputs: w.inputs(), capUsd: '0.02' });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json().refusals.find((x) => x.field === 'capUsd').say, want('run', '$0.02', '$0.0500'), url);
  }
  const note = (await w.get('/api/author/monthly-check?cap=0.02&flow=job2&kind=run')).json();
  assert.equal(note.floorText, want('run', '$0.02', '$0.0500'));
  const f = (await w.get('/api/author/flows')).json().flows[0];
  assert.equal(f.capFloorUsd, 0.05);
  assert.equal(f.floorModel, 'fake-ticked');
  assert.equal(f.floorText, undefined, 'the sentence names the typed cap, so the server writes it per cap (monthly-check), never as a fixed string');
});

test('"needs at least" is gone from src and test', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const hits = [...walk(path.join(HERE, '..', 'src')), ...walk(HERE)].filter((f) => /\.(js|mjs|html)$/.test(f) && !f.endsWith('m4d-am20.test.js'))
    .filter((f) => /needs at least \$/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(path.join(HERE, '..'), f));
  assert.deepEqual(hits, []);
});
