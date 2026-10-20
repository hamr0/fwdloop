// M10 amendment 4 (docs/wiki/the-module-ladder.md): the Result tab's server side.
//
// borrowed-from: bareloop src/panel/server.js@2959217 (getRunResult :1347, getRunDownload :1470, readDelivered :1186, the strings :1165-1308), adjusted to
// fwdloop's books: a run is (flow, runId); the job lines are the run's own signed copy; the saved file is the send step's file, found by the accepted
// ask's recorded hash; a page link is a signed `page:` source. The tab only SHOWS what the books hold; it never decides a check.
//
// Every file read goes through `readFileInside` (src/flow.js); this module imports no fs.
// What it throws away: any file but the ones a signed send wrote; any record field this module does not name (the cited-check record is read by
// `readCitedChecks` and nothing else). A malformed cited-check record is "no record" for the tab (the lines say "no saved result to show").

import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';

import { readFileInside } from '../flow.js';
import { isCellsPath } from '../closers.js';
import { readAcceptedHashesByEmits } from '../ask.js';
import { NOT_CHECKED_LABEL } from '../checked.js';
import { checkSendDestination } from '../runner.js';

/** the two sentences for a saved file that is no longer what the run wrote (code-owned, one spelling) */
export const RESULT_FILE_GONE = 'the saved file is gone';
export const RESULT_FILE_CHANGED = 'the saved file changed after the run';
/** the words beside a Result-tab page link: the page is read again from the web, so it can differ from what the run read */
export const RESULT_PAGE_MAY_CHANGE = 'The page may have changed since this run.';
/** the words after a fact whose limit the person agreed to */
export const RESULT_YOU_CONFIRMED = '(you confirmed)';
/** the M10 cited-check record, in the run's own folder. Its writer is not built yet; `readCitedChecks` is the one reader. */
export const CITED_CHECKS_FILE = 'cited-checks.json';

/** end-row outcomes that are not a failure of the job */
const NOT_FAILED = new Set(['complete', 'stopped', 'cap-halt', 'rerun', 'ask-expired']);
const FACT_KINDS = new Set(['phrase', 'value']);
const isInt = (x) => Number.isInteger(x);
const isStr = (x) => typeof x === 'string';

/**
 * M10 job = the run reads a web page, a CSV or a .docx (ladder, M10 am4 item 1). Read off the signed arbiter, never the run's files.
 * @param {any} arbiter @returns {boolean}
 */
export function isResultRun(arbiter) {
  const sources = Array.isArray(arbiter?.sources) ? arbiter.sources : [];
  return sources.some((s) => s && (s.kind === 'page' || (isStr(s.path) && (isCellsPath(s.path) || s.path.toLowerCase().endsWith('.docx')))));
}

/** The run's check type: its distinct close classes, in step order (`hitl + softgreen`). `—` for a declaration with none.
 *  @param {any} declaration @returns {string} */
export function checkTypeOf(declaration) {
  const seen = [];
  for (const s of Array.isArray(declaration?.steps) ? declaration.steps : []) {
    const c = s?.close?.class;
    if (isStr(c) && !seen.includes(c)) seen.push(c);
  }
  return seen.length > 0 ? seen.join(' + ') : '—';
}

/**
 * The proof of one result, kept only when every mark is a real span of its text: integer `[start, end]`, 0 <= start < end <= text length, sorted and not
 * overlapping. Anything else is `null`: the page then shows the plain quote (bareloop's "no proof" path), never marks cut at wrong offsets.
 * @param {any} p @returns {{text: string, marks: number[][]}|null}
 */
function readProof(p) {
  if (!p || !isStr(p.text) || !Array.isArray(p.marks)) return null;
  let at = 0;
  for (const m of p.marks) {
    if (!Array.isArray(m) || m.length !== 2 || !isInt(m[0]) || !isInt(m[1]) || m[0] < at || m[1] <= m[0] || m[1] > p.text.length) return null;
    at = m[1];
  }
  return { text: p.text, marks: p.marks.map((m) => [m[0], m[1]]) };
}

/**
 * The ONE reader of the M10 cited-check record (`<run>/cited-checks.json`). Expected shape (typed, nothing parsed out of prose):
 *   { lines: [ { n: int, source: string (the role of a signed source), passed: boolean,
 *                facts: [ { name: string, kind: 'phrase'|'value', sentence: string, confirmed?: true } ],
 *                rows: [ { n: int, quote: string, cells: string[] (one per fact), proof?: { text: string, marks: [[start, end], ...] } } ] | null,
 *                notChecked?: string[] } ] }
 * `{present:false}` = no file. `{present:true, ok:false, red}` = a record that does not match (named, never half-read). Else `{present:true, ok:true, lines}`.
 * @param {string} runDir
 * @returns {{present: false}|{present: true, ok: false, red: string}|{present: true, ok: true, lines: any[]}}
 */
