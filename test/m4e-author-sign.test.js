// M4e piece 2b, items 1-2 and 4-5 (docs/wiki/the-module-ladder.md, "M4e", scope 3-4, 7; negatives (i) (ii) (vi) (vii) (viii) (ix)
// (xiii)): sign-prepare and sign on the panel backend, over real HTTP. A draft is made by the real `fwdloop draft` child with the
// test provider, signed by the SAME `signDraft` as `fwdloop sign`, and the run it starts is the real `fwdloop run` child with
// the test model step. $0, scratch HOME/config home, every child killed, every dir removed.
// (xiii) the CLI `fwdloop sign` TTY rule is unchanged: test/authoring.test.js "cli sign: piped stdin (no TTY) is refused by name".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, readdirSync, writeFileSync, rmSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { readFlow } from '../src/flow.js';
import { REFUSAL_SENTENCE } from '../src/monthly.js';
import { chmodSentence } from '../src/keysfile.js';
import {
  CANARY, killChildrenAfter, rq, until, world,
} from './m4e-world.mjs';

killChildrenAfter();

const phaseOf = (w, id, phases) => until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return phases.includes(j?.phase) ? j : null; });
/** A world with one GREEN draft: its id, the hash and the folder. */
async function greenWorld(opts) {
  const w = await world(opts);
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const g = await phaseOf(w, id, ['green', 'red', 'stopped']);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  return { w, id, hash: g.hash, dir: w.dir(id) };
}
const rootListing = (w) => readdirSync(w.root).sort();
const snapshot = (w, dir) => JSON.stringify([rootListing(w), w.starts(), existsSync(path.join(dir, 'signed.json')), readdirSync(dir).sort()]);
const signBody = (hash, over = {}) => ({ hash, ...over });

test('(1) sign-prepare (the first click): a green draft returns the readout, the hash from spec.hash, the flow name and the cap — and writes nothing', async () => {
  const { w, id, hash, dir } = await greenWorld();
  const before = snapshot(w, dir);
  const r = await w.post(`/api/author/${id}/sign-prepare`, {});
  assert.equal(r.status, 200, r.text);
  const j = r.json();
  assert.equal(j.hash, hash);
  assert.equal(j.hash, readFileSync(path.join(dir, 'draft', 'spec.hash'), 'utf8').trim());
  assert.equal(j.flowName, 'job2');
  assert.equal(j.capUsd, 0.25);
  assert.match(j.readout, /DRAFT READOUT/);
  assert.ok(j.runId.length > 5, 'a run id is suggested');
  assert.equal(snapshot(w, dir), before, 'nothing written');
  // not green: unknown id, a draft that is still drafting, a red one
  assert.equal((await w.post('/api/author/d-0000000000-0000/sign-prepare', {})).status, 404);
  const h = await world({ mode: 'hang' });
  const hid = (await h.post('/api/author/draft', h.card())).json().draftId;
  const p = await h.post(`/api/author/${hid}/sign-prepare`, {});
  assert.equal(p.status, 409);
  assert.equal(p.json().refused, 'not-green');
  const bad = await world({ mode: 'bad' });
  const bid = (await bad.post('/api/author/draft', bad.card())).json().draftId;
  await phaseOf(bad, bid, ['red']);
  assert.equal((await bad.post(`/api/author/${bid}/sign-prepare`, {})).json().refused, 'not-green');
});

test('(f) a stale, wrong-case, missing or non-string hash signs NOTHING (no typed name is asked for): the flows root, the starts and the draft folder are byte-for-byte what they were', async () => {
  const { w, id, hash, dir } = await greenWorld();
  const before = snapshot(w, dir);
  const bodies = [
    [signBody('f'.repeat(64)), 409, 'stale-hash'], [{}, 409, 'stale-hash'], [{ typedName: 'job2' }, 409, 'stale-hash'], [signBody(hash.toUpperCase()), 409, 'stale-hash'],
    [signBody(`${hash} `), 409, 'stale-hash'], [{ hash: 42 }, 409, 'stale-hash'], [{ hash: '' }, 409, 'stale-hash'],
  ];
  for (const [body, status, refused] of bodies) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post(`/api/author/${id}/sign`, body);
    assert.equal(r.status, status, `${JSON.stringify(body)} -> ${r.text}`);
    assert.equal(r.json().refused, refused, JSON.stringify(body));
    assert.equal(snapshot(w, dir), before, `${JSON.stringify(body)} changed something`);
  }
  // the draft changed on disk AFTER the plan was shown (hash read from prepare): refused by signDraft's own hash check
  const shown = (await w.post(`/api/author/${id}/sign-prepare`, {})).json().hash;
  const decl = path.join(dir, 'draft', 'declaration.json');
  const edited = JSON.parse(readFileSync(decl, 'utf8'));
  edited.steps[0].goal += ' and also do something else';
  writeFileSync(decl, `${JSON.stringify(edited, null, 2)}\n`);
  const r = await w.post(`/api/author/${id}/sign`, signBody(shown));
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json().refused, 'sign-refused');
  assert.match(JSON.stringify(r.json().reds), /does not match the draft as it is now/);
  assert.deepEqual(rootListing(w), ['.drafts']);
  assert.deepEqual(w.starts(), []);
  assert.equal(existsSync(path.join(dir, 'signed.json')), false);
  assert.equal((await w.get(`/api/author/${id}`)).json().phase, 'green');
});

