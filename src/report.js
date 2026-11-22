// M15 am3 (docs/wiki/the-module-ladder.md, "M15 am3 - one markdown report per run"): the ONE writer of the report's words. The body (every line's section, in job order) is built by code at the last
// Ask (`wholeJobText`, src/whole-job.js) and is what the person accepts; the send step adds the title and the `Passed` line after the accept (`reportFileText`) and picks the file's name (`nextFreeName`).
// borrowed-from: bareloop src/resultmd.js@v0.60.0 (leaves, words, friendlyName, blockLines, isResultList, claimLines, reportBullet, plainDate, stepSection, the section writer of renderRunMd) and src/source.js@v0.60.0 (pickDelivery, the name clean-up).
// Adapted to fwd's run data: one JSON artifact per step, a sheet step's claim boxes at the top of its artifact, the close from the signed declaration.
// What this throws away: a result's keys other than `quote` and `values`; a claim box no check of the line carries; an artifact key that is neither text, results nor a claim; the AI's own count and total (code's are written).
// Third outcomes: a line whose artifact holds neither text, results nor a written claim has no section (as bareloop: nothing to write is not a heading alone); an artifact that is not an object has no section.
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { sheetCheckSentence } from './sheetchecks.js';
import { sheetTotalLines, ROW_MATH_OPS, isRec } from './sheetclaims.js';
import { lineRules } from './pagebits.js';
import { shapeResultModel, shapeMarkdown } from './shaperesult.js';

const SCALAR = ['string', 'number', 'boolean'];

/** the words under a not-checked answer and a checked one (M15 am3 item 2) */
export const NOT_CHECKED_HEADING = '### The AI\'s answer (not checked — you judge it at Accept)';
export const CHECKED_HEADING = '### The answer';
/** an Ask line, in M13 am9's words */
export const askLineWords = (/** @type {number} */ n) => `Line ${n}: you accepted this at the Ask.`;
/** the Result tab's note for a report saved under a new name (code-owned; the page types no words) @param {string} taken */
export const REPORT_RENAMED = (taken) => `saved under a new name because ${taken} was already taken`;

/** one value as leaf lines `{parts, text}`: parts are the names on the way in; a string as it is, a number or boolean written out; a list of plain values joined by ", "; null as empty */
/** @param {string[]} parts @param {any} v @returns {{parts: string[], text: string}[]} */
function leaves(parts, v) {
  if (v === null || v === undefined) return [{ parts, text: '' }];
  if (SCALAR.includes(typeof v)) return [{ parts, text: `${v}` }];
  if (Array.isArray(v) && v.every((x) => x === null || SCALAR.includes(typeof x))) return [{ parts, text: v.join(', ') }];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves([...parts, `${i + 1}`], x));
  return Object.entries(v).flatMap(([k, x]) => leaves([...parts, k], x));
}

/** @param {string} name split only at a lowercase-to-capital boundary, `_`, `-` and spaces, so `ID` stays one word */
const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_\-\s]+/).filter(Boolean);

/** the names as plain words (M15 am2 (1)); a last name of `value` or `rows` is left out; the first letter capital, the later words lowercase @param {string[]} parts */
function friendlyName(parts) {
  const p = parts.length > 1 && (parts[parts.length - 1] === 'value' || parts[parts.length - 1] === 'rows') ? parts.slice(0, -1) : parts;
  const w = p.flatMap(words).map((x) => x.toLowerCase());
  if (!w.length) return parts.join('.');
  return w[0][0].toUpperCase() + w[0].slice(1) + (w.length > 1 ? ` ${w.slice(1).join(' ')}` : '');
}

/** the lines of one block, each a bullet; two lines with the same words both keep the `a.b` form @param {{parts: string[], text: string}[]} ls */
function blockLines(ls) {
  const f = ls.map((l) => friendlyName(l.parts));
  /** @type {Record<string, number>} */
  const n = {};
  for (const x of f) n[x] = (n[x] || 0) + 1;
  return ls.map((l, i) => `- ${n[f[i]] > 1 ? l.parts.join('.') : f[i]}: ${l.text}`);
}

/** a list of results: every item an object holding a `values` object @param {any} v */
const isResultList = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => isRec(r) && isRec(r.values));

