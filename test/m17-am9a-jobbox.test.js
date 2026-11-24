// M17 am9a item 2 (live practice walk 2026-11-18): after the person picks a column the New job box must show the rewritten `~` rule while the session is live. The server's newest card
// (`card-<n>.json`, written by the answer redraft from `applyAnswers`, the one writer of the job after an answer) carries it; the page reads it and never recomputes it.
// Real panel, real headless browser (scripts/panel-fixtures/cdp.mjs). Skips only when no chromium is installed.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChrome } from '../scripts/panel-fixtures/cdp.mjs';
import { world, until, killChildrenAfter } from './m4e-world.mjs';
import { raw } from './fixtures/m10-map/load.mjs';

killChildrenAfter();
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm10-map');
const SKIP = process.env.FWDLOOP_NO_BROWSER === '1';
const CLOSERS = [];
after(() => Promise.all(CLOSERS.map((c) => c())));
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const JOB = ['Read my resume,', '~ under $150', '~ not a red-eye', 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ plain words only', 'Ask 30m: check it with me,', '~ nothing goes out before I accept', 'write it out'].join('\n');
const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['Select flight'] }] });

test('browser: a live session\'s job box follows the newest card (the rule as answered)', { skip: SKIP && 'no browser' }, async (t) => {
  const chrome = await launchChrome();
  if (!chrome) { t.skip('no chromium installed'); return; }
  CLOSERS.push(async () => chrome.close());
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt') } });
  const id = (await w.post('/api/author/draft', w.card({ flowName: 'job2', job: JOB, inputs: `${w.card().inputs}\nflights: ${ADDRESS}` }))).json().draftId;
  await until(async () => (await w.get(`/api/author/${id}`)).json()?.phase === 'questions-open');
  await chrome.open(`http://127.0.0.1:${w.h.port}/`, 1280);
  assert.ok(await chrome.waitFor('document.getElementById("jf-job").value.indexOf("~ under $150") !== -1'), 'the box holds the typed job');
  // the answer redraft's files, as startRedraft writes them: the newest card has the rule as answered
  const dir = w.dir(id);
  const card = JSON.parse(readFileSync(path.join(dir, 'card.json'), 'utf8'));
  writeFileSync(path.join(dir, 'card-1.json'), `${JSON.stringify({ ...card, job: card.job.replace('~ under $150', '~ under $99') })}\n`);
  // F259: the answer redraft is a LIVE child (phase `redrafting`); a dead one reads `stopped`, where the poll leaves the boxes to the person
  const script = path.join(dir, 'fwdloop');   // liveness reads a child as ours only when node's script is named fwdloop
  writeFileSync(script, 'setTimeout(() => {}, 60000);\n');
  const live = spawn(process.execPath, [script], { detached: true, stdio: 'ignore' });
  live.unref();
  writeFileSync(path.join(dir, 'pid.json'), `${JSON.stringify({ pid: live.pid, startedAt: Date.now() })}\n`);
  writeFileSync(path.join(dir, 'redraft-1.json'), `${JSON.stringify({ fromPlan: 'draft', answers: [] })}\n`);
  assert.ok(await chrome.waitFor('document.getElementById("jf-job").value.indexOf("~ under $99") !== -1 && document.getElementById("jf-job").value.indexOf("~ under $150") === -1'), 'the job box shows the rule as answered');
});
