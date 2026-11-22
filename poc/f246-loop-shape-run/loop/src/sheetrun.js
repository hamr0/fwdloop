// borrowed-from: bareloop src/sheetrun.js@v0.61.0 (fc56e1f3)
// borrowed-from: fwdloop src/sheetrun.js@v0.35.0 (M10b piece 2; docs/product/ITEM33-BUILD.md "Addendum 2026-11-17", S3). A sheet check in a run:
//   - the freeze (`freezeSheets`, run start): each CSV input a stage's `sheet` part reads gets its `tableSha` (bareguard's fingerprint of the table made from the run's FROZEN copy) recorded once beside the input in
//     `source.json`, and its row-numbered view (`input/<sheet>.rows.txt`, hamr's (ii)) written beside it and committed into the seed. The view is derived and never graded; the sha comes from the CSV only;
//   - the read (`readStageSheets`, stage close): the frozen copy, as bareguard's table, held to the recorded sha (the file bytes against the door's sha256 too). bareguard compares the table to the recorded sha when it checks
//     and stops if it differs (src/rubricstep.js `gradeStep` names the input);
//   - the report (`sheetReportLines` + `deliveredAmender`, at delivery): for each sumIf/countIf the plain line of code's own total/count of the rows the worker named (hamr's (iii)), appended to the end of the DELIVERED copy's `text` only.
// Adapted: fwd read `run.json` and its inputs manifest (`readRunInputs`), and `closeSheet` called `checkStep` itself; bareloop's frozen tree + `source.json` is the record, and the judge is `gradeStep` (the stage close in
// src/kinds.js `runRubricStep`), which builds the rubric from the signed `sheet` part. fwd's `tableChecksFailingOnInput` is `tableCheckFails` in src/sheetbuild.js (S2).
// Throws away: bareguard's `full` expected values are never kept here; a red keeps the gaps, which name rows and counts, never a cell's text.
// Third outcomes, each named, never green: a sheet the run recorded no fingerprint for, a frozen copy that is missing or changed, a table bareguard cannot read (ragged row, repeated header).
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tableSha } from 'bareguard';
import { parseCsv, sheetTable } from './csv.js';
import { readSourceManifest, commitFrozenFiles } from './source.js';
import { sheetRolesOf, sheetRolesOfParams, sheetChecksOf, sheetViewRel, sheetNumberedView, sheetTotalLines, ROW_MATH_OPS } from './sheetclaims.js';
import { sha256Of, stepFileRel } from './rubricstep.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const SHA_RE = /^[0-9a-f]{64}$/;

/**
 * RUN START: freeze every sheet a rubric-step stage reads (see the file head). A job with no `sheet` part changes nothing (`seed: null`, the record and the tree untouched). Never throws; every refusal ends
 * "The run did not start. Nothing spent." and leaves the record as it was.
 * @param {{into: string, closeDecl: any}} o `into` - the prepared copy (source.json + tree/)
 * @returns {Promise<{ok: true, seed: string|null, roles: string[]}|{ok: false, error: string}>}
 */
export async function freezeSheets({ into, closeDecl }) {
  const roles = sheetRolesOf(closeDecl);
  if (roles.length === 0) return { ok: true, seed: null, roles };
  const got = await sheetsOfInputs({ into, roles, tail: ' The run did not start. Nothing spent.' });
  if (!got.ok) return got;
  const { manifest, tree, made } = got;
  for (const v of made.values()) await writeFile(join(tree, v.view), v.viewText);
  const commit = await commitFrozenFiles(tree, 'bareloop: run start - the numbered view of each sheet');
  if (!commit.ok) return { ok: false, error: `${commit.error}. The run did not start. Nothing spent.` };
  const inputs = manifest.inputs.map((/** @type {any} */ r) => (made.has(r?.label) ? { ...r, tableSha: made.get(r.label)?.tableSha, view: made.get(r.label)?.view } : r));
  await writeFile(join(resolve(into), 'source.json'), `${JSON.stringify({ ...manifest, inputs, seed: commit.seed }, null, 2)}\n`);
  return { ok: true, seed: commit.seed, roles };
}

