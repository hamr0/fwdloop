// Arm A = learn.mjs unchanged. Arm B variants are CUMULATIVE source patches over the copy, generated into gen/ at run time.
// Each patch must hit exactly once or the run throws (a silent no-op patch would fake a pass).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PATCHES = {
  // B1: a fwdloop gap line is a red line by construction (the close wrote it), so every non-empty gap line is "flagged text".
  B1: [[`  if (/\\berror TS\\d+:|\\berror:/.test(line)) {`, `  if (line.trim()) return line.trim();\n  if (/\\berror TS\\d+:|\\berror:/.test(line)) {`]],
  // B2: kind = the close class of the check ("green" | "softgreen" | "hitl"), read from the check name "<step> (line N, <class>)".
  B2: [[`    const k = errorKinds(quote, full);`, `    const k = errorKinds(quote, full);\n    { const cm = check.match(/, ([a-z]+)\\)$/); if (k.kinds[0] === 'other' && cm) k.kinds = [cm[1]]; }`]],
};
const ORDER = ['B1', 'B2'];

export async function makeVariant(name) {
  if (name === 'A') return import('./learn.mjs');
  let src = fs.readFileSync(path.join(here, 'learn.mjs'), 'utf8');
  for (const v of ORDER.slice(0, ORDER.indexOf(name) + 1)) {
    for (const [from, to] of PATCHES[v]) {
      const n = src.split(from).length - 1;
      if (n !== 1) throw new Error(`variant ${v}: patch hit ${n} times, need exactly 1`);
      src = src.replace(from, () => to);
    }
  }
  fs.mkdirSync(path.join(here, 'gen'), { recursive: true });
  fs.copyFileSync(path.join(here, 'validate.mjs'), path.join(here, 'gen', 'validate.mjs'));
  const f = path.join(here, 'gen', `learn.${name}.mjs`);
  fs.writeFileSync(f, src);
  return import(f);
}
