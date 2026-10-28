// F96 extra (after the main run): does list_issues `since` actually filter? $0.
import { createMCPBridge } from 'bare-agent/mcp';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';
const b = await createMCPBridge({ configPaths: [homedir() + '/.mcp.json'], timeout: 90000, callTimeout: 90000, confirmServer: () => true, allow: { github: ['list_issues'] } });
const li = b.tools[0]; const out = {};
const p = (r) => { const t = typeof r === 'string' ? r : (r.content || []).map((c) => c.text).join(''); return JSON.parse(t); };
for (const [k, since] of [['future', '2030-01-01T00:00:00Z'], ['last3h', new Date(Date.now() - 3 * 3600e3).toISOString()], ['last24h', new Date(Date.now() - 24 * 3600e3).toISOString()]]) {
  const r = p(await li.execute({ owner: 'flutter', repo: 'flutter', state: 'OPEN', since, orderBy: 'CREATED_AT', direction: 'ASC', perPage: 100, fields: ['number', 'created_at', 'updated_at'] }));
  out[k] = { since, count: r.issues.length, totalCount: r.totalCount, hasNext: r.pageInfo?.hasNextPage, firstCreated: r.issues[0]?.created_at, firstNumber: r.issues[0]?.number, lastNumber: r.issues.at(-1)?.number, ascending: r.issues.every((x, i) => i === 0 || r.issues[i - 1].created_at <= x.created_at) };
}
await b.close();
writeFileSync(new URL('out/since-probe.json', import.meta.url), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out));
