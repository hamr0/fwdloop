// F99 reference matcher: plain JS, independent of bareguard. NO regex built from phrases.
// Rule (bareguard ruling #69): word edges on \p{L}\p{M}\p{Nd}; one ASCII space in a phrase = any whitespace run.
// Method: split text and phrase into alternating word-runs / separator-runs, compare token sequences.
const WORD_CH = /^[\p{L}\p{M}\p{Nd}]$/u; // fixed class, never built from input
const isWord = (ch) => WORD_CH.test(ch);
const isWs = (s) => s.length > 0 && [...s].every((c) => /^\s$/u.test(c));

// -> [{w:bool, s:string}] maximal runs
export function runs(text) {
  const out = [];
  for (const ch of text) {
    const w = isWord(ch);
    if (out.length && out[out.length - 1].w === w) out[out.length - 1].s += ch;
    else out.push({ w, s: ch });
  }
  return out;
}
// does phrase (already folded as needed) occur in text on word edges? strict = compare without case fold
export function refFound(text, phrase, strict = false) {
  const fold = (s) => (strict ? s : s.toLowerCase());
  const T = runs(text).map((r) => ({ w: r.w, s: fold(r.s) }));
  const P = runs(phrase).map((r) => ({ w: r.w, s: fold(r.s) }));
  if (!P.length || !P[0].w || !P[P.length - 1].w) return false; // phrase must start+end with letter/digit
  for (let i = 0; i + P.length <= T.length; i++) {
    if (!T[i].w) continue; // a match starts at a word run: the char before is then a separator or text start
    let ok = true;
    for (let j = 0; j < P.length && ok; j++) {
      const t = T[i + j], p = P[j];
      if (t.w !== p.w) ok = false;
      else if (p.w) ok = t.s === p.s; // whole word run equal => both edges are word edges
      else ok = p.s === ' ' ? isWs(t.s) : t.s === p.s; // single space = any whitespace run; else exact
    }
    if (ok) return true;
  }
  return false;
}
// phrases found, in signed order
export const refMatched = (text, phrases, strict = false) => phrases.filter((p) => refFound(text, p, strict));
export const refGreen = (text, phrases, strict = false) => refMatched(text, phrases, strict).length > 0;
