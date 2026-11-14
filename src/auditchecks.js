// M16 item 5 (docs/wiki/the-module-ladder.md, "M16"): the Audit's "Checks" fold, the card's own sections (Checks, Not checked, Always checked), each row with its tag and, after the run, its recorded result.
// borrowed-from: bareloop src/panel/jobplan.js@v0.56.0 (3383cce) (auditChecksOf: the sections, the row shape {text, by, result}, a row no verdict was recorded for is "none", never "passed")
// What a run recorded for a check is read off its diary (`checks` rows: each check numbered with its `ok`, and for a list line its `part`); nothing is re-derived. What this throws away: the checks of a line off the list
// (the sheet and the older plans keep their own Audit rows), and the per-try history (the LAST try of a step is the one that closed it).
import { listLinesOf } from './checklistsign.js';
import { listPartRows } from './checked.js';
import { EVERY_STEP } from './try-checks.js';
import { sheetRowsOf } from './sheetrows.js';

/** the words of a row no result was recorded for: never "passed" */
export const AUDIT_NO_RESULT = 'no result recorded';

/**
 * @param {any} declaration the signed plan @param {any[]} diary the run's `checks` rows (src/diary.js readChecks) @param {{items?: string[], by?: Record<string, string>}|null} notChecked the sign row's Not-checked block
 * @param {{lines?: any[], csvRoles?: string[]}} [sheet] the signed job lines and CSV roles: a plan whose list has sheet rows (M16 am4) shows them here, tagged by where each comes from (hamr 2026-11-14)
 * @returns {{checks: AuditCheckRow[], notChecked: AuditCheckRow[], always: AuditCheckRow[]}|null} null for a plan with no list (it keeps its own Audit rows)
 * @typedef {{text: string, by: 'you'|'agent'|'default'|null, result: 'passed'|'failed'|'none'|'not-checked'}} AuditCheckRow
 */
export function auditChecksOf(declaration, diary, notChecked, { lines: jobLines = [], csvRoles = [] } = {}) {
  const lines = listLinesOf(declaration);
  const sheetOn = Array.isArray(declaration?.checkList) && declaration.checkList.some((/** @type {any} */ r) => r?.kind === 'sheet');
  const sheetRows = sheetOn ? sheetRowsOf({ declaration, lines: jobLines, csvRoles }) : null;
  if (lines.size === 0 && !(sheetRows && sheetRows.card.length > 0)) return null;
  const steps = (Array.isArray(declaration?.steps) ? declaration.steps : []).filter((/** @type {any} */ st) => lines.has(st?.fromLine));
  const lastTry = (/** @type {any} */ st) => (Array.isArray(diary) ? diary : []).filter((d) => d.step === (st.emits ?? st.goal ?? null)).at(-1);
  /** @type {AuditCheckRow[]} */
  const checks = [];
  for (const st of steps) {
    const rec = lastTry(st);
    for (const r of listPartRows(declaration, st)) {
      const got = rec?.checks?.find((/** @type {any} */ c) => c.part === r.part);
      checks.push({ text: `line ${st.fromLine} · ${r.text}`, by: r.by, result: got === undefined ? 'none' : got.ok ? 'passed' : 'failed' });
    }
  }
  // a sheet row: its check's words and the `by` of its row; what the run recorded is read by the row's `part`, as for any list row
  for (const [i, r] of (sheetRows?.card ?? []).entries()) {
    const st = (Array.isArray(declaration?.steps) ? declaration.steps : []).find((/** @type {any} */ x) => x?.fromLine === r.line && Array.isArray(x?.close?.sheet));
    const rec = st ? lastTry(st) : undefined;
    const got = rec?.checks?.find((/** @type {any} */ c) => c.part === sheetRows?.signed[i].part.part && c.by !== undefined);
    checks.push({ text: `line ${r.line} \u00b7 ${r.text}`, by: r.by, result: got === undefined ? 'none' : got.ok ? 'passed' : 'failed' });
  }
  const by = notChecked?.by ?? {};
  /** @type {AuditCheckRow[]} */
  const notRows = (notChecked?.items ?? []).map((t) => ({ text: t, by: by[t] === 'you' || by[t] === 'agent' || by[t] === 'default' ? /** @type {'you'|'agent'|'default'} */ (by[t]) : null, result: 'not-checked' }));
  // the two checks every step has (src/try-checks.js #1 and #2): passed when every step that ran them passed, failed when one did not
  const every = (/** @type {string} */ text) => {
    const seen = (Array.isArray(diary) ? diary : []).flatMap((d) => (d.checks ?? []).filter((/** @type {any} */ c) => c.source === EVERY_STEP && c.text === text));
    return seen.length === 0 ? 'none' : seen.every((/** @type {any} */ c) => c.ok) ? 'passed' : 'failed';
  };
  /** @type {AuditCheckRow[]} */
  const always = [
    { text: "the output exists and isn't empty", by: 'default', result: every("the output exists and isn't empty") },
    { text: 'the model said done: true', by: 'default', result: every('the model said done: true') },
  ];
  return { checks, notChecked: notRows, always };
}
