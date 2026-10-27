// F89 POC: a ticket's own page through fwdloop's fetchPageText (M12 piece 1). $0, no model. Read only.
// F89 rerun after M12 am1: the ticket read (ticket: true, data mode). Run: node poc/tickets/f89-2.mjs -> results-f89-2.json (wx)
import { writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPageText } from '../../src/pagefetch.js';

const OUT = process.env.F89_OUT || join(dirname(fileURLToPath(import.meta.url)), 'results-f89-2.json');
const mine = () => execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('barebrowse-') && !l.includes('ps -eo')).map((l) => l.trim().split(/\s+/)[0]);
const tmpDirs = () => new Set(readdirSync('/tmp').filter((d) => d.startsWith('barebrowse-')));
const pidsBefore = new Set(mine()), dirsBefore = tmpDirs();
const dl = setTimeout(() => { for (const p of mine()) if (!pidsBefore.has(p)) try { process.kill(Number(p), 'SIGKILL'); } catch {} console.error('F89 deadline 120s'); process.exit(3); }, 120000);
const norm = (s) => String(s).replace(/\s+/g, ' ');
const issue = JSON.parse(execFileSync('gh', ['issue', 'view', '30', '-R', 'hamr0/bareagent', '--json', 'title,body'], { encoding: 'utf8' }));
const bodyRun = norm(issue.body.split('\n').map((l) => l.replace(/^[#>\-\*\s]+/, '').replace(/[`*_]/g, '').trim()).find((l) => l.length >= 40) ?? '').slice(0, 40);
const R = { title: issue.title, bodyRun };
const ok = await fetchPageText('https://github.com/hamr0/bareagent/issues/30', { ticket: true });
const t = ok.ok ? norm(ok.text) : '';
R.T1 = ok.ok ? 'PASS' : `FAIL ${ok.error}`;
R.T2 = t.includes(norm(issue.title)) ? 'PASS' : 'FAIL title not in text';
R.T3 = bodyRun.length === 40 && t.includes(bodyRun) ? 'PASS' : `FAIL body run "${bodyRun}" not in text`;
R.T4 = ok.ok && !t.includes('[HTTP 404') ? 'PASS' : 'FAIL';
R.chars = t.length;
const nf = await fetchPageText('https://github.com/hamr0/bareloop/issues/999999', { ticket: true });
R.T5 = !nf.ok && /HTTP 404/.test(nf.error) ? 'PASS' : `FAIL ${JSON.stringify(nf).slice(0, 200)}`;
R.T5error = nf.ok ? null : nf.error;
const left = mine().filter((p) => !pidsBefore.has(p)), newDirs = [...tmpDirs()].filter((d) => !dirsBefore.has(d));
R.T6 = left.length === 0 && newDirs.length === 0 ? 'PASS' : `FAIL ${left.length} procs ${newDirs.length} dirs`;
clearTimeout(dl);
writeFileSync(OUT, JSON.stringify(R, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(R, null, 2));
