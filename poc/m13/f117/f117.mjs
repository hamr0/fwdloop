// F117, $0, no model call, read-only. Prints numbers, names, lengths, ms only; never env, commands, tokens.
import { execFileSync } from 'node:child_process';
import { lookTickets } from '../../../src/trigger-tickets.js';
import { readTicketMcp } from '../../../src/ticket-mcp.js';

const listUrl = 'https://github.com/hamr0/hol-guard/issues';
const t0 = Date.now(); const T0 = new Date(t0).toISOString();
const look = await lookTickets({ listUrl, mcp: { server: 'github', tool: 'list_issues' }, seen: null, last: new Map(), watch: [], perPage: 10, timeoutMs: 60000 });
const tA = Date.now() - t0;
if (!look.ok) { console.log('(a) REFUSED:', look.error); process.exit(2); }
const numbers = look.found.map((i) => i.number);
const N = Math.max(...numbers);
console.log('(a) T0', T0, 'pages', look.pages, 'found', JSON.stringify(numbers), 'N', N, 'ms', tA);
const t1 = Date.now();
const got = await readTicketMcp({ listUrl, number: N, mcp: { server: 'github', tools: ['issue_read'] }, timeoutMs: 60000 });
const tB = Date.now() - t1;
if (!got.ok) { console.log('(b) REFUSED:', got.error); process.exit(2); }
let o = null; try { o = JSON.parse(got.text); } catch {}
const rec = look.found.find((i) => i.number === N);
console.log('(b) ok', got.ok, 'textLen', got.text.length, 'url', got.url, 'state', o?.state ?? rec.state, 'labels', JSON.stringify((o?.labels ?? rec.labels).map((l) => l.name ?? l)), 'ms', tB);
console.log('(b) record', JSON.stringify({ server: got.record.server, exposed: got.record.exposed, calls: got.record.calls }));
// (c) the entry shape runner.js:449 writes
const entry = { path: listUrl, ticket: { number: N, title: o?.title ?? null } };
console.log('(c) run.json input entry shape:', JSON.stringify(entry), '; baseline cut = inputs[].ticket.number =', entry.ticket.number, '; new file: none');
console.log('(d) wall ms (a)+(b):', tA + tB);
let kids = '';
try { kids = execFileSync('ps', ['--ppid', String(process.pid), '-o', 'pid=,comm=']).toString().trim(); } catch { kids = ''; }
console.log('(d) children of this process after close:', kids === '' ? 'none' : kids);
