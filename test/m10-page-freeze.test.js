// M10 item 1 - a web page is frozen with a fingerprint, at drafting and again at each run start; a run is checked against its OWN copy.
// Local http server + fake barebrowse connect: no internet, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { freezeInputs, freezePage, runFlow } from '../src/runner.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { sandboxSend } from './send-sandbox.js';
import { startPageServer, fakeConnect, pageText } from './fixtures/m10-page-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m10-${p}-`));
const FAST = { idleMs: 5, idleTimeoutMs: 40, timeoutMs: 400, closeWaitMs: 50 };
/** the fetch seam: the fake browser over the local server, fast limits */
const seam = (fc) => (url) => import('../src/pagefetch.js').then((m) => m.fetchPageText(url, { connect: fc.connect, ...FAST }));

test('a normal page is frozen into the run, with a sha256 of the frozen bytes, in the same manifest as a file', async () => {
  const srv = await startPageServer({ '/flights': { body: pageText('A') } });
  try {
    const runDir = tmp('run');
    const file = path.join(tmp('src'), 'aging.csv');
    writeFileSync(file, 'a,b\n1,2\n');
    const r = await freezeInputs(runDir, [{ id: 'flights', path: `${srv.base}/flights` }, { id: 'aging', path: file }], { fetchPage: seam(fakeConnect()) });
    assert.equal(r.ok, true, r.ok ? '' : r.red);
    const e = r.manifest[0];
    assert.equal(e.id, 'flights');
    assert.equal(e.source, `${srv.base}/flights`);
    assert.equal(e.frozen, path.join(runDir, 'inputs', 'flights.txt'));
    assert.equal(readFileSync(e.frozen, 'utf8'), pageText('A'));
    assert.equal(e.sha256, sha(readFileSync(e.frozen)));
    assert.equal(e.bytes, Buffer.byteLength(pageText('A')));
    assert.equal(r.manifest[1].id, 'aging', 'a file input still freezes the old way');
    assert.equal(existsSync(path.join(runDir, 'inputs.json')), false, 'freezeInputs returns the manifest; runFlow records it in run.json');
  } finally { await srv.close(); }
});

test('an empty page stops the freeze with a plain reason that names the input; no manifest says it is frozen', async () => {
  const srv = await startPageServer({ '/empty': { body: '' } });
  try {
    const runDir = tmp('run');
    const r = await freezeInputs(runDir, [{ id: 'flights', path: `${srv.base}/empty` }], { fetchPage: seam(fakeConnect()) });
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.red, /input "flights"/);
    assert.match(r.ok ? '' : r.red, /no text/);
    assert.equal(existsSync(path.join(runDir, 'inputs', 'flights.txt')), false, 'nothing frozen');
  } finally { await srv.close(); }
});

test('a cap-hit page with real content is frozen as it stands; a site that blocks us stops the freeze and is fetched once (no retry around it)', async () => {
  const srv = await startPageServer({ '/busy': { body: pageText() }, '/bot': { body: `${pageText()}\n[BOT CHALLENGE DETECTED]\n` } });
  try {
    const busy = fakeConnect({ idle: 'reject' });
    const a = await freezeInputs(tmp('run'), [{ id: 'p', path: `${srv.base}/busy` }], { fetchPage: seam(busy) });
    assert.equal(a.ok, true, a.ok ? '' : a.red);
    assert.equal(a.manifest[0].sha256, sha(Buffer.from(pageText())));
    assert.equal(busy.calls.connect.length, 1);
    const bot = fakeConnect();
    const b = await freezeInputs(tmp('run'), [{ id: 'p', path: `${srv.base}/bot` }], { fetchPage: seam(bot) });
    assert.equal(b.ok, false);
    assert.match(b.ok ? '' : b.red, /bot challenge/);
    assert.equal(bot.calls.connect.length, 1);
  } finally { await srv.close(); }
});

test('the drafting copy and the run copy are separate files; the run freezes the page again and keeps its own fingerprint', async () => {
  const srv = await startPageServer({ '/flights': { body: pageText('A') } });
  try {
    const url = `${srv.base}/flights`;
    const draftDir = tmp('draft');
    const d = await freezePage(draftDir, 'flights', url, { fetchPage: seam(fakeConnect()) });
    assert.equal(d.ok, true, d.ok ? '' : d.red);
    // the page changes between drafting and the run start
    srv.routes['/flights'] = { body: pageText('B') };
    const runDir = tmp('run');
    const r = await freezeInputs(runDir, [{ id: 'flights', path: url }], { fetchPage: seam(fakeConnect()) });
    assert.equal(r.ok, true);
    const run = r.manifest[0];
    assert.notEqual(run.frozen, d.entry.frozen, 'two files');
    assert.ok(run.frozen.startsWith(runDir), 'the run copy lives in the run');
    assert.notEqual(run.sha256, d.entry.sha256, 'the run is not held to the drafting fingerprint');
    assert.equal(readFileSync(run.frozen, 'utf8'), pageText('B'));
    // the drafting copy is untouched by the run
    assert.equal(sha(readFileSync(d.entry.frozen)), d.entry.sha256);
    assert.equal(readFileSync(d.entry.frozen, 'utf8'), pageText('A'));
  } finally { await srv.close(); }
});

test('a run whose own frozen copy is changed afterwards is caught against its own fingerprint (not the drafting copy)', async () => {
  const srv = await startPageServer({ '/flights': { body: pageText('A') } });
  try {
    const url = `${srv.base}/flights`;
    const d = await freezePage(tmp('draft'), 'flights', url, { fetchPage: seam(fakeConnect()) });
    const runDir = tmp('run');
    const r = await freezeInputs(runDir, [{ id: 'flights', path: url }], { fetchPage: seam(fakeConnect()) });
    const e = r.manifest[0];
    assert.equal(e.sha256, d.entry.sha256, 'same page, same bytes, same fingerprint here');
    writeFileSync(e.frozen, `${pageText('A')}tampered`);
    assert.notEqual(sha(readFileSync(e.frozen)), e.sha256, 'the run copy no longer matches its own record');
    // and the drafting copy still matches its own: the two are not one file
    assert.equal(sha(readFileSync(d.entry.frozen)), d.entry.sha256);
  } finally { await srv.close(); }
});

test('runFlow: an empty page stops the run at $0 before any step, with the reason, no model call', async () => {
  const srv = await startPageServer({ '/empty': { body: '' } });
  try {
    const root = tmp('root');
    const cat = loadCatalogue().primitives;
    const fx = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
    const w = writeFlow({
      root, name: 'job2', proseText: sandboxSend(fx('job2-with-sources.signed.txt')), declaration: JSON.parse(fx('job2.m1.declaration.json')),
      signedBy: 'hamr', signedAt: '2026-09-24T12:00:00Z', catalogue: cat,
    });
    assert.equal(w.ok, true);
    const result = await runFlow({
      root, name: 'job2', runId: 'run-1', sources: [{ id: 'resume', path: `${srv.base}/empty` }], catalogue: cat,
      modelStep: async () => { throw new Error('modelStep must never be called'); },
      askStep: async () => ({ decision: 'accept' }), sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01',
      fetchPage: seam(fakeConnect()),
    });
    assert.equal(result.outcome, 'preflight-red');
    assert.match(result.red, /input "resume"/);
    assert.match(result.red, /no text/);
    assert.equal(result.spentUsd, 0);
  } finally { await srv.close(); }
});