/**
 * DRAFTING (S4): the draft's seed read grades the sheet stage at the seed, and that stage reads the `tableSha` its run recorded at its start. A draft has no run start, so the draft records the same fingerprint, from the
 * same frozen copy, beside the input in `source.json` - the one thing a draft needs; the numbered view and the seed commit are the run's own (`freezeSheets`) and the seed read never needs them (the step file is not there yet).
 * Never throws; a sheet that cannot be read as a table is refused in the words of the run start.
 * @param {{into: string, closeDecl: any}} o @returns {Promise<{ok: true, roles: string[]}|{ok: false, error: string}>}
 */
export async function recordSheetShas({ into, closeDecl }) {
  const roles = sheetRolesOf(closeDecl);
  if (roles.length === 0) return { ok: true, roles };
  const got = await sheetsOfInputs({ into, roles, tail: '' });
  if (!got.ok) return got;
  const inputs = got.manifest.inputs.map((/** @type {any} */ r) => (got.made.has(r?.label) ? { ...r, tableSha: got.made.get(r.label)?.tableSha } : r));
  await writeFile(join(resolve(into), 'source.json'), `${JSON.stringify({ ...got.manifest, inputs }, null, 2)}\n`);
  return { ok: true, roles };
}

/**
 * The frozen copy of each sheet role, read as bareguard's table: its `tableSha` (the fingerprint of the table, from the CSV only) and the text of its numbered view. The ONE reader of "which sheets, and are they tables" for the run start and the draft.
 * `tail` ends every refusal: at the run start " The run did not start. Nothing spent.", at the draft nothing.
 * @param {{into: string, roles: string[], tail: string}} o
 * @returns {Promise<{ok: true, manifest: any, tree: string, made: Map<string, {tableSha: string, view: string, viewText: string}>}|{ok: false, error: string}>}
 */
async function sheetsOfInputs({ into, roles, tail }) {
  const refuse = (/** @type {string} */ words) => ({ ok: /** @type {const} */ (false), error: `${words}${tail}` });
  const read = await readSourceManifest(into);
  if (read.stop !== null) return { ok: false, error: read.stop };
  if (!read.present || !read.manifest) return refuse('This job reads a sheet, but the run has no record of its inputs.');
  const manifest = read.manifest;
  const tree = join(resolve(into), 'tree');
  /** @type {Map<string, {tableSha: string, view: string, viewText: string}>} */
  const made = new Map();
  for (const role of roles) {
    const row = Array.isArray(manifest.inputs) ? manifest.inputs.find((/** @type {any} */ r) => r && r.label === role) : undefined;
    if (!row || typeof row.rel !== 'string' || typeof row.sha256 !== 'string') return refuse(`The job reads the sheet "${role}", but it has no input with that label.`);
    let buf;
    try { buf = await readFile(join(tree, row.rel)); } catch (e) { return refuse(`Input "${role}" (${row.rel}) could not be read: ${/** @type {Error} */ (e).message}.`); }
    if (sha256Of(buf) !== row.sha256) return refuse(`Input "${role}" (${row.rel}) no longer matches the bytes frozen at the source door.`);
    const text = buf.toString('utf8');
    const parsed = parseCsv(text);
    const table = sheetTable(parsed);
    const sha = tableSha(table);
    if (sha === null) return refuse(`Input "${role}": the sheet cannot be read as a table (a row with more or fewer cells than the header, or a repeated column name); fix the sheet.`);
    // the header's own line: the first line with anything on it (a blank line is no row but still counts)
    const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const headerLine = body.split('\n').findIndex((l) => l.replace(/\r$/, '') !== '') + 1;
    const view = sheetViewRel(row.rel);
    made.set(role, { tableSha: sha, view, viewText: sheetNumberedView(text, [headerLine, ...table.rows.map((r) => r.rowNumber)]) });
  }
  return { ok: true, manifest, tree, made };
}

/**
 * STAGE CLOSE: what a sheet stage reads in a run: the run's OWN frozen copy of each sheet its `sheet` part names, as bareguard's table, and the `tableSha` recorded at the run's start (the record is `source.json`'s
 * input rows, already read by the caller). The table is NOT compared here: bareguard compares it to the recorded sha when it checks (and stops if it differs); the file's bytes are held to the door's sha256 here.
 * @param {{workdir: string, recorded: any[], params: any}} o
 * @returns {Promise<{ok: true, roles: string[], tables: Record<string, {header: string[], rows: {rowNumber: number, cells: string[]}[]}>, shas: Record<string, string>}|{ok: false, why: string}>}
 */
