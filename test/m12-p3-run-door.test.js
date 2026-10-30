// M12 piece 3 (hamr 2026-10-29): a by-hand Run of a job with a ticket-list input picks a ticket by number. The server marks which inputs are ticket lists
// (`tickets` on the flow entry); the page then shows a number box and keeps Run off until it is filled. Real panel, real signed flow; $0. Written red-first.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import path from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';

import { createPanelServer } from '../src/panel/server.js';
import { skippedWorld } from './m12-p3-world.mjs';
import { readFileSync } from 'node:fs';
import { LIST, ticketJob } from './m12-p2-world.mjs';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { seedGreen } from './m9-trigger-world.mjs';

const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

test('the flow entry names the ticket-list inputs', async (t) => {
  const w = await skippedWorld(t);
  // the Signed flow list shows only a flow with a passed run: one is seeded in its books
  mkdirSync(path.join(w.root, 'tick', 'runs', 'seed-pass'), { recursive: true });
  appendFileSync(path.join(w.root, 'tick', 'history.jsonl'), `${JSON.stringify({ runId: 'seed-pass', at: '2026-10-06T10:00:00.000Z', outcome: 'complete', spentUsd: 0.02, spendComplete: true, capUsd: 0.25, wallMs: 90_000, signatureHash: 'x' })}\n`);
  const h = await createPanelServer({ port: 0, root: w.root, settings: { home: path.join(w.home, 'cfg'), env: {} }, scheduler: { intervalMs: 0 } });
  HANDLES.push(h);
  const f = (await (await fetch(`http://127.0.0.1:${h.port}/api/author/flows`)).json()).flows.find((x) => x.flow === 'tick');
  assert.deepEqual(f.roles, ['issues']);
  assert.deepEqual(f.tickets, ['issues']);
  assert.deepEqual(f.pages, { issues: 'https://github.com/flutter/flutter/issues' });
});

// ---- the door: a by-hand Run on a ticket job carries ONE ticket number to the start (`--ticket N`); without one it refuses at $0 ----
killChildrenAfter();
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ARGV_ECHO = path.join(HERE, 'fixtures', 'm4d-argv-echo', 'fwdloop');
async function doorWorld() {
  const w = await world({ limit: 5, bin: ARGV_ECHO });
  w.env.ARGV_FILE = path.join(w.work, 'argv.jsonl');
  ticketJob(w.root, 'tk');
  seedGreen(w, 'tk');
  const argv = () => { try { return readFileSync(w.env.ARGV_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const inputs = [{ role: 'resume', path: path.join(w.inDir, 'resume.md') }, { role: 'jd', path: '' }];
  return { w, argv, inputs };
}

test('Run with a ticket number starts the run with --ticket N beside the signed list', async () => {
  const { w, argv, inputs } = await doorWorld();
  const r = await w.post('/api/author/run', { flow: 'tk', inputs, runId: 'r1', ticket: 6 });
  assert.equal(r.status, 202, r.text);
  await until(() => argv().length > 0, 20000);
  const a = argv()[0];
  assert.equal(a[a.indexOf('--ticket') + 1], '6', JSON.stringify(a));
  assert.ok(a.includes(`jd=${LIST}`));
});

test('Run on a ticket job without a number, or with a bad one, is refused at $0 naming the ticket box; nothing starts', async () => {
  const { w, argv, inputs } = await doorWorld();
  for (const ticket of [undefined, '', 'abc', 0, -3, 1.5, '12x']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post('/api/author/run', { flow: 'tk', inputs, runId: 'r2', ...(ticket === undefined ? {} : { ticket }) });
    assert.equal(r.status, 400, `${JSON.stringify(ticket)}: ${r.text}`);
    assert.deepEqual(r.json().refusals.map((x) => x.field), ['ticket']);
    assert.match(r.json().refusals[0].say, /ticket number/);
  }
  assert.deepEqual(argv(), []);
});

test('a ticket number on a job with no ticket list is refused, naming the box', async () => {
  const w = await world({ limit: 5, bin: ARGV_ECHO });
  w.env.ARGV_FILE = path.join(w.work, 'argv.jsonl');
  ticketJob(w.root, 'tk', { fileJd: true });
  seedGreen(w, 'tk');
  const r = await w.post('/api/author/run', { flow: 'tk', inputs: [{ role: 'resume', path: path.join(w.inDir, 'resume.md') }, { role: 'jd', path: path.join(w.inDir, 'jd.md') }], runId: 'r3', ticket: 4 });
  assert.equal(r.status, 400, r.text);
  assert.deepEqual(r.json().refusals.map((x) => x.field), ['ticket']);
});

// ---- the door fills trigger.watch from the signed job (signed M12 item 7); a job with no ticketWatch watches nothing ----
import { writeFlow } from '../src/flow.js';
import { writeModelRecord } from '../src/flowmodel.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readSchedule } from '../src/schedule.js';
import { sandboxSend } from './send-sandbox.js';

async function watchWorld(watch) {
  const w = await world({ limit: 5 });
  const declaration = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'job2.m1.declaration.json'), 'utf8'));
  declaration.mcp = { server: 'github', tools: ['issue_read'] };
  declaration.steps[0].mcpTools = ['issue_read'];
  if (watch) declaration.ticketWatch = watch;
  const prose = sandboxSend(readFileSync(path.join(HERE, 'fixtures', 'job2-with-sources.signed.txt'), 'utf8')).replace(/guardrail: source jd = file:.*/, `guardrail: source jd = page:${LIST}`);
  const r = writeFlow({ root: w.root, name: 'tk', proseText: prose, declaration, signedBy: 'hamr', signedAt: '2026-10-29T12:00:00Z', catalogue: loadCatalogue().primitives });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  writeModelRecord(path.join(w.root, 'tk'), { slot: 'DEEPSEEK_API_KEY', model: 'fake-ticked' });
  seedGreen(w, 'tk');
  return w;
}
const sign = async (w) => {
  const trigger = { kind: 'new-ticket', role: 'jd' };
  const p = await w.post('/api/author/trigger-prepare', { flow: 'tk', trigger });
  assert.equal(p.status, 200, p.text);
  const s = await w.post('/api/author/trigger', { flow: 'tk', trigger, hash: p.json().hash });
  assert.equal(s.status, 200, s.text);
  return readSchedule(path.join(w.root, 'tk')).trigger;
};

test('the signed job\'s ticketWatch becomes the schedule\'s trigger.watch (signed with the two clicks)', async () => {
  const t = await sign(await watchWorld(['state', 'labels']));
  assert.deepEqual(t.watch, ['state', 'labels']);
});

test('a job with no ticketWatch signs a schedule that watches nothing', async () => {
  const t = await sign(await watchWorld(null));
  assert.equal(t.watch, undefined);
});
