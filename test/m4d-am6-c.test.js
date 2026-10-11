// M4d amendment 6, piece C (items 6, 7) and amendment 7 (bareagent decides thinking): Chat's Model menu lists only ticked lines of providers
// with a key; the picked model drafts the job and is recorded with it; a stale pick is refused by name at $0; "Thinking on" is a per-job box.
// $0: the test draft provider / test model step, a scratch world per test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, readdirSync, rmSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  world, killChildrenAfter, until, HERE,
} from './m4e-world.mjs';
import { updateConfig } from '../src/config.js';
import { thinkingSupport } from '../src/thinking.js';
import { draft } from '../src/drafter.js';
import { job2Fixture, fakeProvider, toolReply, validArgs, RATES, MODEL } from './drafter-fixture.mjs';
import { readModelRecord } from '../src/flowmodel.js';

killChildrenAfter();
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const ARGV_ECHO = path.join(HERE, 'fixtures', 'm4d-argv-echo', 'fwdloop');

test('C1: the menu offers only ticked, priced lines of providers that have a key - as "provider · model"; nothing ticked says what to do', async () => {
  const w = await world();
  updateConfig({ models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: true, inPerM: 0.75, outPerM: 1.625 }, { model: 'unticked', use: false, inPerM: 1, outPerM: 1 }, { model: 'listed-only', use: false }], NO_KEY_HERE: [{ model: 'orphan', use: true, inPerM: 1, outPerM: 1 }] } }, { home: w.home });
  const r = (await w.get('/api/author/models')).json();
  assert.deepEqual(r.lines.map((l) => [l.slot, l.model, l.label]), [['DEEPSEEK_API_KEY', 'fake-ticked', 'DEEPSEEK_API_KEY · fake-ticked']]);
  assert.equal(r.say, '');
  updateConfig({ models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: false }] } }, { home: w.home });
  const none = (await w.get('/api/author/models')).json();
  assert.deepEqual([none.lines, none.say], [[], 'Tick a model in Settings > Providers.']);
});

test('C2: a draft needs a picked model that is still ticked: none picked, nothing ticked, or a line unticked since the menu was drawn is refused by name at $0, nothing created', async () => {
  const w = await world();
  const refused = async (card, say) => {
    const r = await w.post('/api/author/draft', card);
    assert.equal(r.status, 400, r.text);
    assert.deepEqual(r.json().refusals.filter((x) => x.field === 'model').map((x) => x.say), [say]);
    assert.equal(existsSync(path.join(w.root, '.drafts')) ? readdirSync(path.join(w.root, '.drafts')).length : 0, 0, 'nothing created');
    assert.deepEqual(w.starts(), []);
  };
  await refused(w.card({ provider: '', model: '' }), 'Pick a model. Nothing was spent.');
  await refused(w.card({ model: 'not-ticked' }), 'Tick not-ticked in Settings > Providers with both prices first. Nothing was spent.');
  await refused(w.card({ provider: 'OTHER_KEY' }), 'OTHER_KEY is not set up: put its key in your keys file and type its Base URL in Settings > Providers. Nothing was spent.');
  updateConfig({ models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: false }] } }, { home: w.home });
  await refused(w.card({}), 'Tick fake-ticked in Settings > Providers with both prices first. Nothing was spent.');
  await refused(w.card({ provider: '', model: '' }), 'Tick a model in Settings > Providers. Nothing was spent.');
});

test('C3: the picked model drafts the job and is recorded with it: card.json, the draft folder, then the signed flow and the Job tab - and the thinking tick is per job, off unless sent', async () => {
  const w = await world();
  const { id, flow, flowDir } = await w.signedFlow();
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card.json'), 'utf8'));
  assert.deepEqual([card.provider, card.model, card.thinking], ['DEEPSEEK_API_KEY', 'fake-ticked', undefined]);
  assert.deepEqual(readModelRecord(path.join(w.dir(id), 'draft')), { slot: 'DEEPSEEK_API_KEY', model: 'fake-ticked' });
  assert.deepEqual(readModelRecord(flowDir), { slot: 'DEEPSEEK_API_KEY', model: 'fake-ticked' });
  w.seedPassed(flow);
  const flows = (await w.get('/api/author/flows')).json();
  const entry = flows.flows.find((f) => f.flow === flow);
  assert.deepEqual(entry.model, { slot: 'DEEPSEEK_API_KEY', model: 'fake-ticked', label: 'DEEPSEEK_API_KEY · fake-ticked' });
});

