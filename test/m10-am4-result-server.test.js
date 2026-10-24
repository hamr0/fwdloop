// M10 amendment 4 (docs/wiki/the-module-ladder.md): the Result tab's server side, copied in shape from bareloop (src/panel/server.js@2959217 getRunResult /
// getRunDownload, tests part6-result / part6-red-rows / part6-page). Built from fwdloop's OWN books: the signed job lines, the accepted ask's hash, the
// send step's audit row, the signed `page:` source. The per-result rows/proof/marks come from the M10 cited-check record, which is not built yet:
// `readCitedChecks` is its ONE reader and these tests feed it a file made from bareloop's own export (test/fixtures/m10-result/result-mvfphtwl.json).
import { putCited } from './line-checks-fixture.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, rmSync, symlinkSync, appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { SEND_DIR } from './send-sandbox.js';
import { world } from './m10-am4-world.mjs';
import {
  isResultRun, readCitedChecks, readDelivered, RESULT_FILE_GONE, RESULT_FILE_CHANGED, RESULT_PAGE_MAY_CHANGE,
} from '../src/panel/result.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm10-result', 'result-mvfphtwl.json'), 'utf8'));

test('isResultRun: a page, a CSV or a .docx input makes an M10 job; a markdown input or none does not', () => {
  const src = (kind, p) => ({ sources: [{ role: 'a', kind, path: p }] });
  assert.equal(isResultRun(src('page', 'https://example.com/x')), true);
  assert.equal(isResultRun(src('file', '/x/aging.csv')), true);
  assert.equal(isResultRun(src('file', '/x/Resume.DOCX')), true);
  assert.equal(isResultRun(src('file', '/x/jd.md')), false);
  assert.equal(isResultRun({ sources: [] }), false);
  assert.equal(isResultRun({}), false);
  assert.equal(isResultRun(null), false);
});

test('detail: an M10 run carries hasResult and a checkType (its distinct close classes, in step order)', async () => {
  const w = await world();
  const d = (await w.get('/api/runs/job2/run-1')).body;
  assert.equal(d.hasResult, true);
  assert.equal(d.checkType, 'hitl + softgreen');
});