export async function readStageSheets({ workdir, recorded, params }) {
  const roles = sheetRolesOfParams(params);
  /** @type {Record<string, any>} */
  const tables = {};
  /** @type {Record<string, string>} */
  const shas = {};
  for (const role of roles) {
    const row = recorded.find((/** @type {any} */ r) => r && r.label === role);
    if (!row || typeof row.rel !== 'string' || typeof row.sha256 !== 'string') return { ok: false, why: `the step reads the sheet "${role}", but the source record has no input with that label` };
    if (typeof row.tableSha !== 'string' || !SHA_RE.test(row.tableSha)) return { ok: false, why: `input "${role}": this run recorded no table fingerprint for it at its start` };
    let buf;
    try { buf = await readFile(join(workdir, row.rel)); } catch (e) { return { ok: false, why: `input "${role}" (${row.rel}) could not be read: ${/** @type {Error} */ (e).message}` }; }
    if (sha256Of(buf) !== row.sha256) return { ok: false, why: `input "${role}" (${row.rel}) no longer matches the bytes frozen at the source door - the saved sheet is not the one this run recorded at its start` };
    tables[role] = sheetTable(parseCsv(buf.toString('utf8')));
    shas[role] = row.tableSha;
  }
  return { ok: true, roles, tables, shas };
}

/**
 * The report lines of a green run, by delivered file: for each rubric-step stage whose sheet part holds a sumIf or countIf, code's own line(s) computed from the frozen table and the rows the worker named
 * (`sheetTotalLines`), keyed by the step file's path under `output/` (`steps/<n>.json`). The worker's own number is never read. A stage with no such check, or no step file, has no entry. Reads only; writes nothing.
 * @param {{workdir: string, closeDecl: any}} o @returns {Promise<{ok: true, byRel: Record<string, string[]>}|{ok: false, error: string}>}
 */
export async function sheetReportLines({ workdir, closeDecl }) {
  /** @type {Record<string, string[]>} */
  const byRel = {};
  const stages = (Array.isArray(closeDecl?.stages) ? closeDecl.stages : []).filter((/** @type {any} */ st) => isRec(st) && st.kind === 'rubric-step' && isRec(st.params)
    && sheetChecksOf(st.params).some((c) => ROW_MATH_OPS.includes(c.op)));
  if (stages.length === 0) return { ok: true, byRel };
  /** @type {any} */
  let manifest;
  try { manifest = JSON.parse(await readFile(join(dirname(workdir), 'source.json'), 'utf8')); } catch (e) { return { ok: false, error: `the source record could not be read: ${/** @type {Error} */ (e).message}` }; }
  const recorded = Array.isArray(manifest?.inputs) ? manifest.inputs : [];
  for (const st of stages) {
    const step = st.params.step;
    /** @type {any} */
    let obj;
    try { obj = JSON.parse(await readFile(join(workdir, stepFileRel(step)), 'utf8')); } catch { continue; }
    const sheets = await readStageSheets({ workdir, recorded, params: st.params });
    if (!sheets.ok) return { ok: false, error: sheets.why };
    const lines = sheetTotalLines(sheetChecksOf(st.params), isRec(obj) ? obj.claims : null, sheets.tables);
    if (lines.length > 0) byRel[stepFileRel(step).replace(/^output\//, '')] = lines;
  }
  return { ok: true, byRel };
}

/**
 * The DELIVERED copy of a step file with code's lines at the END of its `text`: one blank line, then the lines. The file stays valid JSON, every other key as written. A file that is not a JSON object
 * with a string `text` is returned unchanged (it cannot have been graded green).
 * @param {Buffer} buf the step file as the worker wrote it @param {string[]} lines @returns {Buffer}
 */
export function amendReport(buf, lines) {
  /** @type {any} */
  let obj;
  try { obj = JSON.parse(buf.toString('utf8')); } catch { return buf; }
  if (!isRec(obj) || typeof obj.text !== 'string') return buf;
  return Buffer.from(`${JSON.stringify({ ...obj, text: `${obj.text}\n\n${lines.join('\n')}` }, null, 2)}\n`, 'utf8');
}

/** `copyOut`'s `amend` hook for the delivered copy only (never the graded tree file): `(rel under output/, bytes) => bytes` @param {Record<string, string[]>} byRel @returns {(rel: string, buf: Buffer) => Buffer} */
export function deliveredAmender(byRel) {
  return (rel, buf) => (Object.hasOwn(byRel, rel) ? amendReport(buf, byRel[rel]) : buf);
}
