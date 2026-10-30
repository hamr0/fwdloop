// F105: call the scratch preflight (canFlowRun / readFlow) directly. $0, no model, no MCP server. Run from the scratch copy dir: node h105.mjs <scratch-src> <flows-root>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [src, root] = process.argv.slice(2);
const { canFlowRun } = await import(pathToFileURL(src + '/src/canrun.js'));
const { readFlow } = await import(pathToFileURL(src + '/src/flow.js'));
const decl = JSON.parse(readFileSync(root + '/../../f100/flows/f100/declaration.json', 'utf8'));
const show = (n, r) => console.log(n, JSON.stringify(r));
show('H3 control f100 declaration', canFlowRun({ ok: true, declaration: decl }));
show('H1 mcpTools [issue_read,list_issues]', canFlowRun({ ok: true, declaration: { ...decl, mcpTools: ['issue_read', 'list_issues'] } }));
const d2 = structuredClone(decl); d2.steps[0].primitives = ['read', 'notWired'];
show('H2 control unwired verb', canFlowRun({ ok: true, declaration: d2 }));
const { loadCatalogue } = await import(pathToFileURL(src + '/src/catalogue.js'));
let r; try { r = readFlow({ root, name: 'f105', catalogue: loadCatalogue().primitives }); } catch (e) { r = { threw: String(e.message).slice(0, 200) }; }
show('H4 readFlow edited copy', { ok: r.ok, reds: r.reds, threw: r.threw });
