// M7 piece 3: the eight store-and-index tools are wired and behave. Piece 4 adds edit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { resolvePrimitives, WIRED_VERBS, GateRefusal } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';

const CTX_VERBS = ['recall', 'get', 'recent', 'related', 'impact', 'compress', 'peek', 'stash'];

function run() {
  const runDir = path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-m7c-')), 'flow', 'runs', 'run-1');
  mkdirSync(path.join(runDir, 'out'), { recursive: true });
  mkdirSync(path.join(runDir, 'inputs'), { recursive: true });
  return runDir;
}
const tools = (runDir, verbs = CTX_VERBS) => resolvePrimitives(loadCatalogue().primitives, verbs, { runDir });

test('M7: the eight tools are wired verbs; remember and forget are still not', () => {
  for (const v of CTX_VERBS) assert.ok(WIRED_VERBS.has(v), `${v} is not wired`);
  assert.ok(!WIRED_VERBS.has('remember') && !WIRED_VERBS.has('forget'));
  const r = tools(run(), ['remember', 'forget']);
  assert.deepEqual(Object.keys(r.tools), []);
  assert.equal(r.reds.length, 2, 'both refused by name');
});

test('M7: resolving the tools creates nothing on disk (a refused run leaves no trace)', () => {
  const runDir = path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-m7c-')), 'flow', 'runs', 'run-9');
  const r = tools(runDir);
  assert.deepEqual(r.reds, []);
  assert.deepEqual(Object.keys(r.tools).sort(), [...CTX_VERBS].sort());
  assert.equal(existsSync(path.join(runDir, '..')), false, 'resolve must not create the runs dir or its .stores');
});

test('M7: stash then peek and get by id, inside one run', async () => {
  const t = tools(run()).tools;
  assert.match(await t.stash.execute({ id: 'k', text: 'hello stash' }), /parked 11 bytes under "k"/);
  assert.match(await t.peek.execute({ id: 'k' }), /11 bytes[\s\S]*head: hello stash/);
  assert.equal(await t.get.execute({ id: 'k' }), 'hello stash');
  assert.match(await t.peek.execute({ id: 'nope' }), /nothing stashed under "nope"/);
});

test('M7: stash holds at most 64 KB per item (65536 in, 65537 refused and nothing parked)', async () => {
  const t = tools(run()).tools;
  assert.match(await t.stash.execute({ id: 'ok', text: 'x'.repeat(65536) }), /^parked 65536 bytes/);
  assert.match(await t.stash.execute({ id: 'big', text: 'x'.repeat(65537) }), /limit is 65536 bytes/);
  assert.match(await t.peek.execute({ id: 'big' }), /nothing stashed/);
});

test('M7: a secret-shaped key never lands in the store (id or body)', async () => {
  const t = tools(run()).tools;
  const key = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
  await t.stash.execute({ id: `id-${key}`, text: `token ${key}` });
  const peeked = await t.peek.execute({ id: `id-${key}` });
  assert.ok(!peeked.includes(key), peeked);
  assert.match(peeked, /token /);
});

test('M7: recall returns pointers into this run\'s indexed text', async () => {
  const runDir = run();
  writeFileSync(path.join(runDir, 'inputs', 'policy.md'), '# Refund policy\n\nQuartzlimit applies to every refund over fifty dollars.\n');
  const t = tools(runDir).tools;
  const out = await t.recall.execute({ query: 'Quartzlimit' });
  assert.match(out, /policy\.md/, out);
  assert.match(await t.recall.execute({ query: 'zzzznothing' }), /no hits/);
});

test('M7: impact names the callers of a function; related walks the import edge; compress drops the body', async () => {
  const runDir = run();
  writeFileSync(path.join(runDir, 'out', 'helper.js'), '/** adds two numbers */\nexport function addNums(a, b) {\n  const total = a + b;\n  return total * 1;\n}\n');
  writeFileSync(path.join(runDir, 'out', 'main.js'), "import { addNums } from './helper.js';\nexport function run() {\n  return addNums(1, 2);\n}\n");
  const t = tools(runDir).tools;
  const imp = await t.impact.execute({ symbol: 'addNums' });
  assert.match(imp, /called by\s+out\/main\.js/, imp);
  const rel = await t.related.execute({ path: 'out/helper.js' });
  assert.match(rel, /imported by\s+out\/main\.js/, rel);
  const sig = await t.compress.execute({ path: 'out/helper.js', symbol: 'addNums' });
  assert.match(sig, /addNums/);
  assert.ok(!sig.includes('const total'), `the body must be dropped: ${sig}`);
  assert.match(await t.impact.execute({ symbol: 'noSuchSymbol' }), /no indexed symbol/);
  assert.equal(typeof (await t.recent.execute({})), 'string');
});

test('M7: path-taking tools go through the same read gate as read: outside the run is refused', async () => {
  const t = tools(run()).tools;
  for (const [verb, args] of [['get', { path: '/etc/hostname', startLine: 0, endLine: 1 }], ['related', { path: '/etc/hostname' }], ['compress', { path: '/etc/hostname', symbol: 'x' }]]) {
    await assert.rejects(() => t[verb].execute(args), (e) => e instanceof GateRefusal, verb);
  }
});

test('M7: run-2 cannot see run-1\'s stash through the tools', async () => {
  const runs = path.dirname(run());
  const r1 = path.join(runs, 'run-1');
  const r2 = path.join(runs, 'run-2');
  mkdirSync(r2, { recursive: true });
  await tools(r1).tools.stash.execute({ id: 'carry', text: 'from run one' });
  assert.match(await tools(r1).tools.peek.execute({ id: 'carry' }), /from run one/, 'run-1 sees its own');
  assert.match(await tools(r2).tools.peek.execute({ id: 'carry' }), /nothing stashed/);
});