export function readCitedChecks(runDir) {
  const r = readFileInside(runDir, CITED_CHECKS_FILE);
  if (!r.ok) return r.missing ? { present: false } : { present: true, ok: false, red: r.red };
  /** @param {string} why @returns {{present: true, ok: false, red: string}} */
  const red = (why) => ({ present: true, ok: false, red: `${CITED_CHECKS_FILE}: ${why}` });
  let rec;
  try { rec = JSON.parse(r.text); } catch { return red('not valid JSON'); }
  if (!rec || !Array.isArray(rec.lines)) return red('"lines" is not a list');
  const lines = [];
  for (const l of rec.lines) {
    if (!l || !isInt(l.n) || !isStr(l.source)) return red('a line needs an integer "n" and a "source"');
    if (typeof l.passed !== 'boolean') return red(`line ${l.n}: "passed" is not true or false`);
    if (!Array.isArray(l.facts)) return red(`line ${l.n}: "facts" is not a list`);
    const facts = [];
    for (const f of l.facts) {
      if (!f || !isStr(f.name) || !isStr(f.sentence)) return red(`line ${l.n}: a fact needs a "name" and a "sentence"`);
      if (!FACT_KINDS.has(f.kind)) return red(`line ${l.n}: fact "${f.name}" has a "kind" that is not phrase or value`);
      facts.push({ name: f.name, kind: f.kind, sentence: f.sentence, ...(f.confirmed === true ? { confirmed: true } : {}) });
    }
    let rows = null;
    if (l.rows !== null && l.rows !== undefined) {
      if (!Array.isArray(l.rows)) return red(`line ${l.n}: "rows" is not a list`);
      rows = [];
      for (const w of l.rows) {
        if (!w || !isInt(w.n) || !isStr(w.quote)) return red(`line ${l.n}: a row needs an integer "n" and a "quote"`);
        if (!Array.isArray(w.cells) || w.cells.length !== facts.length || !w.cells.every(isStr)) return red(`line ${l.n}, result ${w.n}: "cells" must be one text per fact (${facts.length})`);
        const proof = readProof(w.proof);
        rows.push({
          n: w.n, quote: w.quote, ...(proof ? { proof } : {}), cells: [...w.cells],
        });
      }
    }
    const nc = Array.isArray(l.notChecked) ? l.notChecked.filter((x) => isStr(x) && x.trim() !== '') : [];
    lines.push({
      n: l.n, source: l.source, passed: l.passed, facts, rows, notChecked: nc,
    });
  }
  return { present: true, ok: true, lines };
}

/** the signed `page:` sources, role -> address (http(s) only: the parser already refuses any other) @param {any} arbiter @returns {Map<string, string>} */
function pageUrlsByRole(arbiter) {
  const out = new Map();
  for (const s of Array.isArray(arbiter?.sources) ? arbiter.sources : []) if (s && s.kind === 'page' && isStr(s.path)) out.set(s.role, s.path);
  return out;
}

/**
 * One saved file, read for the tab or a download, through the one safe gateway (`readFileInside`: not a symlink, real path inside the signed folder's
 * real path, checked at USE time). It must also still hash to the recorded sha256. A missing, refused or changed file is a state, never content:
 * stale bytes are never returned. (Text read, so a file that is not UTF-8 reads as "changed", never as ok.)
 * @param {{name: string, dir: string|null, sha256: string|null}} rec
 * @returns {{state: 'ok', buf: Buffer}|{state: 'gone'|'changed', buf: null}}
 */
export function readDelivered(rec) {
  if (rec.dir === null) return { state: 'gone', buf: null };
  const r = readFileInside(rec.dir, rec.name);
  if (!r.ok) return { state: 'gone', buf: null };
  const buf = Buffer.from(r.text, 'utf8');
  if (rec.sha256 === null || createHash('sha256').update(buf).digest('hex') !== rec.sha256) return { state: 'changed', buf: null };
  return { state: 'ok', buf };
}

/**
 * The files this run's signed sends wrote: for each signed send whose send step ended green in the audit, the file `<flow>-<runId>-<emits>.json`
 * in the signed folder, with the sha256 the human's accept recorded for the ask that send reads (`readAcceptedHashesByEmits`, the same record the
 * send itself checked). No accepted hash = recorded as null, which reads as "changed", never as ok.
 * @returns {{path: string, dir: string|null, name: string, sha256: string|null}[]}
 */
export function deliveredOf({
  arbiter, declaration, runDir, root, flow, runId, auditRows,
}) {
  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const askLines = new Set((arbiter?.asks ?? []).map((a) => a.line));
  const askEmits = new Set(steps.filter((s) => askLines.has(s.fromLine)).map((s) => s.emits));
  const hashes = readAcceptedHashesByEmits(runDir);
  const out = [];
  for (const send of arbiter?.sends ?? []) {
    const step = steps.find((s) => s.fromLine === send.line);
    if (!step || !auditRows.some((r) => r.step === step.emits && r.verdict === 'green')) continue; // eslint-disable-line no-continue
    const name = `${flow}-${runId}-${step.emits}.json`;
    const dest = checkSendDestination(`${send.target.kind}:${send.target.path}`, { root, runDir });
    const [askId] = (step.reads ?? []).filter((id) => askEmits.has(id));
    out.push({
      path: join(dest.ok ? dest.dir : send.target.path, name), dir: dest.ok ? dest.dir : null, name,
      sha256: hashes.ok && askId !== undefined ? (hashes.byEmits.get(askId) ?? null) : null,
    });
  }
  return out;
}