test('/result (green): one card per working line (not the ask or the send), the signed rules, the saved file by the accepted hash; nothing invented', async () => {
  const w = await world();
  const r = await w.get('/api/runs/job2/run-1/result');
  assert.equal(r.status, 200, r.raw);
  assert.deepEqual(Object.keys(r.body).sort(), ['delivered', 'door', 'flow', 'gap', 'lines', 'notChecked', 'notCheckedLabel', 'pageNote', 'pages', 'readNotes', 'runId']);
  assert.equal(r.body.flow, 'job2');
  assert.equal(r.body.runId, 'run-1');
  assert.deepEqual(r.body.lines.map((l) => l.n), [1, 2, 3], 'line 4 is the ask, line 5 the send');
  assert.equal(r.body.lines[2].text, 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,');
  assert.deepEqual(r.body.lines[2].rules, ['3 sections, all under 600 words']);
  assert.deepEqual(r.body.lines[0].rules, []);
  for (const l of r.body.lines) {
    assert.equal(l.kind, 'text');
    assert.equal(l.passed, false, 'no cited-check record: nothing is ticked');
    assert.equal('answer' in l, false, 'and no answer is made up');
  }
  assert.equal(r.body.notCheckedLabel, "Not checked (the AI's own reading)", 'the one label, from the payload (the page holds no copy of it)');
  assert.equal(r.body.gap, null);
  assert.deepEqual(r.body.pages, []);
  assert.equal(r.body.pageNote, null);
  const bytes = readFileSync(w.delivered);
  assert.deepEqual(r.body.delivered, [{ i: 0, path: w.delivered, name: 'job2-run-1-resume-summary-output.json', bytes: bytes.length, state: 'ok', words: null }]);
});

test('/result (waiting at the ask): nothing is saved yet; no gap (a pause is not a red)', async () => {
  const w = await world({ mode: 'park' });
  const r = (await w.get('/api/runs/job2/run-1/result')).body;
  assert.deepEqual(r.delivered, []);
  assert.equal(r.gap, null);
  assert.equal(r.lines.length, 3);
});

test('/result (red): the check\'s own first gap with "(+N more)"; no Saved card; no ticks', async () => {
  const w = await world({ mode: 'red' });
  assert.equal(w.outcome, 'struck-out');
  const r = (await w.get('/api/runs/job2/run-1/result')).body;
  assert.deepEqual(r.delivered, []);
  assert.equal(typeof r.gap.line, 'string');
  assert.ok(r.gap.line.length > 0);
  assert.equal(r.gap.more >= 0, true);
  assert.equal(r.gap.moreText, r.gap.more > 0 ? `(+${r.gap.more} more)` : null);
  assert.ok(r.lines.every((l) => l.passed === false));
});

test('/result: a saved file that changed or is gone is a STATE, said once, never content', async () => {
  const w = await world();
  appendFileSync(w.delivered, ' ');
  let d = (await w.get('/api/runs/job2/run-1/result')).body.delivered[0];
  assert.equal(d.state, 'changed');
  assert.equal(d.words, RESULT_FILE_CHANGED);
  rmSync(w.delivered);
  d = (await w.get('/api/runs/job2/run-1/result')).body.delivered[0];
  assert.equal(d.state, 'gone');
  assert.equal(d.words, RESULT_FILE_GONE);
});

test('/result: a signed page source gives the page link and its note; two pages are listed once each', async () => {
  const URL1 = 'https://example.com/flights?q=BOS';
  const w = await world({ mode: 'park', prose: (p) => p.replace(/guardrail: source jd = file:\S+/, `guardrail: source jd = page:${URL1}`) });
  const r = (await w.get('/api/runs/job2/run-1/result')).body;
  assert.deepEqual(r.pages, [URL1]);
  assert.equal(r.pageNote, RESULT_PAGE_MAY_CHANGE);
  assert.equal((await w.get('/api/runs/job2/run-1')).body.hasResult, true);
});

test('/download: the saved file by index, with attachment + filename* + nosniff; a bad index, a changed file, a gone file and a swapped-in symlink are refused', async () => {
  const w = await world();
  const bytes = readFileSync(w.delivered);
  const ok = await w.get('/api/runs/job2/run-1/download?i=0');
  assert.equal(ok.status, 200);
  assert.equal(ok.raw, bytes.toString('utf8'));
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ok.headers.get('content-disposition'), 'attachment; filename="job2-run-1-resume-summary-output.json"; filename*=UTF-8\'\'job2-run-1-resume-summary-output.json');
  assert.match(ok.headers.get('content-type'), /^application\/json/);
  for (const bad of ['', '1', '-1', '1e2', 'x', '00000000']) assert.equal((await w.get(`/api/runs/job2/run-1/download?i=${bad}`)).status, 404, `i=${bad}`);
  assert.equal((await w.get('/api/runs/job2/run-1/download')).status, 404);
  assert.equal((await w.get('/api/runs/job2/nope/download?i=0')).status, 404);
  // a symlink put where the file was: lstat is not a regular file, so it is "gone", never followed
  const outside = path.join(path.dirname(w.runDir), 'outside.txt');
  writeFileSync(outside, bytes);
  rmSync(w.delivered);
  symlinkSync(outside, w.delivered);
  const sw = await w.get('/api/runs/job2/run-1/download?i=0');
  assert.equal(sw.status, 409);
  assert.equal(sw.raw, RESULT_FILE_GONE);
  // a symlink to a regular file INSIDE the same folder with the very same bytes is still not the file the run wrote
  const twin = path.join(SEND_DIR, 'twin.json');
  rmSync(w.delivered);
  writeFileSync(twin, bytes);
  symlinkSync(twin, w.delivered);
  assert.equal((await w.get('/api/runs/job2/run-1/download?i=0')).status, 409);
  rmSync(w.delivered);
  writeFileSync(w.delivered, 'tampered');
  const ch = await w.get('/api/runs/job2/run-1/download?i=0');
  assert.equal(ch.status, 409);
  assert.equal(ch.raw, RESULT_FILE_CHANGED);
  rmSync(w.delivered);
  assert.equal((await w.get('/api/runs/job2/run-1/download?i=0')).raw, RESULT_FILE_GONE);
});

