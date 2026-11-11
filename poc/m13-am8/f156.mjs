// F156 ($0, read only): usage  node f156.mjs <repoDir> <flowsRoot>   -> one JSON line per flow.
// Replicates authorflows: readSigned (readFlow + loadCatalogue), the edit card (cardFromSigned), reuseCheck's same-job test.
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [repo, root] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(join(repo, p)).href);
const { readFlow } = await imp('src/flow.js');
const { loadCatalogue } = await imp('src/catalogue.js');
const { jobKeyOfCard, jobKeyOfSigned } = await imp('src/jobkey.js');
const { cardFromSigned, cardToProse, cardFields } = await imp('src/panel/authorcard.js');
const { flowTypeOf } = await imp('src/declaration.js');
const cat = loadCatalogue();
for (const name of readdirSync(root).sort()) {
  const out = { flow: name };
  try {
    const read = readFlow({ root, name, catalogue: cat.primitives });
    if (!read.ok) { out.read = false; out.same = 'unread'; console.log(JSON.stringify(out)); continue; }
    out.read = true;
    const c = cardFromSigned(read);
    out.card = c.ok;
    if (!c.ok) { out.same = 'nocard'; console.log(JSON.stringify(out)); continue; }
    out.same = jobKeyOfCard(c.card.job) === jobKeyOfSigned(read) ? 'same' : 'DIFFERENT';
    out.type = flowTypeOf(read.declaration);
    const again = cardToProse(cardFields({ ...c.card, flowName: name }));
    out.roundTrip = again === readFileSync(join(root, name, 'prose.txt'), 'utf8') ? 'y' : 'n';
    out.proseLen = again.length;
  } catch (e) { out.same = 'error'; out.err = String(e?.message ?? e).slice(0, 120); }
  console.log(JSON.stringify(out));
}
