// F219 POC (not src/): the M15 am3 report, adapted from bareloop v0.60.0 to fwd's run data. Pure: no I/O.
// borrowed-from: bareloop src/resultmd.js@v0.60.0 (leaves, words, friendlyName, blockLines, isResultList, claimLines, stepClaimWords, plainDate, reportBullet; adapted: fwd's step files, claims at the top of a sheet artifact, close from declaration.json)
import { sheetCheckSentence } from '../../src/sheetchecks.js';
import { lineRules } from '../../src/pagebits.js';
import { sheetTotalLines, ROW_MATH_OPS } from './sheettotal.mjs';

const SCALAR = ['string', 'number', 'boolean'];
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function leaves(parts, v) {
  if (v === null || v === undefined) return [{ parts, text: '' }];
  if (SCALAR.includes(typeof v)) return [{ parts, text: `${v}` }];
  if (Array.isArray(v) && v.every((x) => x === null || SCALAR.includes(typeof x))) return [{ parts, text: v.join(', ') }];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves([...parts, `${i + 1}`], x));
  return Object.entries(v).flatMap(([k, x]) => leaves([...parts, k], x));
}
const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_\-\s]+/).filter(Boolean);
function friendlyName(parts) {
  const p = parts.length > 1 && (parts[parts.length - 1] === 'value' || parts[parts.length - 1] === 'rows') ? parts.slice(0, -1) : parts;
  const w = p.flatMap(words).map((x) => x.toLowerCase());
  if (!w.length) return parts.join('.');
  return w[0][0].toUpperCase() + w[0].slice(1) + (w.length > 1 ? ` ${w.slice(1).join(' ')}` : '');
}
function blockLines(ls) {
  const f = ls.map((l) => friendlyName(l.parts));
  const n = {};
  for (const x of f) n[x] = (n[x] || 0) + 1;
  return ls.map((l, i) => `- ${n[f[i]] > 1 ? l.parts.join('.') : f[i]}: ${l.text}`);
}
const isResultList = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => isRec(r) && isRec(r.values));
const BOX_KEYS = ['value', 'rows', 'keys', 'values', 'totals'];
const ROW_MAPS = ['days', 'bands'];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function claimLines(claims, claimWords) {
  const out = [];
  for (const [id, box] of Object.entries(claims)) {
    if (!Object.hasOwn(claimWords, id) || claimWords[id] === null) continue;
    const label = cap(claimWords[id]);
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
function reportBullet(line) {
  const m = /^(Count|Total) of [^:]*: (.*)$/.exec(line);
  const rest = (m ? m[2] : line).endsWith(COMPUTED) ? (m ? m[2] : line).slice(0, -COMPUTED.length) : (m ? m[2] : line);
  return m ? `- ${m[1]}: ${rest}` : `- ${rest}`;
}

/** claim id -> the sentence of the first passed non-sum/count check carrying it; a claim only sumIf/countIf carry is null (code computes it) */
export function claimWordsOf(checks, okIds) {
  const out = {};
  const seen = new Set();
  for (const c of checks) {
    if (typeof c.claim !== 'string') continue;
    seen.add(c.claim);
    if (c.rule === 'cells' && ROW_MATH_OPS.includes(c.op)) continue;
    if (okIds && !okIds.has(c.id)) continue;
    if (typeof out[c.claim] !== 'string') out[c.claim] = sheetCheckSentence(c);
  }
  for (const id of seen) if (!Object.hasOwn(out, id)) out[id] = null;
  return out;
}

const sameWhere = (a, b) => a.table === b.table && JSON.stringify(a.where ?? null) === JSON.stringify(b.where ?? null);

/**
 * The claims `sheetTotalLines` reads. 'literal' = as bareloop copies it: the sumIf/countIf check's OWN claim box must hold `rows`. 'samewhere' = the POC's adapter for fwd's
 * separate boxes (`{value}` for a countIf/sumIf, `{rows}` for the rows check): the rows of the first `rows` check on the same table with the same `where`. NOT signed text.
 */
export function totalClaims(checks, claims, mode) {
  if (mode === 'literal') return claims;
  const out = { ...claims };
  for (const c of checks) {
    if (c.rule !== 'cells' || !ROW_MATH_OPS.includes(c.op)) continue;
    if (isRec(claims[c.claim]) && Array.isArray(claims[c.claim].rows)) continue;
    const r = checks.find((x) => x.rule === 'cells' && x.op === 'rows' && sameWhere(x, c) && isRec(claims[x.claim]) && Array.isArray(claims[x.claim].rows));
    if (r) out[c.claim] = { ...(isRec(claims[c.claim]) ? claims[c.claim] : {}), rows: claims[r.claim].rows };
  }
  return out;
}

export const plainDate = (d) => `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;

/** the title and the Passed line */
export const head = (job, runNo, now) => `# ${job}${runNo === null ? '' : ` — run-${runNo}`}\nPassed · ${plainDate(now)}`;

/**
 * One line's section: `checked` blocks (bullets / `#### Result k`) and the AI's `answer` text (or null).
 * @param {{artifact: any, checks: any[], okIds: Set<string>|null, tables: any, mode: string, dropValue?: boolean, swapOrder?: boolean}} o
 */
export function stepSection({ artifact, checks, okIds, tables, mode, dropValue = false, swapOrder = false }) {
  if (!isRec(artifact)) return { checked: [], answer: null };
  const hasText = typeof artifact.text === 'string';
  const hasResults = isResultList(artifact.results);
  const checked = [];
  if (hasResults) {
    artifact.results.forEach((r, i) => {
      let ls = blockLines(Object.entries(r.values).flatMap(([n, x]) => leaves([n], x)));
      if (dropValue && i === 0) ls = ls.slice(1);
      checked.push([`#### Result ${i + 1}`, ...ls, ...(typeof r.quote === 'string' ? ['', `from the page: "${r.quote}"`] : [])].join('\n'));
    });
  }
  // fwd's sheet artifact IS the claims (no text); a text artifact beside claims is not in this POC's data
  const claims = checks.length ? Object.fromEntries(Object.entries(artifact).filter(([k]) => k !== 'text' && k !== 'done' && k !== 'blocker')) : {};
  const report = checks.length ? sheetTotalLines(checks, totalClaims(checks, claims, mode), tables) : [];
  const ordered = swapOrder ? [...report].sort((a, b) => Number(b.startsWith('Total of')) - Number(a.startsWith('Total of'))) : [...report].sort((a, b) => Number(b.startsWith('Count of')) - Number(a.startsWith('Count of')));
  const bullets = [...(checks.length ? claimLines(claims, claimWordsOf(checks, okIds)) : []), ...ordered.map(reportBullet)];
  if (dropValue && !hasResults && bullets.length) bullets.shift();
  if (bullets.length) checked.push(bullets.join('\n'));
  return { checked, answer: hasText && artifact.text.trim() !== '' ? artifact.text : null };
}

/**
 * The body: every work line before the send in job order. `lines` = [{n, text, rules, kind: 'ask'|'work', artifact, checks, okIds, proseChecked}].
 * A work line always gets its `## n. text` heading (the signed text: one per work line). Pure.
 */
export function renderBody({ lines, tables, mode, dropValue = false, swapOrder = false }) {
  const sections = [];
  for (const l of lines) {
    if (l.kind === 'ask') { sections.push(`Line ${l.n}: you accepted this at the Ask.`); continue; }
    const sec = stepSection({ artifact: l.artifact, checks: l.checks, okIds: l.okIds, tables, mode, dropValue, swapOrder });
    const head1 = [`## ${l.n}. ${l.text}`, ...lineRules({ rules: l.rules }).map((r) => `Rule: ${r}`)].join('\n');
    const parts = [head1];
    if (sec.checked.length) parts.push(['### Checked by code', sec.checked.join('\n\n')].join('\n'));
    if (sec.answer !== null) parts.push([l.proseChecked ? '### The answer' : '### The AI\'s answer (not checked — you judge it at Accept)', sec.answer].join('\n'));
    sections.push(parts.join('\n\n'));
  }
  return sections.join('\n\n');
}

export const fileText = (job, runNo, now, body) => `${head(job, runNo, now)}\n\n${body}\n`;