test('C4: the panel passes the pick and the thinking tick to the draft child as flags - ticked: --thinking; unticked: no flag', async () => {
  const argvFile = path.join((await world()).work, 'argv.jsonl');
  const w = await world({ bin: ARGV_ECHO, extraEnv: { ARGV_FILE: argvFile } });
  const file = path.join(w.work, 'argv.jsonl');
  w.env.ARGV_FILE = file;
  assert.equal((await w.post('/api/author/draft', w.card({}))).status, 202);
  await until(() => existsSync(file));
  const first = JSON.parse(readFileSync(file, 'utf8').trim().split('\n')[0]);
  assert.deepEqual(first.slice(first.indexOf('--model')), ['--model', 'fake-ticked', '--provider', 'DEEPSEEK_API_KEY']);
  await until(async () => { const j = (await w.get('/api/author/live')).json(); return !j.draft || ['stopped', 'red', 'green'].includes(j.draft.phase); });
  const w2 = await world({ bin: ARGV_ECHO });
  const file2 = path.join(w2.work, 'argv.jsonl');
  w2.env.ARGV_FILE = file2;
  assert.equal((await w2.post('/api/author/draft', w2.card({ thinking: true }))).status, 202);
  await until(() => existsSync(file2));
  const second = JSON.parse(readFileSync(file2, 'utf8').trim().split('\n')[0]);
  assert.deepEqual(second.slice(second.indexOf('--model')), ['--model', 'fake-ticked', '--provider', 'DEEPSEEK_API_KEY', '--thinking']);
});

test('C5: the drafter takes the thinking tick as an intent only: on lets the model choose its tool, off forces it; neither puts a thinking field on our request (bareagent does the switching)', async () => {
  const seen = [];
  const run = async (draftThinking) => {
    const p = fakeProvider([toolReply(validArgs())]);
    const inner = p.generate.bind(p);
    p.generate = async (m, t, options) => { seen.push(options); return inner(m, t, options); };
    const r = await draft({ proseText: job2Fixture().prose, provider: p, rates: RATES, modelId: MODEL, draftThinking });
    assert.equal(r.ok, true, JSON.stringify(r.reds));
  };
  await run('off');
  await run('on');
  assert.deepEqual(seen.map((o) => o.toolChoice !== undefined), [true, false]);
  assert.ok(seen.every((o) => o.thinking === undefined));
});

test('C6: a job runs with the model recorded beside it; a line unticked since is refused by name at $0 (no run folder); a flow with no record is refused and says how', async () => {
  const w = await world();
  const { flow, flowDir } = await w.signedFlow();
  const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: w.home }; // no test double: the live decision runs
  const run = (id, extra = []) => spawnSync(process.execPath, [BIN, 'run', flow, '--root', w.root, ...w.inputs().flatMap((r) => ['--source', `${r.role}=${r.path}`]), '--run-id', id, ...extra], { encoding: 'utf8', env, timeout: 60000 });
  updateConfig({ models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: false, inPerM: 0.75, outPerM: 1.625 }] } }, { home: w.home });
  const stale = run('run-stale');
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /Tick fake-ticked in Settings > Providers with both prices first\./);
  assert.equal(existsSync(path.join(flowDir, 'runs', 'run-stale')), false, 'no run folder at $0');
  updateConfig({ models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: true, inPerM: 0.75, outPerM: 1.625 }] } }, { home: w.home });
  rmSync(path.join(flowDir, 'model.json'));
  const none = run('run-none');
  assert.match(none.stderr, /This job has no model recorded\. Name one with --model <id>/);
  assert.equal(existsSync(path.join(flowDir, 'runs', 'run-none')), false);
  const wrong = run('run-wrong', ['--model', 'not-ticked']);
  assert.match(wrong.stderr, /Tick not-ticked in Settings > Providers with both prices first\./);
});

