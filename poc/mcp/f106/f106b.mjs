// F106b: NOT pre-registered extension (labelled so in FINDINGS). Same bridge, same scratch config, $0, no model call.
// Why: f106.mjs showed `readable` takes no url (reads the session page) and `browse` default pruneMode=act drops prose. These runs vary only that.
import { createMCPBridge } from 'bare-agent/mcp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const here = dirname(fileURLToPath(import.meta.url));
const cfg = join(here, 'mcp.json'); const out = join(here, 'out');
const U = 'https://codeberg.org/forgejo/forgejo/issues/1';
const text = (r) => typeof r === 'string' ? r : JSON.stringify(r);
const open = (allow) => createMCPBridge({ configPaths: [cfg], timeout: 60000, callTimeout: 90000, confirmServer: () => true, allow: { barebrowse: allow } });
const mark = (b) => ({ len: b.length, hasBody1: b.includes('set the timeout to 2h'), hasBody2: b.includes('ci.codeberg.org'), hasTitle: b.includes('Configure Woodpecker') });
const res = {};
const call = async (B, n, a) => { try { return text(await B.tools.find((t) => t.name === `barebrowse_${n}`).execute(a)); } catch (e) { return `ERROR: ${String(e.message).slice(0, 300)}`; } };

let B = await open(['browse']);
for (const pm of ['read', 'data']) {
  const b = await call(B, 'browse', { url: U, pruneMode: pm }); writeFileSync(join(out, `b-browse-${pm}.txt`), b);
  res[`browse_${pm}`] = mark(b); console.log('browse', pm, JSON.stringify(res[`browse_${pm}`]));
}
const f = await call(B, 'browse', { url: 'file:///etc/hostname' }); writeFileSync(join(out, 'b-browse-file.txt'), f);
res.browse_file = f.slice(0, 300); console.log('browse file:', res.browse_file);
const l = await call(B, 'browse', { url: 'http://127.0.0.1:1/' }); res.browse_loopback = l.slice(0, 200); console.log('browse loopback:', res.browse_loopback);
await B.close();

B = await open(['goto', 'readable']);
console.log('allow goto+readable ->', B.tools.map((t) => t.name).join(','), 'annotations', JSON.stringify(B.tools.map((t) => t.annotations ?? null)));
const g = await call(B, 'goto', { url: U }); console.log('goto', g.slice(0, 120));
const r = await call(B, 'readable', {}); writeFileSync(join(out, 'b-readable-after-goto.txt'), r);
res.goto_readable = mark(r); console.log('readable after goto', JSON.stringify(res.goto_readable));
await B.close();
writeFileSync(join(out, 'result-b.json'), JSON.stringify(res, null, 2));
