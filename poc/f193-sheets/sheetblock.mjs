// F193 POC ($0): sheet checks as rows of bareloop v0.57.0's CheckBlock (the F191 vendor copy). Not shipped.
// A SheetBlock holds the person's `~` rules of a sheet line as the block's own rule rows, and the AI-written sheet checks (a step's typed `covers` list) as follows, one writer for each:
//   addSheetChecks   a check is KEPT when it covers at least one rule and none of those rules is already held by a kept check: it sits on those rule rows. Any other check is a SUGGESTED row.
//   answerColumn     a column answer sets the rule row's `column`; the row's words and the job's `~` lines stay as they are.
// A `use the column 'X' for 'Y'` rule is built by the column, never Not checked, never covered. A rule with no kept check is the block's own Not-checked rule row (REASON.noRule). There is one list.
// What this throws away: a check's fields (id, claim, range ...); a row keeps its line, rule, words, id and card words. Third outcomes named: a check that covers a rule number the line does not have is
// read as covering none of it; a rule row whose line was given no check at all is simply Not checked.
import { CheckBlock, REASON } from '../f191-replace/vendor/checkblock.js';
import { sheetCheckName, sheetPlainText } from '../../src/sheetblock.js';
import { sheetCheckSentence } from '../../src/sheetchecks.js';
import { isColumnChoiceRule } from '../../src/sheetoffer.js';

export class SheetBlock extends CheckBlock {
  /** @param {{texts?: Record<string, string>, labels?: string[]}} [o] */
  constructor(o = {}) { super({ texts: o.texts ?? {}, labels: o.labels ?? [], asks: false, split: true, cited: false }); }

  /** every `~` rule of a sheet line is the sheet path's: kept by a check, built by the column, or Not checked with the block's reason */
  matchRule(/** @type {any} */ r) {
    if (isColumnChoiceRule(r.text)) { r.can = { ok: true, how: 'column' }; return; }
    if (r.sheet) { r.can = { ok: true, how: 'sheet' }; return; }
    r.can = { ok: false, why: r.lookWhy ?? REASON.noRule };
  }

  /** no parts (the checks are the close's `sheet` list, outside the block's parts): each row is built, suggested or Not checked */
  buildLine(/** @type {{n: number}} */ l) {
    for (const r of this.rowsOn(l.n)) {
      if (r.kind === 'floor') continue;
      r.part = null;
      if (r.kind === 'sheet') { r.state = 'suggested'; r.reason = REASON.suggested; continue; }
      if (!r.can?.ok) { r.state = 'not-checked'; r.reason = r.can?.why ?? 'not checked'; continue; }
      r.state = 'built'; r.reason = null;
    }
  }

  /**
   * @param {number} line @param {any[]} checks a step's `close.sheet`, in order, each with its typed `covers`
   * @returns {{kept: string[], suggested: {id: string, why: string}[]}}
   */
  addSheetChecks(line, checks) {
    const rules = this.ruleRows(line);
    const held = new Set();
    const kept = [];
    const suggested = [];
    checks.forEach((c, i) => {
      const id = typeof c?.id === 'string' && c.id !== '' ? c.id : `check${i + 1}`;
      const nums = [...new Set(Array.isArray(c?.covers) ? c.covers : [])].filter((n) => Number.isInteger(n) && rules.some((r) => r.rule === n && !isColumnChoiceRule(r.text))).sort((a, b) => a - b);
      const words = sheetPlainText(sheetCheckName(c), sheetCheckSentence(c), '');
      if (nums.length > 0 && nums.every((n) => !held.has(n))) {
        for (const n of nums) { held.add(n); const row = rules.find((r) => r.rule === n); if (row) row.sheet = { id, words, covers: nums }; }
        kept.push(id);
      } else {
        const why = nums.length === 0 ? 'it covers none of your rules' : 'a rule it covers already has a check';
        this.addRow({ key: `L${line}.sheet.${id}`, line, kind: 'sheet', by: 'agent', from: 'agent', state: 'suggested', reason: REASON.suggested, name: words, offer: { text: words }, sheetId: id, why, check: c });
        suggested.push({ id, why });
      }
    });
    return { kept, suggested };
  }

  /** the column answer of a sheet ask tied to a rule: the rule row takes the column; nothing is added to the job @returns {{ok: true}|{ok: false, why: string}} */
  answerColumn(/** @type {number} */ line, /** @type {number} */ rule, /** @type {string} */ column, /** @type {string} */ word) {
    const row = this.ruleRows(line).find((r) => r.rule === rule);
    if (!row) return { ok: false, why: 'out of date' };
    row.column = { column, word };
    return { ok: true };
  }

  /** the one Not-checked list: each rule row that is Not checked, once, with its reason @returns {{line: number, rule: number, text: string, reason: string}[]} */
  notCheckedList() {
    return this.rows.filter((r) => r.kind === 'rule' && r.state === 'not-checked').map((r) => ({ line: r.line, rule: r.rule, text: String(r.text), reason: String(r.reason) }));
  }

  /** the card's rows as one list: rule rows with the check words they hold; Suggested apart @returns {{rows: string[], suggested: string[]}} */
  cardLines() {
    const rows = this.rows.filter((r) => r.kind === 'rule' && r.state === 'built').map((r) => `L${r.line}.~${r.rule} "${r.text}"${r.sheet ? ` -> ${r.sheet.words}` : ''}${r.column ? ` [column ${r.column.column}]` : ''}`);
    return { rows, suggested: this.suggestedView().map((s) => `L${s.line} ${s.text}`) };
  }
}
