// F106: barebrowse as an MCP server through the M12 bridge. $0, NO model calls. See docs/logs/FINDINGS.md F106 pre-registration.
import { createMCPBridge } from 'bare-agent/mcp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = join(here, 'mcp.json');
const out = join(here, 'out');
const URL_ISSUE = 'https://codeberg.org/forgejo/forgejo/issues/1';
const ALL = ['browse','goto','snapshot','readable','click','type','press','scroll','back','forward','drag','upload','pdf','reload','screenshot','wait_for','tabs','select','hover','switch_engine','capabilities','eval','assess'];
const text = (r) => typeof r === 'string' ? r : JSON.stringify(r);
const save = (n, v) => writeFileSync(join(out, n), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const open = (allow) => createMCPBridge({ configPaths: [cfg], timeout: 60000, callTimeout: 90000, confirmServer: () => true, allow: { barebrowse: allow } });
const res = {};

// (a)+(b)
const A = await open(ALL);
const tools = A.tools.map((t) => ({ name: t.name, readOnlyHint: t.annotations?.readOnlyHint ?? 'absent', annotations: t.annotations ?? null }));
res.a = { errors: A.errors, missing: A.missing, listed: tools.length, tools };
res.b = { readOnlyTrue: tools.filter((t) => t.readOnlyHint === true).map((t) => t.name), m12RuleRefusesAll: tools.every((t) => t.readOnlyHint !== true) };
save('a-tools.json', res.a);
console.log('A tools', tools.map((t) => `${t.name}=${t.readOnlyHint}`).join(' '), 'errors', A.errors.length, 'missing', JSON.stringify(A.missing));
// (e) live: local scheme block
try {
  const r = await A.tools.find((t) => t.name === 'barebrowse_readable').execute({ url: 'file:///etc/hostname' });
  res.e_file = { refused: false, reply: text(r).slice(0, 300) };
} catch (e) { res.e_file = { refused: true, error: String(e.message).slice(0, 300) }; }
console.log('file: ->', JSON.stringify(res.e_file));
await A.close();

// (d) control: click allowed -> listed
const C = await open(['readable', 'click']);
res.d_control = { listsClick: C.tools.some((t) => t.name === 'barebrowse_click'), names: C.tools.map((t) => t.name) };
await C.close();

// (c)+(d)
for (const tool of ['readable', 'browse']) {
  const B = await open([tool]);
  const names = B.tools.map((t) => t.name);
  const t = B.tools.find((x) => x.name === `barebrowse_${tool}`);
  let body = '', err = null, ms = 0;
  const t0 = Date.now();
  try { body = text(await t.execute({ url: URL_ISSUE })); } catch (e) { err = String(e.message).slice(0, 300); }
  ms = Date.now() - t0;
  save(`c-${tool}.txt`, body || err);
  const c = { tool, ms, err, len: body.length, hasBody1: body.includes('set the timeout to 2h'), hasBody2: body.includes('ci.codeberg.org'), hasTitle: body.includes('Configure Woodpecker') };
  res[`c_${tool}`] = c; console.log('C', JSON.stringify(c));
  if (tool === 'readable') {
    const inv = B.metaTools?.find((m) => m.name === 'mcp_invoke');
    const tries = {};
    for (const bad of ['click', 'type', 'eval']) {
      try { const r = await inv.execute({ name: `barebrowse_${bad}`, args: {} }); tries[bad] = { refused: false, reply: text(r).slice(0, 200) }; }
      catch (e) { tries[bad] = { refused: true, denied: e.context?.denied === true, msg: String(e.message).slice(0, 200) }; }
    }
    res.d = { names, absent: ['click','type','eval'].every((n) => !names.includes(`barebrowse_${n}`)), missing: B.missing, tries };
    console.log('D', JSON.stringify(res.d));
  }
  await B.close();
}
save('result.json', res);
console.log('done');
