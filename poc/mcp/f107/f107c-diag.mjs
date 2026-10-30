// F107 extension (NOT pre-registered): why did (c) time out? Same call, varying only the env.
import { createMCPBridge } from 'bare-agent/mcp';
import { join, dirname } from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const S = process.env.F107_SCRATCH, here = dirname(fileURLToPath(import.meta.url));
const ISSUE = 'https://codeberg.org/forgejo/forgejo/issues/1';
const cases = { 'no-lock-tier-r': { BAREBROWSE_TIER: 'r' }, 'lock-codeberg': { BAREBROWSE_TIER: 'r', BAREBROWSE_ALLOW: 'codeberg.org,*.codeberg.org' }, 'no-lock-no-tier': {} };
const out = {};
for (const [k, env] of Object.entries(cases)) {
  const p = join(S, `mcp-f107diag-${k}.json`);
  writeFileSync(p, JSON.stringify({ mcpServers: { barebrowse: { command: 'node', args: [join(S, 'bb027', 'mcp-server.js')], env: { BAREBROWSE_MODE: 'headless', BAREBROWSE_IDLE_MINUTES: '3', ...env } } } }));
  const B = await createMCPBridge({ configPaths: [p], timeout: 60000, callTimeout: 90000, confirmServer: () => true, allow: { barebrowse: ['browse'] } });
  const t0 = Date.now(); let body = '', err = null;
  try { const r = await B.tools[0].execute({ url: ISSUE, pruneMode: 'data' }); body = typeof r === 'string' ? r : JSON.stringify(r); } catch (e) { err = String(e.message).slice(0, 200); }
  out[k] = { ms: Date.now() - t0, err, len: body.length, b1: body.includes('set the timeout to 2h'), b2: body.includes('ci.codeberg.org') };
  console.log(k, JSON.stringify(out[k]));
  await B.close();
}
writeFileSync(join(here, 'out', 'c-diag.json'), JSON.stringify(out, null, 2));
