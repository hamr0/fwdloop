// borrowed-from: bareloop src/shaperesult.js@v0.61.0 (fc56e1f3)
// SHAPE JOBS (itemShape), the signed mock design/shape-views-mock.html (hamr 2026-11-18): the ONE view-model of a shape line's answer, read by the Result tab's grid (src/panel/server.js -> src/panel/index.html) and the
// .md report (src/resultmd.js), so the grid and the report say the same thing. Items are rows, the signed fields are columns; a cell is a mark and a short value; the errors are the plain item reds. Pure.
//   cell value: the item's own value (clipped, yes/no for a boolean, a list's entries joined), then the bound's words in brackets when the person bounded the field (`Ada (2 words)`, `a, b (2 entries)`). A red `#<i>:<path>:<reason>` (bareguard's, names and counts only) marks the cell of its field; a red with no field (`item-not-object`) marks the whole row.
//   The words of a red here name the worker's own value where the reason is a wrong value (`status is "done", not one of: ...`): the value comes from the delivered file, never from bareguard's gap.
import { upper, SHAPE_HEAD_PARTS, SHAPE_TRUTH_PARTS } from './shaperows.js';
import { parseShapeItem, itemFieldOf, plainShapeItem } from './shapewords.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clip = (/** @type {string} */ t, n = 40) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** one scalar as written, whitespace folded @param {unknown} v @returns {string} */
const scalar = (v) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : '');

/** the short value of one cell: the item's own value (clipped), then the bound's words in brackets where the field has one (`Ada (2 words)`, `a, b (2 entries)`) @param {Record<string, any>} spec @param {unknown} v @returns {string} */
function cellText(spec, v) {
  if (v === undefined || v === null) return '';
  const join = (/** @type {string} */ val, /** @type {string} */ extra) => (val && extra ? `${val} (${extra})` : val || extra);
  switch (spec.kind) {
    case 'text': {
      if (typeof v !== 'string') return '';
      const bounded = ['maxChars', 'minChars', 'maxWords', 'minWords'].some((k) => spec[k] !== undefined && !(k === 'minChars' && spec[k] === 1));
      const extra = !bounded ? '' : spec.maxWords !== undefined || spec.minWords !== undefined ? ((n) => `${n} word${n === 1 ? '' : 's'}`)(v.trim() === '' ? 0 : v.trim().split(/\s+/).length) : `${[...v].length} chars`;
      return join(clip(scalar(v)), extra);
    }
    case 'list': return Array.isArray(v) ? join(clip(v.map(scalar).filter((x) => x !== '').join(', ')), `${v.length} ${v.length === 1 ? 'entry' : 'entries'}`) : '';
    default: return typeof v === 'object' ? '' : clip(scalar(v), 40);
  }
}

/**
 * One item red in the Result tab's words: `item 3: status is "done", not one of: in progress, closed, finished`.
 * @param {string} red `#<i>:<path>:<reason>` @param {Record<string, any>|null} field the signed field `{name, spec, rule?}` or null @param {unknown} value the worker's value @param {string} said the person's rule for the field
 * @returns {string}
 */
export function shapeViewRed(red, field, value, said) {
  const p = parseShapeItem(red);
  if (p === null || p.path === null || field === null) return plainShapeItem(red);
  const at = `item ${p.i + 1}: ${field.name}`;
  const r = p.reason;
  const w = /^(too-short|too-long):(chars|words):(\d+)([<>])(\d+)$/.exec(r);
  if (w) {
    const unit = w[2] === 'chars' ? 'characters' : 'words';
    if (w[1] === 'too-short' && w[2] === 'chars' && w[5] === '1') return `${at} is empty`;
    return w[1] === 'too-long' ? `${at} is too long (${w[3]} ${unit}, ${upper(Number(w[5]), '', said)})` : `${at} is too short (${w[3]} ${unit}, at least ${w[5]})`;
  }
  if (r === 'not-one-of') return `${at} is ${typeof value === 'string' ? `"${clip(value)}"` : 'not a word'}, not one of: ${(Array.isArray(field.spec.values) ? field.spec.values : []).join(', ')}`;
  if (r === 'missing') return `${at} is missing`;
  if (r === 'wrong-value') return `${at} is ${typeof value === 'boolean' ? (value ? 'yes' : 'no') : 'not what the job asks for'}, not ${field.spec.equals === true ? 'yes' : 'no'}`;
  return plainShapeItem(red).replace(/^item (\d+): "([^"]*)"/, (_m, n, f) => `item ${n}: ${f}`);
}

