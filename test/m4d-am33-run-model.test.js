// M4d amendment 33: a signed job can run on any model ticked in Settings. The run picks the model (the CLI's --model), the run records which one
// it used (its audit rows), and the job's recorded model (model.json) is only the default pick. A model not ticked is refused by name.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { killChildrenAfter, tickedConfig, world, HERE } from './m4e-world.mjs';

killChildrenAfter();
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');

// A fake provider that answers every call with plain text (no tool call) and echoes the model it was asked for, so a run goes red cheaply.
async function fakeProvider() {
  const asked = [];
  const server = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (c) => ch.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(ch).toString('utf8'));
      asked.push(body.model);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'no tool' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 }, model: body.model }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { asked, port: server.address().port, close: () => server.close() };
}

async function modelWorld(fp) {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify(tickedConfig({
    monthlyLimitUsd: 5,
    providers: { DEEPSEEK_API_KEY: { shape: 'openai-api', baseUrl: `http://127.0.0.1:${fp.port}` } },
    models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: true, inPerM: 0.75, outPerM: 1.625 }, { model: 'fake-second', use: true, inPerM: 0.5, outPerM: 1 }] },
  })));
  return w;
}

// Async spawn: the fake provider lives in this process, so a blocking spawnSync would starve it.
function runCli(w, runId, extra) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, 'run', 'job2', '--root', w.root, '--run-id', runId, ...w.inputs().flatMap((i) => ['--source', `${i.role}=${i.path}`]), ...extra], {
      env: { ...w.env, FWDLOOP_TEST_MODEL_STEP: '', DEEPSEEK_API_KEY: 'sk-test-0123456789' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    const t = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', (status) => { clearTimeout(t); resolve({ status, out }); });
  });
}
const rowModels = (w, runId) => [...new Set(readFileSync(path.join(w.root, 'job2', 'runs', runId, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).model).filter((m) => m))];

test('--model picks any ticked model for the run, the run records it, model.json stays the default and unchanged', async () => {
  const fp = await fakeProvider();
  try {
    const w = await modelWorld(fp);
    const before = readFileSync(path.join(w.root, 'job2', 'model.json'), 'utf8');
    assert.match(before, /fake-ticked/);
    const r = await runCli(w, 'pick-run', ['--model', 'fake-second']);
    assert.ok(fp.asked.length > 0, `the provider was asked: ${r.out}`);
    assert.deepEqual([...new Set(fp.asked)], ['fake-second'], r.out);
    assert.deepEqual(rowModels(w, 'pick-run'), ['fake-second'], 'the run records the model it used');
    assert.equal(readFileSync(path.join(w.root, 'job2', 'model.json'), 'utf8'), before, 'model.json is not rewritten');
  } finally { fp.close(); }
});

test('no --model: the run uses the job\'s recorded model, the default', async () => {
  const fp = await fakeProvider();
  try {
    const w = await modelWorld(fp);
    const r = await runCli(w, 'default-run', []);
    assert.deepEqual([...new Set(fp.asked)], ['fake-ticked'], r.out);
    assert.deepEqual(rowModels(w, 'default-run'), ['fake-ticked']);
  } finally { fp.close(); }
});

test('a model that is not ticked is refused by name at $0, nothing asked', async () => {
  const fp = await fakeProvider();
  try {
    const w = await modelWorld(fp);
    const r = await runCli(w, 'ghost-run', ['--model', 'ghost']);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /Tick ghost in Settings/);
    assert.deepEqual(fp.asked, []);
  } finally { fp.close(); }
});
