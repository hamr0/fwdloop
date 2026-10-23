// M10b piece 2 (docs/wiki/the-module-ladder.md "M10b scope" items 5-6 and amendment 1): a sheet check at RUN time.
//   - the lock: at run start each CSV input a step's `close.sheet` names gets its `tableSha` (bareguard's fingerprint of the table made from the run's frozen copy)
//     written down once with that run's inputs (`freezeInputs` is the one writer of inputs.json and calls `tableShaOfFile`); here is how it is read back;
//   - the judge: `closeSheet` hands the signed checks, the step's typed answer and the run's table to bareguard's `checkStep`. No model grades.
// Third outcomes, each named, never green: a sheet the run recorded no fingerprint for, a frozen copy that is missing, a table that no longer gives the recorded
// `tableSha` (bareguard stops the check; the red names the input), any other stopped check.
// Throws away: bareguard's `full` (expected values, evidence) is not kept - the red keeps the gaps, which name rows and counts and never a cell's text.
import { basename } from 'node:path';
import { createRubric, checkStep, renderGaps, tableSha } from 'bareguard';
import { parseCsv, sheetTable } from './csv.js';
import { readFileInside } from './flow.js';
import { sheetCheckSentence, bareguardChecks } from './sheetchecks.js';
import { sheetCheckName, sheetFoundWords } from './sheetblock.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The sheet inputs any step's `close.sheet` reads, once each, in order. @param {any[]} steps @returns {string[]} */
export function sheetRolesOf(steps) {
  const roles = [];
  for (const s of Array.isArray(steps) ? steps : []) {
    const list = s?.close?.class === 'green' && Array.isArray(s.close.sheet) ? s.close.sheet : [];
    for (const c of list) if (isRec(c) && typeof c.table === 'string' && !roles.includes(c.table)) roles.push(c.table);
  }
  return roles;
}

/**
 * bareguard's `tableSha` of the run's frozen CSV `<runDir>/inputs/<name>` (its table from src/csv.js `sheetTable`), read through the one safe gateway; null when the copy
 * cannot be read or bareguard cannot read it as a table (a ragged row, a repeated header).
 * @param {string} runDir @param {string} name the frozen file's name @returns {string|null}
 */
export function tableShaOfFrozen(runDir, name) {
  const file = readFileInside(runDir, `inputs/${name}`);
  return file.ok ? tableSha(sheetTable(parseCsv(file.text))) : null;
}

const SHA_RE = /^[0-9a-f]{64}$/;

/**
 * What a sheet check reads in a run: the run's OWN frozen copy of each sheet its checks name, as bareguard's table, and the `tableSha` recorded in `inputs.json` at
 * the run's start. The table is NOT compared here: bareguard compares it to the recorded sha when it checks (and stops if it differs).
 * @param {string} runDir @param {any[]} checks the step's `close.sheet`
 * @returns {{ok: true, tables: Record<string, {header: string[], rows: any[]}>, inputs: Array<{name: string, sha256: string}>}|{ok: false, red: string}}
 */
export function readRunSheets(runDir, checks) {
  const manifest = readFileInside(runDir, 'inputs.json');
  if (!manifest.ok) return { ok: false, red: manifest.missing ? 'this run has no frozen inputs' : `inputs.json: ${manifest.red}` };
  let entries;
  try { entries = JSON.parse(manifest.text); } catch (err) { return { ok: false, red: `inputs.json is not valid JSON - ${/** @type {any} */ (err).message}` }; }
  /** @type {Record<string, any>} */
  const tables = {};
  const inputs = [];
  for (const c of checks) {
    const role = isRec(c) ? c.table : undefined;
    if (typeof role !== 'string' || role in tables) continue;
    const entry = Array.isArray(entries) ? entries.find((e) => e?.id === role) : undefined;
    if (!entry || typeof entry.frozen !== 'string') return { ok: false, red: `input "${role}": this run froze no input with that name` };
    if (typeof entry.tableSha !== 'string' || !SHA_RE.test(entry.tableSha)) return { ok: false, red: `input "${role}": this run recorded no table fingerprint for it at its start` };
    const file = readFileInside(runDir, `inputs/${basename(entry.frozen)}`);
    if (!file.ok) return { ok: false, red: file.missing ? `input "${role}": the frozen copy is missing` : `input "${role}": ${file.red}` };
    tables[role] = sheetTable(parseCsv(file.text));
    inputs.push({ name: role, sha256: entry.tableSha });
  }
  return { ok: true, tables, inputs };
}