test('(2)(4) the right hash alone (no typed name) signs with the SAME signDraft, write signed.json, start the run; the flow is signed by the panel\'s OS user and passes readFlow; the draft reads signed', async () => {
  const { w, id, hash, dir } = await greenWorld({ limit: 5 });
  const r = await w.post(`/api/author/${id}/sign`, signBody(hash, { runId: 'first' }));
  assert.equal(r.status, 202, r.text);
  const j = r.json();
  assert.deepEqual([j.signed, j.flow, j.runId], [true, 'job2', 'first']);
  const sig = JSON.parse(readFileSync(path.join(w.root, 'job2', 'signature.json'), 'utf8'));
  assert.equal(sig.signedBy, userInfo().username);
  const cat = loadCatalogue();
  assert.equal(readFlow({ root: w.root, name: 'job2', catalogue: cat.primitives }).ok, true);
  const rec = JSON.parse(readFileSync(path.join(dir, 'signed.json'), 'utf8'));
  assert.deepEqual([rec.hash, rec.flow, rec.runId, rec.signedBy], [hash, 'job2', 'first', userInfo().username]);
  assert.equal((await w.get(`/api/author/${id}`)).json().phase, 'signed');
  assert.equal((await w.get('/api/author/live')).json().draft, null);
  const st = JSON.parse(readFileSync(path.join(w.root, '.starts', j.startId, 'start.json'), 'utf8'));
  assert.deepEqual([st.kind, st.flow, st.runId], ['sign', 'job2', 'first']);
  assert.deepEqual(st.sources.map((s) => s.role).sort(), ['jd', 'resume']);
  const parked = await until(async () => { const v = (await w.get(`/api/author/start/${j.startId}`)).json(); return v.state === 'parked' ? v : null; });
  assert.equal(parked.phase, 'started');
  assert.equal(readFileSync(path.join(w.root, 'job2', 'runs', 'first', 'inputs', 'jd.md'), 'utf8'), '# J\n');
  // a signed draft cannot be signed again or abandoned
  assert.equal((await w.post(`/api/author/${id}/sign`, signBody(hash))).json().refused, 'not-green');
  assert.equal((await w.post(`/api/author/${id}/abandon`, {})).status, 409);
  const listed = (await w.get('/api/author/flows')).json();
  assert.deepEqual(listed.flows.map((f) => f.flow), ['job2']);
});

test('(ii) sign and sign-prepare are the SAME gated door: no cookie, no/foreign Origin, GET -> refused, nothing signed', async () => {
  const { w, id, hash, dir } = await greenWorld();
  const before = snapshot(w, dir);
  for (const suffix of ['sign', 'sign-prepare']) {
    for (const [c, want] of [[{ headers: { cookie: null } }, 403], [{ headers: { origin: null } }, 403], [{ headers: { origin: 'http://evil.example' } }, 403], [{ headers: { host: 'evil.example' } }, 403]]) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await rq(w.h.port, { method: 'POST', url: `/api/author/${id}/${suffix}`, body: signBody(hash), ...c })).status, want, `${suffix} ${JSON.stringify(c)}`);
    }
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await rq(w.h.port, { url: `/api/author/${id}/${suffix}` })).status, 404, `a GET of ${suffix} is not a door`);
  }
  assert.equal(snapshot(w, dir), before);
});

test('(vi) two sign POSTs together sign once and start exactly one child; the second is refused', async () => {
  for (let i = 0; i < 3; i += 1) {
    const { w, id, hash } = await greenWorld(); // eslint-disable-line no-await-in-loop
    const rs = await Promise.all([w.post(`/api/author/${id}/sign`, signBody(hash)), w.post(`/api/author/${id}/sign`, signBody(hash))]); // eslint-disable-line no-await-in-loop
    assert.deepEqual(rs.map((r) => r.status).sort(), [202, 409], rs.map((r) => r.text).join(' | '));
    assert.equal(rs.find((r) => r.status === 409).json().refused, 'not-green');
    assert.equal(w.starts().length, 1, 'one start folder');
    const only = rs.find((r) => r.status === 202).json();
    await until(async () => (await w.get(`/api/author/start/${only.startId}`)).json().phase === 'started'); // eslint-disable-line no-await-in-loop
    assert.deepEqual(readdirSync(path.join(w.root, 'job2', 'runs')), [only.runId], 'one run dir');
  }
});

