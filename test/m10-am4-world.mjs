// M10 am4 test world (shared by the Result tab's server tests and its browser walk): job2 (a .docx + a .md input, so an M10 job) run for real, in process,
// at $0, with the real panel on top. Never imported by src/.
import assert from 'node:assert/strict';
import { after } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember } from '../scripts/panel-fixtures/panel-auth.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { sendViaPrimitive } from '../src/send.js';
import { sandboxSend, SEND_DIR } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CATALOGUE = loadCatalogue().primitives;
const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

const modelStep = (summary) => async (ctx) => {
  if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
  if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
  if (ctx.goal.includes('Draft the summary resume')) return { ok: true, costUsd: 0.001, artifact: { text: summary, done: true } };
  throw new Error(`unexpected goal ${ctx.goal}`);
};
const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const args = (root, ms, extra = {}) => ({
  root, name: 'job2', runId: 'run-1', catalogue: CATALOGUE, modelStep: ms, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ...extra,
});

/** job2 (a .docx + a .md input, so an M10 job) run for real, in process, at $0. `green`: accepted and sent; else parked at its ask; `red`: a reply that misses the shape. */
/** `taken`: the report's first-choice name for today is already a file in the send folder (M15 am3), so the send lands under `-2`. */
export async function world({ mode = 'green', prose = (p) => p, taken = false } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10am4s-'));
  const root = path.join(base, 'flows'); const src = path.join(base, 'src');
  mkdirSync(root); mkdirSync(src);
  const w = writeFlow({
    root, name: 'job2', proseText: prose(sandboxSend(fixture('job2-with-sources.signed.txt'))), declaration: JSON.parse(fixture('job2.m1.declaration.json')),
    signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true, JSON.stringify(w.reds));
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const sources = [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }];
  const ms = modelStep(mode === 'red' ? 'no headings at all' : GOOD);
  if (taken) {
    const d = new Date();
    writeFileSync(path.join(SEND_DIR, `job2-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.md`), 'a file of mine');
  }
  const parked = await runFlow({ ...args(root, ms, { askStep: makeParkingAskStep() }), sources });
  let outcome = parked.outcome;
  if (mode === 'green') {
    assert.equal(answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' }).ok, true);
    const done = await resumeRun(args(root, ms));
    outcome = done.outcome;
    assert.equal(outcome, 'complete', done.red);
  }
  const h = remember(await createPanelServer({ port: 0, root, settings: { home: path.join(base, 'cfg'), env: {} } }));
  HANDLES.push(h);
  const get = async (p, init) => { const r = await fetch(`http://127.0.0.1:${h.port}${p}`, init); const t = await r.text(); let body = t; try { body = JSON.parse(t); } catch { /* text */ } return { status: r.status, body, headers: r.headers, raw: t }; };
  // M15 am3: the report is `job2-YYYY-MM-DD.md` (the send's own day), found in this process's send folder
  return {
    root, port: h.port, runDir: parked.runDir, outcome, get,
    delivered: path.join(SEND_DIR, readdirSync(SEND_DIR).find((f) => /^job2-\d{4}-\d{2}-\d{2}(-\d+)?\.md$/.test(f)) ?? 'job2-no-report.md') };
}

