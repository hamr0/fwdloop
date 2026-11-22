// F243 candidate maker (M19 am10). NOT the product. $0. Copies src/ to .claude/scratch/am10-cand/src and patches ONE condition of `checkPickedKey`
// (src/declaration.js): a green step that has item fields (`close.itemShape`) and no quote may also carry `close.picked`. The real src/ is never written.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, '.claude/scratch/am10-cand');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });
cpSync(path.join(root, 'package.json'), path.join(out, 'package.json'));
const f = path.join(out, 'src/declaration.js');
const was = "!(isPlainObject(step.close.cited) || Array.isArray(step.close.sheet))) {";
const now = "!(isPlainObject(step.close.cited) || Array.isArray(step.close.sheet) || isPlainObject(step.close.itemShape))) {";
const text = readFileSync(f, 'utf8');
if (text.split(was).length !== 2) throw new Error('the condition to patch is not found exactly once');
writeFileSync(f, text.replace(was, now));
console.log(`candidate at ${out} (one condition patched in src/declaration.js)`);
