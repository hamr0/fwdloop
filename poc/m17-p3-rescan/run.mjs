// M17 P3 rescan POC ($0): `node poc/m17-p3-rescan/run.mjs <tree root>` -> JSON lines on stdout. Counts, ids and fixed words only; no job or ticket text is printed.
// Reads ~/.config/fwdloop/flows READ-ONLY. Per signed Tickets flow (flowType tickets or a ticketFilter/ticketWatch in its declaration):
// (a) readFlow (signature check + validateDeclaration, the run door); (b) the signed filter, watch, mcp tools and flowType as the run reads them;
// (c) per run with a frozen ticket input: decideTicket on that frozen text with the signed filter (verdict + reason).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tree = path.resolve(process.argv[2] ?? '.');
const imp = (f) => import(pathToFileURL(path.join(tree, 'src', f)).href);
const { readFlow } = await imp('flow.js');
const { loadCatalogue } = await imp('catalogue.js');
const { decideTicket } = await imp('ticket-labels.js');

const root = path.join(os.homedir(), '.config/fwdloop/flows');
const cat = loadCatalogue();
const out = (o) => console.log(JSON.stringify(o));

for (const name of fs.readdirSync(root).sort()) {
  const d = path.join(root, name);
  let decl;
  try { decl = JSON.parse(fs.readFileSync(path.join(d, 'declaration.json'), 'utf8')); } catch { continue; }
  if (decl.flowType !== 'tickets' && decl.ticketFilter === undefined && decl.ticketWatch === undefined) continue;
  let r;
  try { r = readFlow({ root, name, catalogue: cat.primitives }); } catch (e) { r = { ok: false, reds: [`THROW ${e.message}`] }; }
  out({ k: 'flow', flow: name, ok: r.ok, reds: r.ok ? 0 : r.reds.length, flowType: decl.flowType ?? null, filter: decl.ticketFilter ?? null, watch: decl.ticketWatch ?? null, mcpTools: decl.mcp?.tools ?? null });
  const runsDir = path.join(d, 'runs');
  const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
  for (const run of runs) {
    const inDir = path.join(runsDir, run, 'inputs');
    if (!fs.existsSync(inDir)) continue;
    for (const f of fs.readdirSync(inDir).sort()) {
      let v;
      try { v = decideTicket({ text: fs.readFileSync(path.join(inDir, f), 'utf8'), filter: decl.ticketFilter }); } catch (e) { v = { THROW: e.message }; }
      out({ k: 'ticket', flow: name, run, input: f, verdict: v });
    }
  }
}