/** the box keys that only say what the box holds: left out of a line's name */
const BOX_KEYS = ['value', 'rows', 'keys', 'values', 'totals'];
/** a box that maps a row number to its value */
const ROW_MAPS = ['days', 'bands'];
const cap = (/** @type {string} */ s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The claim bullets of a sheet step. A claim id is named with the plain sentence of the first passed check that carries it and is not a sumIf / countIf; a claim only sumIf / countIf carry is null (code computes it, the AI's
 * number is never written); a box no check carries is left out. A map of rows (`days`, `bands`) writes one bullet per row.
 * @param {Record<string, any>} claims @param {Record<string, string|null>} claimWords @returns {string[]}
 */
function claimLines(claims, claimWords) {
  /** @type {string[]} */
  const out = [];
  for (const [id, box] of Object.entries(claims)) {
    if (!Object.hasOwn(claimWords, id) || claimWords[id] === null) continue;
    const label = cap(/** @type {string} */ (claimWords[id]));
    for (const l of leaves([], box)) {
      let p = l.parts;
      if (p.length === 2 && ROW_MAPS.includes(p[0])) { out.push(`- ${label}, row ${p[1]}: ${l.text}`); continue; }
      if (p.length > 0 && BOX_KEYS.includes(p[p.length - 1])) p = p.slice(0, -1);
      out.push(`- ${p.length ? `${label}, ${p.flatMap(words).map((x) => x.toLowerCase()).join(' ')}` : label}: ${l.text}`);
    }
  }
  return out;
}

const COMPUTED = ' (computed by code from the rows named)';

/** code's own line (`Count of rows 3, 5: 2 (computed by code from the rows named)`) as a bullet `- Count: 2` / `- Total: 1,234.50` @param {string} line */
function reportBullet(line) {
  const m = /^(Count|Total) of [^:]*: (.*)$/.exec(line);
  const rest = (m ? m[2] : line).endsWith(COMPUTED) ? (m ? m[2] : line).slice(0, -COMPUTED.length) : (m ? m[2] : line);
  return m ? `- ${m[1]}: ${rest}` : `- ${rest}`;
}

/**
 * claim id -> the sentence of the first passed non-sumIf/countIf check carrying it; a claim only sumIf/countIf carry is null. `okIds` = the ids of the checks that passed, or null = no record (all count).
 * @param {any[]} checks @param {Set<string>|null} okIds @returns {Record<string, string|null>}
 */
export function claimWordsOf(checks, okIds) {
  /** @type {Record<string, string|null>} */
  const out = {};
  /** @type {Set<string>} */
  const seen = new Set();
  for (const c of checks) {
    if (!isRec(c) || typeof c.claim !== 'string') continue;
    seen.add(c.claim);
    if (c.rule === 'cells' && ROW_MATH_OPS.includes(c.op)) continue;
    if (okIds && !okIds.has(c.id)) continue;
    if (typeof out[c.claim] !== 'string') out[c.claim] = sheetCheckSentence(c);
  }
  for (const id of seen) if (!Object.hasOwn(out, id)) out[id] = null;
  return out;
}

/** the date as plain words, `18 Nov 2026`, in the machine's local day (the day the dated file names use) @param {Date} d */
export function plainDate(d) {
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;
}

/** the run number when the run id reads `run-N`, else null (a rerun id `run-1-rerun-1` has none) @param {string} runId @returns {number|null} */
export function runNumberOf(runId) {
  const m = /^run-(\d+)$/.exec(String(runId));
  return m ? Number(m[1]) : null;
}

/** the title and the `Passed` line, written by the send step (M15 am3 item 2) @param {string} job @param {number|null} runNo @param {Date} now */
export const reportHead = (job, runNo, now) => `# ${job}${runNo === null ? '' : ` — run-${runNo}`}\nPassed · ${plainDate(now)}`;

/** the whole file: the title and the Passed line, then the accepted body @param {string} job @param {number|null} runNo @param {Date} now @param {string} body */
export const reportFileText = (job, runNo, now, body) => `${reportHead(job, runNo, now)}\n\n${body}\n`;

/**
 * One line's section parts: `checked` blocks (`#### Result k` blocks and the bullets) and `answer`, the AI's own text, or null.
 * @param {{artifact: unknown, checks: any[], okIds: Set<string>|null, tables: Record<string, any>}} o
 * @returns {{checked: string[], answer: string|null}|null}
 */
function stepSection({ artifact, checks, okIds, tables }) {
  if (!isRec(artifact)) return null;
  const a = /** @type {Record<string, any>} */ (artifact);
  const hasText = typeof a.text === 'string';
  /** @type {string[]} */
  const checked = [];
  if (isResultList(a.results)) {
    a.results.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
      const lines = blockLines(Object.entries(r.values).flatMap(([n, x]) => leaves([n], x)));
      checked.push([`#### Result ${i + 1}`, ...lines, ...(typeof r.quote === 'string' ? ['', `from the page: "${r.quote}"`] : [])].join('\n'));
    });
  }
  const sheet = checks.filter((c) => isRec(c) && c.rule === 'cells');
  // a sheet step's boxes are its artifact's keys named by a check's claim; nothing else of the artifact is a claim
  const claimIds = new Set(sheet.map((c) => c.claim).filter((x) => typeof x === 'string'));
  const claims = Object.fromEntries(Object.entries(a).filter(([k]) => claimIds.has(k)));
  // Count then Total, whatever the order of the signed checks
  const counted = sheetTotalLines(sheet, claims, tables).sort((x, y) => Number(y.startsWith('Count of')) - Number(x.startsWith('Count of')));
  const bullets = [...claimLines(claims, claimWordsOf(sheet, okIds)), ...counted.map(reportBullet)];
  if (bullets.length) checked.push(bullets.join('\n'));
  const answer = hasText && /** @type {string} */ (a.text).trim() !== '' ? /** @type {string} */ (a.text) : null;
  return checked.length === 0 && answer === null ? null : { checked, answer };
}

