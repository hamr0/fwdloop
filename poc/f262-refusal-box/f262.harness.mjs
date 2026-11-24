// F262 ($0): typed {box, words} from the `fwdloop draft` child to the panel API. Runs inside the prototype root (test/f262.test.mjs).
// Real panel, real `bin/fwdloop draft` child (no injected provider), fake key, no provider call.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { keysForDoor } from '../src/keysfile.js';
import { killChildrenAfter, until, world, JOB } from './m4e-world.mjs';

killChildrenAfter();
const WORDS = 'Add at least one rule (~) for this job — for example what the result must include, or what must stay true.';
const ZERO = 'Read the notes and list the open items\nWrite a short summary';
const stopped = (w, id) => until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return j?.phase === 'stopped' ? j : null; }, 60000);
// a real child: drop the injected test provider so the CLI runs its own model/key/hold checks
const real = async (opts = {}) => { const w = await world(opts); delete w.env.FWDLOOP_TEST_DRAFT_PROVIDER; return w; };
const printed = (w, id) => readFileSync(path.join(w.dir(id), 'child.log'), 'utf8');
const rows = (w) => (existsSync(path.join(w.home, 'runs.jsonl')) ? readFileSync(path.join(w.home, 'runs.jsonl'), 'utf8').trim().split('\n').filter(Boolean) : []);

test('1 zero ~ -> job; no draft folder, no hold row', async () => {
  const w = await real();
  const r = await w.post('/api/author/draft', w.card({ job: ZERO }));
  assert.equal(r.status, 202, r.text);
  const id = r.json().draftId;
  const s = await stopped(w, id);
  assert.deepEqual(s.refusal, { box: 'job', words: WORDS });
  assert.ok(printed(w, id).includes(`fwdloop: draft refused at $0 — ${WORDS}\n`), 'the CLI printed the same words');
  assert.equal(existsSync(path.join(w.dir(id), 'draft')), false, 'no draft folder');
  assert.equal(rows(w).length, 0, 'no hold or spend row');
});

test('2 monthly limit -> capUsd', async () => {
  const w = await real({ limit: 0.001, authorOpts: { skipMonthly: true } });
  const r = await w.post('/api/author/draft', w.card({ job: JOB }));
  assert.equal(r.status, 202, r.text);
  const s = await stopped(w, r.json().draftId);
  assert.equal(s.refusal.box, 'capUsd');
  assert.match(s.refusal.words, /^Max \$0\.00 left this month/);
  assert.ok(printed(w, r.json().draftId).includes(`fwdloop: ${s.refusal.words}\n`), 'words = the CLI line');
  assert.equal(existsSync(path.join(w.dir(r.json().draftId), 'draft')), false, 'no draft folder');
});

test('3 key the child cannot find -> model', async () => {
  const w = await real();
  // the panel lists the key by name (so its own card check passes); the keys file and the shell env hold no value for the child
  writeFileSync(path.join(w.home, '.env'), '', { mode: 0o600 });
  const names = ['DEEPSEEK_API_KEY'];
  const h2 = await w.open();
  void h2;
  // second panel whose loadEnv claims the key name only
  const { createPanelServer } = await import('../src/panel/server.js');
  const { remember } = await import('../scripts/panel-fixtures/panel-auth.mjs');
  const { rq } = await import('./m4e-world.mjs');
  const env = { ...w.env };
  const real2 = remember(await createPanelServer({ port: 0, root: w.root, settings: { home: w.home, env: {} }, author: { loadEnv: () => ({ ...keysForDoor({ env, keysHome: w.home }), ok: true, refusal: null, keyNames: names, env }) } }));
  const r = await rq(real2.port, { method: 'POST', url: '/api/author/draft', body: w.card({ job: JOB }) });
  assert.equal(r.status, 202, r.text);
  const id = r.json().draftId;
  const s = await until(async () => { const j = (await rq(real2.port, { url: `/api/author/${id}` })).json(); return j?.phase === 'stopped' ? j : null; }, 60000);
  assert.equal(s.refusal.box, 'model');
  assert.ok(printed(w, id).includes(`fwdloop: draft refused at $0 — ${s.refusal.words}\n`), 'words = the CLI line');
  await real2.close();
});

test('4 empty input file -> inputs', async () => {
  const w = await real();
  writeFileSync(path.join(w.inDir, 'jd.md'), '');
  const r = await w.post('/api/author/draft', w.card({ job: JOB }));
  assert.equal(r.status, 202, r.text);
  const id = r.json().draftId;
  const s = await stopped(w, id);
  assert.equal(s.refusal.box, 'inputs');
  assert.match(s.refusal.words, /^input "jd": ".*jd\.md" is empty$/);
  assert.ok(printed(w, id).includes(`fwdloop: draft refused at $0 — ${s.refusal.words}\n`), 'words = the CLI line');
});