test('C7 (amendment 7): the "Thinking on" box asks ONE function over bareagent\'s thinkingSupport: absent export or a nonsense answer = unverified; false greys the box', async () => {
  assert.equal(thinkingSupport('openai-api', 'm', { impl: undefined }), 'unverified');
  assert.equal(thinkingSupport('openai-api', 'm'), 'unverified', 'the installed bareagent does not know this model: unverified');
  assert.equal(thinkingSupport('openai-api', 'm', { impl: () => ({ switchable: true }) }), true);
  assert.equal(thinkingSupport('openai-api', 'm', { impl: () => ({ switchable: false }) }), false);
  assert.equal(thinkingSupport('openai-api', 'm', { impl: () => 'maybe' }), 'unverified');
  assert.equal(thinkingSupport('openai-api', 'm', { impl: () => { throw new Error('boom'); } }), 'unverified');
  const calls = [];
  const w = await world({ authorOpts: { thinkingSupport: (shape, model) => { calls.push([shape, model]); return false; } } });
  const line = (await w.get('/api/author/models')).json().lines[0];
  assert.deepEqual(line.thinking, { support: false, canChange: false, say: "can't change this for this model" });
  assert.deepEqual(calls, [['openai-api', 'fake-ticked']]);
  const w2 = await world();
  assert.deepEqual((await w2.get('/api/author/models')).json().lines[0].thinking, { support: 'unverified', canChange: true, say: '' });
  // the page: the box is greyed with the sentence when the answer is false, works otherwise, and is unticked by default
  const fn = PAGE.slice(PAGE.indexOf('function thinkingBoxState('), PAGE.indexOf('\n    }', PAGE.indexOf('function thinkingBoxState(')) + 6);
  const state = new Function(`${fn}\nreturn thinkingBoxState;`)();
  assert.deepEqual(state({ thinking: { canChange: false, say: "can't change this for this model" } }), { disabled: true, checked: false, note: "can't change this for this model" });
  assert.deepEqual(state({ thinking: { canChange: true, say: '' } }, true), { disabled: false, checked: true, note: '' });
  assert.deepEqual(state(null), { disabled: true, checked: false, note: '' });
  assert.match(PAGE, /<input type="checkbox" id="jf-thinking"(?![^>]*checked)[^>]*> Thinking on/);
});

test('C8: Settings has nothing about thinking, and the old per-model "Thinking off" field and draftThinking config are gone from the Settings route and page', () => {
  const settingsJs = readFileSync(path.join(HERE, '..', 'src', 'panel', 'settings.js'), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  assert.doesNotMatch(settingsJs.replace(/\bthinkingOff\b/g, ''), /thinking/i, 'the only mention is dropping an older file\'s field on save');
  const view = PAGE.slice(PAGE.indexOf('id="settings-view"'), PAGE.indexOf('id="main-view"'));
  assert.doesNotMatch(view, /thinking/i);
  assert.doesNotMatch(PAGE.slice(PAGE.indexOf('function buildModelLine('), PAGE.indexOf('function paintModels(')), /thinking/i);
});

test('C9: the page has a Model menu in the New job card, sends the pick and the tick with the card, and shows the recorded model on the Run and Resume forms', () => {
  assert.match(PAGE, /<label for="jf-model">Model<\/label>\s*<select id="jf-model" data-testid="jf-model"[^>]*>/);
  const body = PAGE.slice(PAGE.indexOf('function currentCard('), PAGE.indexOf('function runWaits('));
  assert.match(body, /provider:/);
  assert.match(body, /thinking:/);
  assert.match(PAGE, /id="jf-run-model"/);
  assert.match(PAGE, /id="jf-resume-model"/);
  assert.match(PAGE, /authorGet\("\/api\/author\/models"\)/);
});
