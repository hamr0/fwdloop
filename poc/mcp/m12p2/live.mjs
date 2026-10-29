// M12 piece 2 live check, $0, NO model calls: two real looks at microsoft/vscode a few minutes apart through the real code (src/trigger-tickets.js lookTickets + recordLook,
// the real ~/.mcp.json github server started with allow = list_issues only), then the arrivals compared with `gh api`.
// Usage: node poc/mcp/m12p2/live.mjs [--wait-sec 360] [--repo microsoft/vscode] [--out poc/mcp/m12p2/out]   (run detached: it waits)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lookTickets, recordLook, seenNumbers, lastSeen } from '../../../src/trigger-tickets.js';
import { readSeen } from '../../../src/trigger-files.js';

const here = dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const g = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const repo = g('--repo', 'microsoft/vscode');
const waitSec = Number(g('--wait-sec', 360));
const out = g('--out', join(here, 'out'));
mkdirSync(out, { recursive: true });
const ledger = join(out, 'ledger.jsonl');
rmSync(ledger, { force: true });
const sig = 'live';
const list = `https://github.com/${repo}/issues`;
const res = { repo, waitSec, looks: [] };
const look = async (n) => {
  const first = n === 0;
  const t0 = Date.now();
  const r = await lookTickets({ listUrl: list, mcp: { server: 'github', tool: 'list_issues' }, seen: first ? null : seenNumbers(ledger, sig), last: first ? new Map() : lastSeen(ledger, sig), watch: [], perPage: 10 });
  const w = recordLook(ledger, sig, r, Date.now());
  res.looks.push({ at: new Date().toISOString(), ms: Date.now() - t0, ok: r.ok, error: r.ok ? null : r.error, first, pages: r.ok ? r.pages : null, found: r.ok ? r.found.map((i) => i.number) : null, arrived: w.arrived });
};
await look(0);
await new Promise((r) => { setTimeout(r, waitSec * 1000); });
await look(1);
const maxBase = Math.max(...readSeen(ledger, sig).filter((r) => r.kind === 'baseline').map((r) => r.number));
const gh = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=100`], { encoding: 'utf8', timeout: 60000 }));
res.maxBaseline = maxBase;
res.ghNewOpenIssues = gh.filter((i) => !i.pull_request && i.number > maxBase).map((i) => i.number).sort((x, y) => x - y);
res.ours = res.looks[1].arrived.slice().sort((x, y) => x - y);
res.match = JSON.stringify(res.ghNewOpenIssues) === JSON.stringify(res.ours);
res.note = res.ours.length === 0 ? 'zero new arrivals in the window: agreement is trivial, not a proof of detection' : 'arrivals present';
writeFileSync(join(out, 'result.json'), `${JSON.stringify(res, null, 2)}\n`);
console.log(JSON.stringify(res));
process.exit(0);