/** the check's own gap for a RED run: its first line and how many more @param {string|null} text @returns {{line: string, more: number, moreText: string|null}|null} */
function gapOf(text) {
  const rows = isStr(text) ? text.split('\n').map((x) => x.trim()).filter((x) => x !== '') : [];
  if (rows.length === 0) return null;
  const more = rows.length - 1;
  return { line: rows[0], more, moreText: more > 0 ? `(+${more} more)` : null };
}

/**
 * The Result tab's JSON for one run (`GET /api/runs/:flow/:runId/result`).
 * @param {{flow: string, runId: string, runDir: string, root: string, flowRead: any, arbiter: any, historyRow: any, auditRows: any[], logJson: any, notChecked: string[]}} a
 */
export function buildResult({
  flow, runId, runDir, root, flowRead, arbiter, historyRow, auditRows, logJson, notChecked,
}) {
  const declaration = flowRead.declaration;
  const taken = new Set([...(arbiter?.asks ?? []), ...(arbiter?.sends ?? [])].map((x) => x.line));
  const cited = readCitedChecks(runDir);
  const record = cited.present && cited.ok ? cited.lines : [];
  const urls = pageUrlsByRole(arbiter);
  const lines = flowRead.lines.filter((l) => !taken.has(l.n)).map((l) => {
    const c = record.find((x) => x.n === l.n) ?? null;
    const out = {
      notChecked: c ? c.notChecked : [], n: l.n, text: l.text, rules: isStr(l.guardrail) && l.guardrail !== '' ? [l.guardrail] : [],
      kind: c ? 'facts' : 'text', passed: c ? c.passed : false, file: null,
    };
    if (c) {
      out.source = c.source;
      out.page = urls.get(c.source) ?? null;
      out.facts = c.facts.map((f) => ({
        name: f.name, kind: f.kind, sentence: f.sentence, ...(f.confirmed ? { note: RESULT_YOU_CONFIRMED } : {}),
      }));
      out.rows = c.rows;
    }
    return out;
  });
  const delivered = deliveredOf({
    arbiter, declaration, runDir, root, flow, runId, auditRows,
  }).map((d, i) => {
    const got = readDelivered(d);
    return {
      i, path: d.path, name: d.name, bytes: got.buf ? got.buf.length : null, state: got.state,
      words: got.state === 'gone' ? RESULT_FILE_GONE : (got.state === 'changed' ? RESULT_FILE_CHANGED : null),
    };
  });
  // a run that failed delivered nothing: say its own first gap, never rows. A stop, a cap halt, a rerun and an expired ask are not a failure (the same
  // set `computeGlyph` colours `[✗]` by exclusion); a pause has no end row at all.
  let gap = null;
  if (historyRow && !NOT_FAILED.has(historyRow.outcome)) {
    const redRow = auditRows.findLast((r) => r.verdict === 'red' || r.verdict === 'not-done');
    gap = gapOf(isStr(logJson?.red) && logJson.red !== '' ? logJson.red : (redRow ? `${redRow.step}: ${redRow.gap}` : null));
  }
  const pages = [...new Set(urls.values())];
  return {
    flow, runId, lines, pages, pageNote: pages.length ? RESULT_PAGE_MAY_CHANGE : null, notCheckedLabel: NOT_CHECKED_LABEL.charAt(0).toUpperCase() + NOT_CHECKED_LABEL.slice(1), notChecked, delivered, gap,
  };
}

/** download content types by extension; anything else is plain bytes */
const DOWNLOAD_TYPES = { '.json': 'application/json', '.md': 'text/plain', '.txt': 'text/plain', '.csv': 'text/csv' };

/**
 * `GET /api/runs/:flow/:runId/download?i=<n>` — saved file `n` (an index into the run's own list), or why not. The path is the books', never the request's.
 * @param {{index: unknown, ctx: any}} a
 * @returns {{ok: true, name: string, type: string, buf: Buffer}|{ok: false, code: number, error: string}}
 */
export function downloadOf({ index, ctx }) {
  const list = deliveredOf(ctx);
  const i = typeof index === 'string' && /^\d{1,6}$/.test(index) ? Number(index) : -1;
  if (i < 0 || i >= list.length) return { ok: false, code: 404, error: 'this run saved no such file' };
  const got = readDelivered(list[i]);
  if (got.state !== 'ok') return { ok: false, code: 409, error: got.state === 'gone' ? RESULT_FILE_GONE : RESULT_FILE_CHANGED };
  const name = basename(list[i].path);
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  return { ok: true, name, type: Object.hasOwn(DOWNLOAD_TYPES, ext) ? DOWNLOAD_TYPES[ext] : 'application/octet-stream', buf: /** @type {Buffer} */ (got.buf) };
}
