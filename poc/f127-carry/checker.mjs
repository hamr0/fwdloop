// F127 mechanical checker for step C (code only, no LLM). Throwaway POC code; never imported by src.
export const US = ['color', 'organize', 'center', 'favorite', 'analyze', 'behavior'];
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;

/** @param {string} text @param {{skip?: string[]}} [o] skip = rules to disable (used only to prove the checker can fail) */
export function check(text, { skip = [] } = {}) {
  const lines = String(text ?? '').split('\n');
  const bullets = lines.map((l) => BULLET.exec(l)).filter(Boolean).map((m) => m[1]);
  const reds = [];
  if (!skip.includes('count') && bullets.length !== 4) reds.push(`found ${bullets.length} bullets, need exactly 4`);
  if (!skip.includes('words')) {
    bullets.forEach((b, i) => { const n = b.split(/\s+/).length; if (n >= 15) reds.push(`bullet ${i + 1} has ${n} words, need under 15`); });
  }
  if (!skip.includes('us')) {
    const hits = US.filter((w) => new RegExp(`\\b${w}`, 'i').test(text));
    if (hits.length) reds.push(`US spelling found: ${hits.join(', ')}`);
  }
  if (!skip.includes('very') && /\bvery\b/i.test(text)) reds.push('the word "very" is not allowed');
  return { green: reds.length === 0, red: reds.join('; ') };
}
/** the ask-1 part only: spelling and 'very' */
export const honoursAsk1 = (text) => check(text, { skip: ['count', 'words'] }).green;