/**
 * The body: every line before the send, in job order. A work line is `## <n>. <text>`, a `Rule:` per ~ rule, `### Checked by code` (bullets) and the AI's text under its heading; an Ask line is one line
 * in its place; a work line with nothing to write has no section. Pure.
 * @param {{n: number, kind: 'ask'|'work', text?: string, rules?: string[], artifact?: unknown, checks?: any[], okIds?: Set<string>|null, proseChecked?: boolean, shape?: any}[]} lines
 * @param {Record<string, any>} tables the frozen sheets by input name
 * @returns {string}
 */
export function renderReportBody(lines, tables) {
  /** @type {string[]} */
  const sections = [];
  for (const l of lines) {
    if (l.kind === 'ask') { sections.push(askLineWords(l.n)); continue; }
    // borrowed-from: bareloop src/resultmd.js@v0.61.0 (the shape branch of renderRunMd)
    // a shape line (picked by the line's signed `itemShape`, never by the key `results`, which a facts line also uses): the shape section (M19 amendment C, C1): its heading, the Rule lines, the shape-checks line, the table, the Not checked line.
    // A report is written for a green run only, so no item is red here. The one place a check mark may appear in a report is this table.
    if (isRec(l.shape)) {
      const results = isRec(l.artifact) ? /** @type {Record<string, any>} */ (l.artifact).results : null;
      if (!Array.isArray(results) || results.length === 0) continue;
      const rules = lineRules({ rules: l.rules });
      const head = [`## ${l.n}. ${l.text}`, ...rules.map((r) => `Rule: ${r}`)].join('\n');
      sections.push([head, shapeMarkdown(shapeResultModel({ part: l.shape, results, rules }))].join('\n\n'));
      continue;
    }
    const sec = stepSection({ artifact: l.artifact, checks: l.checks ?? [], okIds: l.okIds ?? null, tables });
    if (sec === null) continue;
    const parts = [[`## ${l.n}. ${l.text}`, ...lineRules({ rules: l.rules }).map((r) => `Rule: ${r}`)].join('\n')];
    if (sec.checked.length) parts.push(['### Checked by code', sec.checked.join('\n\n')].join('\n'));
    if (sec.answer !== null) parts.push([l.proseChecked ? CHECKED_HEADING : NOT_CHECKED_HEADING, sec.answer].join('\n'));
    sections.push(parts.join('\n\n'));
  }
  return sections.join('\n\n');
}

/** is anything at this path (lstat: a dangling symlink counts as present) @param {string} p */
function present(p) {
  try { lstatSync(p); return true; } catch (err) { return /** @type {any} */ (err).code !== 'ENOENT'; }
}

/** the most same-day names tried before the send stops (bareloop's MAX_SAME_DAY) */
export const MAX_SAME_DAY = 99;

/**
 * The file name for a report: `<job>-YYYY-MM-DD.md`, then `<job>-YYYY-MM-DD-2.md`, `-3`, ... the first one that is free in `dir` (the machine's local day). Never a taken name. `taken` = the first choice
 * when it was not free (the Result tab's note names it), else null. `name` = null when every name up to -99 is taken.
 * @param {string} dir the Destination folder @param {string} job @param {Date} now
 * @returns {{name: string|null, taken: string|null}}
 */
export function nextFreeName(dir, job, now) {
  const clean = String(job).replace(/[/\\\0]/g, '-').replace(/^\.+/, '') || 'report';
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const base = `${clean}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const first = `${base}.md`;
  for (let n = 1; n <= MAX_SAME_DAY; n += 1) {
    const name = n === 1 ? first : `${base}-${n}.md`;
    if (!present(join(dir, name))) return { name, taken: n === 1 ? null : first };
  }
  return { name: null, taken: first };
}