test('(vii) the monthly limit below the cap: the sign signs (it is $0) and the run start reads refused with the signed sentence; nothing spent, no run dir', async () => {
  const { w, id, hash } = await greenWorld();
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify({ monthlyLimitUsd: 0.00001 }));
  const r = await w.post(`/api/author/${id}/sign`, signBody(hash, { runId: 'm1' }));
  assert.equal(r.status, 202, r.text);
  const j = await until(async () => { const v = (await w.get(`/api/author/start/${r.json().startId}`)).json(); return v.phase !== 'starting' ? v : null; });
  assert.equal(j.phase, 'refused');
  assert.ok(j.say.includes('Nothing spent. Raise the monthly limit in Settings, or wait for next month.'), j.say);
  assert.ok(j.say.includes(REFUSAL_SENTENCE));
  assert.equal(existsSync(path.join(w.root, 'job2', 'runs', 'm1')), false);
});

test('(viii) a keys file other users can read refuses the sign at the door with the chmod sentence; nothing is signed or created', async () => {
  const { w, id, hash, dir } = await greenWorld();
  const before = snapshot(w, dir);
  const { chmodSync } = await import('node:fs');
  chmodSync(path.join(w.home, '.env'), 0o640);
  const r = await w.post(`/api/author/${id}/sign`, signBody(hash));
  assert.equal(r.status, 409);
  assert.equal(r.json().refused, 'keys-file');
  assert.equal(r.json().say, chmodSentence(w.home));
  assert.ok(!r.text.includes(CANARY));
  chmodSync(path.join(w.home, '.env'), 0o600);
  assert.equal(snapshot(w, dir), before);
});

test('(ix) a key in the draft folder refuses the sign (signDraft\'s leak sweep) and no reply, signed.json, signed flow or start.json carries the canary', async () => {
  const leak = await greenWorld();
  const logf = path.join(leak.dir, 'draft', 'log.json'); // a file the hash does not cover: the draft stays green
  writeFileSync(logf, `${readFileSync(logf, 'utf8')}\n${CANARY}\n`);
  assert.equal((await leak.w.get(`/api/author/${leak.id}`)).json().phase, 'green');
  const before = snapshot(leak.w, leak.dir);
  const refused = await leak.w.post(`/api/author/${leak.id}/sign`, signBody(leak.hash));
  assert.equal(refused.status, 409, refused.text);
  assert.equal(refused.json().refused, 'sign-refused');
  assert.match(JSON.stringify(refused.json().reds), /contains a key value/);
  assert.ok(!refused.text.includes(CANARY));
  assert.equal(snapshot(leak.w, leak.dir), before);
  // a clean one: nothing the sign wrote holds the key
  const { w, id, hash, dir } = await greenWorld();
  const replies = [(await w.post(`/api/author/${id}/sign-prepare`, {})).text];
  const r = await w.post(`/api/author/${id}/sign`, signBody(hash));
  replies.push(r.text, (await w.get(`/api/author/${id}`)).text, (await w.get(`/api/author/start/${r.json().startId}`)).text);
  for (const t of replies) assert.ok(!t.includes(CANARY), 'a reply carried the key');
  for (const f of [path.join(dir, 'signed.json'), path.join(w.root, '.starts', r.json().startId, 'start.json'), path.join(w.root, 'job2', 'signature.json'), path.join(w.root, 'job2', 'prose.txt'), path.join(w.root, 'job2', 'declaration.json')]) {
    assert.ok(!readFileSync(f, 'utf8').includes(CANARY), f);
  }
});

test('a missing input or a bad run id refuses BEFORE signing: no signed flow is left without a run', async () => {
  const { w, id, hash, dir } = await greenWorld();
  const before = snapshot(w, dir);
  const bad = await w.post(`/api/author/${id}/sign`, signBody(hash, { runId: '../x' }));
  assert.equal(bad.status, 400);
  assert.equal(bad.json().refused, 'run-id');
  rmSync(path.join(w.inDir, 'jd.md'));
  const gone = await w.post(`/api/author/${id}/sign`, signBody(hash));
  assert.equal(gone.status, 400);
  assert.equal(gone.json().refused, 'inputs');
  assert.ok(gone.json().refusals.some((x) => x.field === 'inputs' && /^Line 2: /.test(x.say)));
  assert.equal(snapshot(w, dir), before);
});
