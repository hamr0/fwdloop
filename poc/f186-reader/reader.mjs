// F186: a #82 groundedLiterals reader written from bareguard cells-prd.md 11.6 text alone ($0 POC, not borrowed code).
const CUR = '$€£';
const isDigit = (c) => c !== undefined && c >= '0' && c <= '9';
const isLetter = (c) => c !== undefined && /\p{L}/u.test(c);
const isSpace = (c) => c !== undefined && /\s/u.test(c);
const REAL = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const THOU = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

/** canonical exact-decimal string of a plain decimal string, or null */
export function canon(s) {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const ip = m[2].replace(/^0+(?=\d)/, '');
  const fp = (m[3] ?? '').replace(/0+$/, '');
  const body = fp ? `${ip}.${fp}` : ip;
  return body === '0' ? '0' : `${m[1]}${body}`;
}

/** one scan; returns { bare:Set<string>, amount:Set<string>, date:Set<string> } of canonical decimals / ISO dates */
export function readSaid(raw) {
  const t = String(raw).normalize('NFC');
  const out = { bare: new Set(), amount: new Set(), date: new Set() };
  let i = 0;
  const n = t.length;
  while (i < n) {
    const c = t[i];
    let start = i;
    let sym = false;
    if (CUR.includes(c) && isDigit(t[i + 1])) { sym = true; i += 1; }
    else if (!isDigit(c)) { i += 1; continue; }
    // i is at a digit
    const prev = start > 0 ? t[start - 1] : undefined;
    let bad = false;
    let neg = false;
    const before = sym ? prev : prev;
    if (isLetter(before) || before === '.' || before === ',' || before === '(' || before === '−') bad = true;
    else if (before === '-') {
      const pp = start > 1 ? t[start - 2] : undefined;
      if (start - 1 === 0 || isSpace(pp) || pp === '(') neg = true;
    }
    if (sym && (before !== undefined && isDigit(before))) bad = true;
    const rest = t.slice(i);
    // time
    let m = /^\d{1,2}:\d{2}(?:( ?)(AM|PM))?/.exec(rest);
    if (m) {
      let len = m[0].length;
      const after = t[i + len];
      // lowercase am/pm or glued letters: malformed, consumed whole
      const lm = /^(?: ?[A-Za-z][A-Za-z.]*)/.exec(t.slice(i + len));
      if (!m[2] && lm && /^ ?[AaPp]\.?[Mm]/.test(lm[0])) len += lm[0].length;
      i += len; continue;
    }
    // ISO date or date-shaped run
    m = /^\d+(?:[-/.]\d+){2,}/.exec(rest);
    if (m) {
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(m[0]);
      if (iso && !bad && !neg && !sym && REAL(+iso[1], +iso[2], +iso[3]) && !isLetter(t[i + m[0].length]) && !isDigit(t[i + m[0].length])) out.date.add(m[0]);
      i += m[0].length; continue;
    }
    m = /^\d+(?:,\d+)*(?:\.\d+)?/.exec(rest);
    let len = m[0].length;
    let tok = m[0];
    let after = t[i + len];
    let amount = sym;
    if (!bad && !THOU.test(tok)) bad = true;
    if (after !== undefined && isLetter(after)) bad = true;
    if (!sym && after !== undefined && CUR.includes(after) && !isDigit(t[i + len + 1]) && !bad) { amount = true; len += 1; after = t[i + len]; }
    if (sym && after !== undefined && CUR.includes(after)) bad = true;
    if (bad) { i += len; continue; }
    const v = canon((neg ? '-' : '') + tok.replace(/,/g, ''));
    if (v !== null) (amount ? out.amount : out.bare).add(v);
    i += len;
  }
  return out;
}

const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const NUMBER_CMPS = ['gt', 'gte', 'lt', 'lte', 'eq'];
const DATE_CMPS = ['before', 'after', 'dateOn'];
const ISOFULL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @returns {{ok:boolean, missing:{path:string,kind:string,value:any}[]}} */
export function groundedLiterals(check, text, { constToo = false } = {}) {
  if (typeof text !== 'string') return { ok: false, missing: [], why: 'not-a-string' };
  const said = readSaid(text);
  const missing = [];
  const num = (path, v) => {
    const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
    const c = s === null ? null : canon(s);
    if (c === null || !(said.bare.has(c) || said.amount.has(c))) missing.push({ path, kind: 'number', value: v });
  };
  const date = (path, v) => {
    const m = typeof v === 'string' ? ISOFULL.exec(v) : null;
    if (!m || !REAL(+m[1], +m[2], +m[3]) || !said.date.has(v)) missing.push({ path, kind: 'date', value: v });
  };
  if (!isRec(check)) return { ok: false, missing: [{ path: '', kind: 'number', value: check }] };
  if (check.asOf !== undefined) date('asOf', check.asOf);
  (Array.isArray(check.where) ? check.where : []).forEach((w, i) => {
    if (!isRec(w)) return;
    if (NUMBER_CMPS.includes(w.cmp)) num(`where[${i}].value`, w.value);
    else if (w.cmp === 'between') { num(`where[${i}].lo`, w.lo); num(`where[${i}].hi`, w.hi); }
    else if (DATE_CMPS.includes(w.cmp)) date(`where[${i}].value`, w.value);
    else if (w.cmp === 'dateBetween') { date(`where[${i}].lo`, w.lo); date(`where[${i}].hi`, w.hi); }
  });
  if (constToo && isRec(check.b) && check.b.const !== undefined) num('b.const', check.b.const);
  return { ok: missing.length === 0, missing };
}
