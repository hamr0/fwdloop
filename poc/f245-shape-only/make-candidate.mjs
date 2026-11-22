// F245 ($0): a patched COPY of src under .claude/scratch/f245/cand/src (untracked). The real src is never written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dest = path.join(REPO, '.claude/scratch/f245/cand');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(path.join(REPO, 'src'), path.join(dest, 'src'), { recursive: true });
fs.copyFileSync(path.join(REPO, 'package.json'), path.join(dest, 'package.json'));
const patch = (file, from, to) => {
  const p = path.join(dest, 'src', file);
  const t = fs.readFileSync(p, 'utf8');
  if (t.split(from).length !== 2) throw new Error(`${file}: patch anchor not found exactly once`);
  fs.writeFileSync(p, t.replace(from, to));
};
patch('canrun.js', "step.close?.class === 'green' && !step.close.cited && !Array.isArray(step.close.sheet)) {", "step.close?.class === 'green' && !step.close.cited && !Array.isArray(step.close.sheet) && !(step.close.itemShape && typeof step.close.itemShape === 'object')) {");
patch('checked.js', "    } else if (cls === 'green') {\n      out.push('Every figure must cite", "    } else if (cls === 'green' && st.close.itemShape && typeof st.close.itemShape === 'object') {\n      // no lead sentence\n    } else if (cls === 'green') {\n      out.push('Every figure must cite");
console.log('candidate written', dest);