test('readDelivered: a file whose real path is not inside the signed folder is gone (re-checked at use), whatever its bytes', () => {
  const a = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10am4-a-'));
  const b = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10am4-b-'));
  const f = path.join(a, 'x.json');
  writeFileSync(f, 'same');
  const good = readDelivered({ name: 'x.json', dir: a, sha256: '0967115f2813a3541eaef77de9d9d5773f1c0c04314b0bbfe4ff3b3b1c55b5d5' });
  assert.equal(good.state, 'ok', 'in its own folder it is read');
  assert.equal(readDelivered({ name: 'x.json', dir: a, sha256: '00' }).state, 'changed');
  assert.equal(readDelivered({ name: `../${path.basename(a)}/x.json`, dir: b, sha256: '0967115f2813a3541eaef77de9d9d5773f1c0c04314b0bbfe4ff3b3b1c55b5d5' }).state, 'gone', 'a name that climbs out of the folder is refused, whatever its bytes');
});

test('a flow symlinked outside --root is refused by name on /result and /download too', async () => {
  const w = await world();
  const out = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10am4-out-'));
  symlinkSync(out, path.join(w.root, 'evil'));
  for (const sub of ['result', 'download?i=0']) {
    const r = await w.get(`/api/runs/evil/run-1/${sub}`);
    assert.equal(r.status, 403, sub);
  }
});

// ---- the M10 cited-check record's ONE reader ----
// The `cited` section of `<run>/line-checks.json`. The writer is not built; these tests feed the reader a record made from bareloop's export.
const recordFrom = (g) => ({
  lines: g.lines.map((l) => ({
    n: l.n, source: l.source, passed: l.passed,
    facts: l.facts.map((f, i) => ({ ...f, ...(i === 0 ? { confirmed: true } : {}) })),
    rows: l.rows, notChecked: ['the page says nothing about seats'],
  })),
});
const put = (w, rec) => putCited(w.runDir, rec);

test('readCitedChecks: no file is "not present"; a good record comes back typed; the proof marks are kept', async () => {
  const w = await world({ mode: 'park' });
  assert.deepEqual(readCitedChecks(w.runDir), { present: false });
  put(w, recordFrom(GOLDEN));
  const r = readCitedChecks(w.runDir);
  assert.equal(r.present, true);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].rows.length, 3);
  assert.deepEqual(r.lines[0].rows[0].proof.marks, GOLDEN.lines[0].rows[0].proof.marks);
  assert.equal(r.lines[0].facts[0].confirmed, true);
});

test('readCitedChecks: a malformed record is a named red (never a half-read); a bad proof is dropped to the plain quote', async () => {
  const w = await world({ mode: 'park' });
  put(w, '{not json');
  assert.match(readCitedChecks(w.runDir).red, /not valid JSON/);
  const base = recordFrom(GOLDEN);
  const bad = (edit) => { const r = structuredClone(base); edit(r); put(w, r); return readCitedChecks(w.runDir); };
  assert.match(bad((r) => { r.lines[0].rows[0].cells.pop(); }).red, /cells/, 'a row with fewer cells than facts');
  assert.match(bad((r) => { r.lines[0].passed = 'yes'; }).red, /passed/, 'passed is a boolean');
  assert.match(bad((r) => { r.lines[0].facts[0].kind = 'maybe'; }).red, /kind/);
  assert.match(bad((r) => { r.lines = 'x'; }).red, /lines/);
  const dropped = bad((r) => { r.lines[0].rows[0].proof.marks = [[0, 9999]]; });
  assert.equal(dropped.ok, true);
  assert.equal('proof' in dropped.lines[0].rows[0], false, 'marks past the text: the proof is dropped, the quote is kept');
  assert.equal(dropped.lines[0].rows[0].quote, GOLDEN.lines[0].rows[0].quote);
});

