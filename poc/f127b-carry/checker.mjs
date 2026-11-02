// F127b mechanical checker for step C (code only, no LLM). Throwaway POC code; never imported by src.
export const FACTS = { okafor: 'Mrs Okafor', tom: 'Kind regards, Tom', deadline: '14 March' };
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;

/** which of the three human facts the text holds (exact, case-sensitive substrings) @param {string} text */
export const factsIn = (text) => Object.fromEntries(Object.entries(FACTS).map(([k, v]) => [k, String(text ?? '').includes(v)]));

/** @param {string} text @param {{skip?: string[]}} [o] skip = rules to disable (only to prove the checker can fail) */
export function check(text, { skip = [] } = {}) {
  const bullets = String(text ?? '').split('\n').map((l) => BULLET.exec(l)).filter(Boolean).map((m) => m[1]);
  const reds = [];
  if (!skip.includes('count') && bullets.length !== 3) reds.push(`found ${bullets.length} bullets, need exactly 3`);
  if (!skip.includes('words')) bullets.forEach((b, i) => { const n = b.split(/\s+/).length; if (n >= 15) reds.push(`bullet ${i + 1} has ${n} words, need under 15`); });
  if (!skip.includes('very') && /\bvery\b/i.test(text)) reds.push('the word "very" is not allowed');
  for (const [k, v] of Object.entries(FACTS)) if (!skip.includes(k) && !String(text ?? '').includes(v)) reds.push(`missing "${v}"`);
  return { green: reds.length === 0, red: reds.join('; ') };
}
