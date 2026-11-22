// F244 candidate maker (M19 am6 item 4). NOT the product. $0. Copies src/ to .claude/scratch/suggested-one-reader/cand/src and removes the word copies `grown`, `oneOf`, `after` (their writes and their readers in `renderCard`),
// and makes the readout's numbers row (src/authoring.js) read the one reader's `numbersWords`. The real src/ is never written. Every replacement must match exactly once.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, '.claude/scratch/suggested-one-reader/cand');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });
cpSync(path.join(root, 'package.json'), path.join(out, 'package.json'));
const patch = (file, pairs) => {
  const f = path.join(out, 'src', file);
  let t = readFileSync(f, 'utf8');
  for (const [was, now] of pairs) { if (t.split(was).length !== 2) throw new Error(`${file}: not found exactly once: ${was.slice(0, 70)}`); t = t.replace(was, () => now); }
  writeFileSync(f, t);
};
patch('checkblock.js', [
  ["      r.grown = undefined;\n      r.oneOf = undefined;\n", ''],
  ["          r.grown = words.length ? words : undefined;\n", ''],
  ["          const anyOfs = facts.filter((f) => (r.factNames ?? []).includes(f.name) && Array.isArray(f.anyOf)).flatMap((f) => f.anyOf);\n          r.oneOf = anyOfs.length ? anyOfs : undefined;\n", ''],
  ["from: 'default', after: earlier });", "from: 'default' });"],
  ["body = `${CARD_T.numbers} ${(r.after ?? []).join(', ')}`;", "body = CARD_T.numbers;"],
  ["    else if (r.oneOf?.length) body = `fact \"${r.name ?? r.words?.[0] ?? ''}\" with one of the words ${r.oneOf.map((/** @type {string} */ w) => `\"${w}\"`).join(', ')}`;\n", ''],
  ["(r.grown ?? r.words)?.length ? ` ${CARD_T.withWords} ${(r.grown ?? r.words).map(", "r.words?.length ? ` ${CARD_T.withWords} ${r.words.map("],
]);
patch('authoring.js', [
  ["import { planMatchesCard } from './checkrows.js';", "import { planMatchesCard, numbersWords } from './checkrows.js';"],
  ["text: `${CARD_T.numbers} ${st.close.numbersFrom.join(', ')}`", "text: numbersWords(st.close.numbersFrom)"],
]);
console.log(`candidate at ${out} (copies removed in src/checkblock.js; numbers row reads numbersWords in src/authoring.js)`);
