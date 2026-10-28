// F98 step 1: select the 20 fresh flutter tickets by the pre-registered rule. Fields number/labels/created_at only; no title, no body. $0, no model.
import { createMCPBridge } from 'bare-agent/mcp';
import { homedir } from 'node:os'; import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
import { readdirSync, writeFileSync } from 'node:fs';
const here = dirname(fileURLToPath(import.meta.url));
const have = new Set(readdirSync(join(here, '../../mcp/f96/out/raw')).map((f) => f)); // ids only used to skip the 12 by number below
const skip = new Set([100047, 193097, 187579, 193785, 180865, 195397, 195327, 195468]);
const parse = (r) => { const t = typeof r === 'string' ? r : r.content.map((c) => c.text ?? '').join(''); return JSON.parse(t); };
const b = await createMCPBridge({ configPaths: [join(homedir(), '.mcp.json')], timeout: 90000, callTimeout: 90000, confirmServer: () => true, allow: { github: ['list_issues', 'get_label'] } });
const li = b.tools.find((t) => t.name === 'github_list_issues'); const gl = b.tools.find((t) => t.name === 'github_get_label');
const A = [], B = []; const seen = new Set(); let after;
for (let p = 0; p < 5 && (A.length < 10 || B.length < 10); p++) {
  const r = parse(await li.execute({ owner: 'flutter', repo: 'flutter', state: 'CLOSED', orderBy: 'CREATED_AT', direction: 'DESC', perPage: 100, fields: ['number', 'labels', 'created_at'], ...(after ? { after } : {}) }));
  for (const i of r.issues) { i.labels = i.labels ?? [];
    for (const l of i.labels) seen.add(l);
    if (skip.has(i.number)) continue;
    if (i.labels.includes('c: crash')) { if (A.length < 10) A.push(i.number); } else if (B.length < 10) B.push(i.number);
  }
  after = r.pageInfo?.endCursor;
}
const labelChecks = {};
for (const name of ['c: crash', 'c: hang', 'c: performance']) { try { labelChecks[name] = parse(await gl.execute({ owner: 'flutter', repo: 'flutter', name })); } catch (e) { labelChecks[name] = { error: String(e.message).slice(0, 200) }; } }
await b.close();
writeFileSync(join(here, 'tickets.json'), JSON.stringify({ rule: 'closed, newest first; A = first 10 with c: crash, B = first 10 without; skipping the 8 flutter tickets already in the 12', A, B }, null, 1));
writeFileSync(join(here, 'out/labels.json'), JSON.stringify({ labelsSeenOnPages: [...seen].sort(), labelChecks }, null, 1));
console.log(JSON.stringify({ A, B, hangLabel: labelChecks['c: hang'] }));