test('/result with a record: the line carries its facts, rows, proof marks, "(you confirmed)", its own page and Not checked; the signed text still wins', async () => {
  const URL1 = GOLDEN.pages[0];
  const w = await world({ mode: 'park', prose: (p) => p.replace(/guardrail: source jd = file:\S+/, `guardrail: source jd = page:${URL1}`) });
  const rec = recordFrom(GOLDEN);
  rec.lines[0].n = 3;
  rec.lines[0].source = 'jd';
  put(w, rec);
  const r = (await w.get('/api/runs/job2/run-1/result')).body;
  const l3 = r.lines.find((l) => l.n === 3);
  assert.equal(l3.kind, 'facts');
  assert.equal(l3.text, 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', 'the job line is the signed one, not the record\'s');
  assert.equal(l3.rows.length, 3);
  assert.deepEqual(l3.rows[0].proof.marks, GOLDEN.lines[0].rows[0].proof.marks);
  assert.equal(l3.facts[0].note, '(you confirmed)');
  assert.equal('note' in l3.facts[1], false);
  assert.equal(l3.page, URL1);
  assert.deepEqual(l3.notChecked, ['the page says nothing about seats']);
  assert.equal(l3.passed, true);
  assert.equal(r.lines.find((l) => l.n === 1).kind, 'text', 'a line the record does not name stays text');
});

test('/result with a malformed record: the lines fall back to "no saved result to show" (kind text), the route still answers', async () => {
  const w = await world({ mode: 'park' });
  put(w, '{not json');
  const r = await w.get('/api/runs/job2/run-1/result');
  assert.equal(r.status, 200);
  assert.ok(r.body.lines.every((l) => l.kind === 'text'));
});

// M10 am9 item 2: every job without a web page lists the checks its step ran, from the run's own diary.jsonl (checks rows), that step's NEWEST try; code writes them.
test('am9: a sheet/doc job line lists every check of its step\'s newest try, ✓ or ✗, in the Audit try line\'s words; the failed one carries its reason', async () => {
  const w = await world({ mode: 'red' });
  const r = (await w.get('/api/runs/job2/run-1/result')).body;
  const l1 = r.lines.find((l) => l.n === 1);
  assert.deepEqual(l1.checks, [
    { ok: true, text: 'the output exists and isn\'t empty', result: '27 B' },
    { ok: true, text: 'the model said done: true', result: null },
  ]);
  const l3 = r.lines.find((l) => l.n === 3);
  assert.equal(l3.checks.length, 5, 'try 3 only, not the three tries together');
  assert.equal(l3.checks[3].text, 'at most 600 words');
  assert.equal(l3.checks[3].result, '4 words');
  assert.equal(l3.checks[4].ok, false);
  assert.match(l3.checks[4].result, /no line is exactly the heading/, 'a failed check keeps its reason');
});

test('am9: the checks come from the NEWEST try (a later try replaces an earlier one)', async () => {
  const w = await world({ mode: 'red' });
  appendFileSync(path.join(w.root, 'job2', 'runs', 'run-1', 'diary.jsonl'), `${JSON.stringify({
    kind: 'checks', step: 'resume-summary', try: 4, at: '2026-10-21T00:00:00Z', lastRound: 0, checks: [{ n: 1, text: 'the output exists and isn\'t empty', ok: true, result: '9 B', source: 'every step' }], output: null,
  })}\n`);
  const l3 = (await w.get('/api/runs/job2/run-1/result')).body.lines.find((l) => l.n === 3);
  assert.deepEqual(l3.checks, [{ ok: true, text: 'the output exists and isn\'t empty', result: '9 B' }]);
});

test('am9: a page job\'s lines are bareloop\'s card: no checks list', async () => {
  const URL1 = GOLDEN.pages[0];
  const w = await world({ mode: 'park', prose: (p) => p.replace(/guardrail: source jd = file:\S+/, `guardrail: source jd = page:${URL1}`) });
  const r = (await w.get('/api/runs/job2/run-1/result')).body;
  assert.ok(r.lines.every((l) => l.checks.length === 0));
});