/**
 * The close of a green step that reads a sheet. `sheet` = `readRunSheets`' answer. `artifact` is the step's typed answer (its claim boxes). Gaps come from bareguard
 * (`renderGaps`: row numbers and counts, a data problem first); each signed check is also listed with its own pass or fail for the Checked list.
 * @param {any[]} checks the step's `close.sheet` @param {unknown} artifact @param {ReturnType<typeof readRunSheets>|null|undefined} sheet
 * @returns {Promise<import('./types.js').CloseVerdict>}
 */
export async function closeSheet(checks, artifact, sheet) {
  try {
    if (!sheet || sheet.ok !== true) {
      const red = sheet && sheet.ok === false ? sheet.red : 'the run gave the check no saved sheet to read';
      return /** @type {any} */ ({ verdict: 'unparseable', red: `sheet close: ${red}` });
    }
    if (!isRec(artifact)) return /** @type {any} */ ({ verdict: 'unparseable', red: 'a sheet step must answer with an object, one field per check named in its job' });
    const rubric = createRubric({ schema: 1, goal: 'sheet', inputs: sheet.inputs, checkpoints: { sheet: { gating: true, checks: bareguardChecks(checks) } }, maxReds: 3 });
    const res = await checkStep(rubric, 'sheet', artifact, { tables: sheet.tables });
    if (res.verdict === 'stopped') {
      const moved = sheet.inputs.filter((i) => tableSha(sheet.tables[i.name]) !== i.sha256).map((i) => i.name);
      if (moved.length > 0) {
        return /** @type {any} */ ({ verdict: 'crash', red: `sheet close stopped: input ${moved.map((n) => `"${n}"`).join(', ')} - the saved sheet no longer gives the table this run recorded at its start` });
      }
      const fault = res.fault;
      return /** @type {any} */ ({ verdict: 'crash', red: `sheet close stopped: the ${fault?.id ?? 'sheet'} check stopped (${fault?.kind ?? 'no detail'}${fault?.detail ? `: ${fault.detail}` : ''})` });
    }
    const gaps = res.verdict === 'red' ? res.gaps : [];
    const rows = checks.map((c) => {
      const mine = gaps.filter((g) => g.id === c.id);
      // M10b piece 4: the Audit / Checked row is `<short name> — <plain words>`, with what the step claimed (green) or bareguard's gap words (red) as its result
      return { id: c.id, text: `${sheetCheckName(c)} \u2014 ${sheetCheckSentence(c)}`, ok: mine.length === 0, result: mine.length === 0 ? sheetFoundWords(c, artifact) : renderGaps(mine) };
    });
    const sheetRecord = { inputs: sheet.inputs, claims: artifact, checks: rows.map((r) => ({ id: r.id, text: r.text, ok: r.ok, result: r.ok ? null : r.result })) };
    if (res.verdict === 'red') {
      const red = renderGaps(gaps) || 'a sheet check failed';
      return /** @type {any} */ ({ verdict: 'red', red, reds: [red], checks: rows, sheetRecord });
    }
    return /** @type {any} */ ({ verdict: 'green', red: null, reds: [], checks: rows, sheetRecord });
  } catch (err) {
    return /** @type {any} */ ({ verdict: 'crash', red: `sheet close crashed: ${/** @type {any} */ (err).message}` });
  }
}