/**
 * The model of a shape line's answer.
 * @param {{part: any, results: unknown, reds?: string[], rules?: string[]}} o `part` the signed shape part; `results` the answer's `results` list; `reds` the item reds the close recorded (`#<i>:<path>:<reason>`, none for a green run); `rules` the line's `~` rules
 * @returns {{columns: {name: string}[], rows: {name: string, cells: {mark: 'g'|'r', text: string, why?: string}[]}[], total: number, passed: number, failed: number, errors: string[], notChecked: string, head: string}}
 */
export function shapeResultModel({ part, results, reds = [], rules = [] }) {
  const fields = (Array.isArray(part?.fields) ? part.fields : []).filter(isRec);
  const items = Array.isArray(results) ? results : [];
  const said = (/** @type {any} */ f) => (Number.isInteger(f.rule) ? rules[f.rule - 1] ?? '' : '');
  const first = fields.find((f) => f.spec?.kind === 'text');
  const redsBy = (/** @type {number} */ i) => reds.filter((x) => parseShapeItem(x)?.i === i);
  /** @type {string[]} */
  const errors = [];
  const rows = items.map((it, i) => {
    const mine = redsBy(i);
    const whole = mine.some((x) => itemFieldOf(x) === null && !String(x).includes(':unknown-field:'));
    const val = (/** @type {string} */ n) => (isRec(it) ? it[n] : undefined);
    const title = first !== undefined && typeof val(first.name) === 'string' && String(val(first.name)).trim() !== '' ? ` · ${clip(String(val(first.name)).trim())}` : '';
    /** @type {Record<string, string>} */
    const why = {};
    for (const x of mine) { const nm = itemFieldOf(x); const f = fields.find((y) => y.name === nm) ?? null; const e = shapeViewRed(x, f, f ? val(f.name) : undefined, f ? said(f) : ''); errors.push(e); if (f) why[f.name] = e.replace(`item ${i + 1}: ${f.name} `, ''); }
    const cells = fields.map((f) => {
      const bad = whole || mine.some((x) => itemFieldOf(x) === f.name);
      return { mark: /** @type {'g'|'r'} */ (bad ? 'r' : 'g'), text: cellText(f.spec, val(f.name)), ...(why[f.name] !== undefined ? { why: why[f.name] } : {}) };
    });
    return { name: `${i + 1}${title}`, cells };
  });
  const failed = rows.filter((r) => r.cells.some((c) => c.mark === 'r')).length;
  return {
    columns: fields.map((f) => ({ name: String(f.name) })), rows, total: rows.length, passed: rows.length - failed, failed, errors,
    notChecked: SHAPE_TRUTH_PARTS.join(' — '), head: SHAPE_HEAD_PARTS.join(' · '),
  };
}

/** a markdown table cell: pipes and line breaks made safe @param {string} t */
const md = (t) => t.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/**
 * The shape section of the .md report (the signed mock D): the shape-checks line, a table (items as rows, fields as columns, a mark and the short value in each cell), the Not checked line and, when any item failed, a Failed list.
 * @param {ReturnType<typeof shapeResultModel>} m @returns {string}
 */
export function shapeMarkdown(m) {
  const cols = m.columns.map((c) => c.name);
  const lines = [
    `${SHAPE_HEAD_PARTS[0]} (${SHAPE_HEAD_PARTS[1]})`, '',
    `| item | ${cols.join(' | ')} |`, `| --- |${cols.map(() => ' --- |').join('')}`,
    ...m.rows.map((r) => `| ${md(r.name)} | ${r.cells.map((c) => md(`${c.mark === 'g' ? '✓' : '✗'}${c.text ? ` ${c.text}` : ''}`)).join(' | ')} |`),
    '', `Not checked: ${SHAPE_TRUTH_PARTS[0]} (${SHAPE_TRUTH_PARTS[1]})`,
    ...(m.errors.length ? ['', '### Failed', '', ...m.errors.map((e) => `- ${e}`)] : []),
  ];
  return lines.join('\n');
}
