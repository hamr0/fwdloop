// M10 am22 rescan. $0, read-only: no model, no network, writes nothing. Reads every signed job under a flows root through the real run-start reader (`readFlow`, which
// parses the signed text and validates the declaration) and says how many still pass. A refusal whose words name am22 (picked / pickedLines / a fact line's count) is
// counted apart: the amendment must refuse no job that signed before it.  Usage: node poc/m10-am22/rescan.mjs [flowsRoot]
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { readFlow } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';

const root = process.argv[2] ?? path.join(homedir(), '.config', 'fwdloop', 'flows');
const cat = loadCatalogue();
if (!cat.ok) throw new Error('catalogue did not load');
let pass = 0; let fail = 0; let am22 = 0; let usesPicked = 0;
for (const name of readdirSync(root).sort()) {
  if (!existsSync(path.join(root, name, 'signature.json'))) continue;
  const r = readFlow({ root, name, catalogue: cat.primitives });
  if (r.ok) {
    pass += 1;
    if (r.declaration.steps.some((/** @type {any} */ s) => s?.close?.picked !== undefined) || r.declaration.pickedLines !== undefined) usesPicked += 1;
    continue;
  }
  fail += 1;
  const hit = r.reds.some((/** @type {string} */ x) => /picked|pickedLines|count check/.test(x));
  if (hit) am22 += 1;
  console.log(`${hit ? 'AM22 ' : 'other'} ${name}: ${r.reds[0]}`);
}
console.log(`signed jobs: ${pass + fail}; still pass: ${pass}; refuse: ${fail} (of those, by am22 words: ${am22}); carry am22 fields: ${usesPicked}`);
