// Test helper: the source text of one function in the panel page (src/panel/index.html), so a test can run the page's REAL function in new Function().
// The function ends at the brace that closes its body. Braces inside a string, a template literal (with its ${ } nesting), a regex literal or a comment do not count.

/** Index just past the end of the string/template/comment/regex starting at i, or -1 when none starts there. @param {string} s @param {number} i @param {string} prev last significant char before i */
function skipLiteral(s, i, prev) {
  const c = s[i];
  if (c === '"' || c === "'") {
    for (let j = i + 1; j < s.length; j += 1) { if (s[j] === '\\') j += 1; else if (s[j] === c) return j + 1; }
    return s.length;
  }
  if (c === '`') {
    for (let j = i + 1; j < s.length; j += 1) {
      if (s[j] === '\\') j += 1;
      else if (s[j] === '`') return j + 1;
      else if (s[j] === '$' && s[j + 1] === '{') j = matchBrace(s, j + 1) - 1;
    }
    return s.length;
  }
  if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); return e === -1 ? s.length : e; }
  if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); return e === -1 ? s.length : e + 2; }
  if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) { // a regex literal, not a division
    let inClass = false;
    for (let j = i + 1; j < s.length; j += 1) {
      if (s[j] === '\\') j += 1;
      else if (s[j] === '[') inClass = true;
      else if (s[j] === ']') inClass = false;
      else if (s[j] === '/' && !inClass) return j + 1;
      else if (s[j] === '\n') return -1;
    }
  }
  return -1;
}

/** Index just past the `}` that closes the `{` at `open`. @param {string} s @param {number} open */
function matchBrace(s, open) {
  let depth = 0;
  let prev = '';
  for (let i = open; i < s.length; i += 1) {
    const skip = skipLiteral(s, i, prev);
    if (skip !== -1) { i = skip - 1; prev = 'x'; continue; }
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') { depth -= 1; if (depth === 0) return i + 1; }
    if (!/\s/.test(s[i])) prev = s[i];
  }
  throw new Error('no closing brace');
}

/** @param {string} src the page (or one block of it) @param {string} name @param {string} [indent] the function's own indent, to tell it from a nested one of the same name */
export function fnSrc(src, name, indent = '') {
  const start = src.indexOf(`${indent}function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const open = src.indexOf('{', src.indexOf(')', start));
  try { return src.slice(start, matchBrace(src, open)); } catch { throw new Error(`function ${name} has no closing brace`); }
}
