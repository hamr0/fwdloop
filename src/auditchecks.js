// M16 item 5 (docs/wiki/the-module-ladder.md, "M16"): the Audit's "Checks" fold, the card's own sections (Checks, Not checked, Always checked), each row with its tag and, after the run, its recorded result.
// borrowed-from: bareloop src/panel/jobplan.js@v0.56.0 (3383cce) (auditChecksOf: the sections, the row shape {text, by, result}, a row no verdict was recorded for is "none", never "passed")
// borrowed-from: bareloop src/panel/jobplan.js@v0.61.0 (fc56e1f3) auditChecksOf: `lines` (one block per job line: its checks and its Not checked rows) and `jobNotChecked` (the Not checked rows no line owns), ported onto fwdloop's diary reader
// What a run recorded for a check is read off its diary (`checks` rows: each check numbered with its `ok`, and for a list line its `part`); nothing is re-derived. What this throws away: the checks of a line off the list
// (the sheet and the older plans keep their own Audit rows), and the per-try history (the LAST try of a step is the one that closed it).
import { listLinesOf } from './checklistsign.js';
import { listPartRows, notCheckedView } from './checked.js';
import { EVERY_STEP, EVERY_STEP_TEXTS } from './try-checks.js';
import { sheetRowsOf } from './sheetrows.js';
import { splitNotChecked, ncRowsOf } from './checklook.js';

/** the words of a row no result was recorded for: never "passed" */
export const AUDIT_NO_RESULT = 'no result recorded';

/**
 * @param {any} declaration the signed plan @param {any[]} diary the run's `checks` rows (src/diary.js readChecks) @param {{items?: string[], by?: Record<string, string>}|null} notChecked the sign row's Not-checked block
 * @param {{lines?: any[], csvRoles?: string[]}} [sheet] the signed job lines and CSV roles: a plan whose list has sheet rows (M16 am4) shows them here, tagged by where each comes from (hamr 2026-11-14)
 * @returns {{checks: AuditCheckRow[], notChecked: AuditCheckRow[], readNotes: string[], always: AuditCheckRow[], lines: AuditLine[], jobNotChecked: AuditCheckRow[]}|null} null for a plan with no list (it keeps its own Audit rows)
 * @typedef {{n: number, text: string, checks: AuditCheckRow[], notChecked: AuditCheckRow[]}} AuditLine
 * @typedef {{text: string, by: 'you'|'agent'|'default'|null, result: 'passed'|'failed'|'none'|'not-checked', kind?: 'truth'|'shape'|'file', why?: string}} AuditCheckRow
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
  // the same rows by the job line that owns them, their words without the `line N · ` prefix (S7: one block per line)
  /** @type {{line: number, row: AuditCheckRow}[]} */
  const owned = [];
  // a failed row's reason is the words its check recorded (the diary's `result`); a row that passed or has no record carries none
  const whyOf = (/** @type {any} */ got) => (got !== undefined && !got.ok && typeof got.result === 'string' && got.result !== '' ? { why: got.result } : {});
  for (const st of steps) {
    const rec = lastTry(st);
    for (const r of listPartRows(declaration, st, { lines: Array.isArray(jobLines) ? jobLines : [] })) {
      const got = rec?.checks?.find((/** @type {any} */ c) => c.part === r.part);
      const row = /** @type {AuditCheckRow} */ ({ text: r.text, kind: 'truth', by: r.by, result: got === undefined ? 'none' : got.ok ? 'passed' : 'failed', ...whyOf(got) });
      checks.push({ ...row, text: `line ${st.fromLine} · ${r.text}` });
      owned.push({ line: st.fromLine, row });
    }
  }
  // a sheet row: its check's words and the `by` of its row; what the run recorded is read by the row's `part`, as for any list row
  for (const [i, r] of (sheetRows?.card ?? []).entries()) {
    const st = (Array.isArray(declaration?.steps) ? declaration.steps : []).find((/** @type {any} */ x) => x?.fromLine === r.line && Array.isArray(x?.close?.sheet));
    const rec = st ? lastTry(st) : undefined;
    const got = rec?.checks?.find((/** @type {any} */ c) => c.part === sheetRows?.signed[i].part.part && c.by !== undefined);
    const row = /** @type {AuditCheckRow} */ ({ text: r.text, kind: 'truth', by: r.by, result: got === undefined ? 'none' : got.ok ? 'passed' : 'failed', ...whyOf(got) });
    checks.push({ ...row, text: `line ${r.line} \u00b7 ${r.text}` });
    owned.push({ line: r.line, row });
  }
  const by = notChecked?.by ?? {};
  // M17 am4 (C3): the Audit splits a reading note from Not checked as the card and the Job tab do (src/checked.js notCheckedView)
  const view = notCheckedView(notChecked?.items ?? [], declaration);
  /** @type {AuditCheckRow[]} */
  const notRows = view.items.map((t) => ({ ...splitNotChecked(t), by: by[t] === 'you' || by[t] === 'agent' || by[t] === 'default' ? /** @type {'you'|'agent'|'default'} */ (by[t]) : null, result: 'not-checked' }));
  // the two checks every step has (src/try-checks.js #1 and #2): passed when every step that ran them passed, failed when one did not
  const every = (/** @type {string} */ text) => {
    const seen = (Array.isArray(diary) ? diary : []).flatMap((d) => (d.checks ?? []).filter((/** @type {any} */ c) => c.source === EVERY_STEP && c.text === text));
    return seen.length === 0 ? 'none' : seen.every((/** @type {any} */ c) => c.ok) ? 'passed' : 'failed';
  };
  const everyWhy = (/** @type {string} */ text) => whyOf((Array.isArray(diary) ? diary : []).flatMap((d) => (d.checks ?? []).filter((/** @type {any} */ c) => c.source === EVERY_STEP && c.text === text)).find((/** @type {any} */ c) => !c.ok));
  /** @type {AuditCheckRow[]} */
  const always = EVERY_STEP_TEXTS.map((text) => ({ text, kind: 'file', by: /** @type {'default'} */ ('default'), result: every(text), ...everyWhy(text) }));
  // M19 S7: one block per job line (its checks, its Not checked rows) and the Not checked rows no line owns; the two every-step rows are the page's "Every line" block (a one-line job's Line 1 block)
  // a row owned by a line the job text does not carry would be lost from the blocks: then no blocks (`lines` empty) and the page draws the flat groups
  const known = new Set(jobLines.map((/** @type {any} */ l) => l.n));
  const ncAll = ncRowsOf(view.items, by);
  const ncOf = (/** @type {any} */ n) => ({ text: n.text, by: n.by ?? null, result: /** @type {'not-checked'} */ ('not-checked'), ...(n.why ? { why: n.why } : {}) });
  /** @type {AuditLine[]} */
  const lineBlocks = owned.some((o) => !known.has(o.line)) ? [] : jobLines.map((/** @type {any} */ l) => ({
    n: l.n, text: l.text,
    checks: owned.filter((o) => o.line === l.n).map((o) => o.row),
    notChecked: ncAll.filter((n) => n.line === l.n).map(ncOf),
  }));
  const jobNotChecked = ncAll.filter((n) => !known.has(n.line)).map(ncOf);
  return { checks, notChecked: notRows, readNotes: view.readNotes, always, lines: lineBlocks, jobNotChecked };
}
