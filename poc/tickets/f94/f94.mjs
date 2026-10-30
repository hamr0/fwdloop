// F94 POC: find NEW tickets on a real list page and queue them oldest first, by code alone. $0, no model, no provider, no key.
// Run (from the F92 scratch copy, so src/pagefetch.js is the scratch one): node poc/tickets/f94/f94.mjs <outdir>
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fetchPageText } from '../../../src/pagefetch.js';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const T0 = Date.now();
const sleepUntil = (ms) => new Promise((r) => setTimeout(r, Math.max(0, T0 + ms - Date.now())));
const mine = () => execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n').filter((l) => /barebrowse-|firefox|chrom/i.test(l) && !l.includes('ps -eo')).map((l) => l.trim().split(/\s+/)[0]);
const tmpDirs = () => new Set(readdirSync('/tmp').filter((d) => d.startsWith('barebrowse-')));
const pidsBefore = new Set(mine()), dirsBefore = tmpDirs();
const dl = setTimeout(() => { for (const p of mine()) if (!pidsBefore.has(p)) try { process.kill(Number(p), 'SIGKILL'); } catch {} console.error('F94 deadline 45 min'); process.exit(3); }, 45 * 60 * 1000);

const { connect } = await import('barebrowse');
const linkedConnect = (o) => connect({ ...o, links: true });

/** K5: this file holds no provider, model or key code (the forbidden words are built so this check does not match itself) */
const src = readFileSync(new URL(import.meta.url), 'utf8');
const banned = [['make', 'Provider'], ['bare', '-agent'], ['DEEP', 'SEEK'], ['process', '.env']].map((a) => a.join(''));
const K5hits = banned.filter((w) => src.split('\n').filter((l) => !l.includes('const banned')).join('\n').includes(w));

/** the ticket rule (withdrawn M12 item 5): same host, <list path>/<digits> exactly; query and fragment dropped */
function ticketPrefix(listUrl) { const u = new URL(listUrl); return { host: u.host, prefix: u.pathname.replace(/\/+$/, '') }; }
function classify(text, listUrl) {
  const { host, prefix } = ticketPrefix(listUrl);
  const kept = new Set(); const dropped = [];
  for (const m of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) {
    let u; try { u = new URL(m[1]); } catch { continue; }
    const canon = `${u.protocol}//${u.host}${u.pathname}`;
    if (u.host === host && new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d+$`).test(u.pathname)) kept.add(canon);
    else if (/\/issues|\/pull\//.test(u.pathname + u.search)) dropped.push(m[1]);
  }
  const tickets = [...kept].sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop()));
  return { tickets, dropped: [...new Set(dropped)] };
}
const num = (a) => Number(a.split('/').pop());

/** one look: ok with tickets, or unreadable with a reason; never "no new tickets" for a page that did not read or shows no ticket */
async function look(name, listUrl, tag) {
  const t = Date.now();
  const r = await fetchPageText(listUrl, { ticket: true, connect: linkedConnect });
  const ms = Date.now() - t;
  const rec = { name, tag, listUrl, ms, at: new Date().toISOString() };
  if (!r.ok) return { ...rec, status: 'unreadable', reason: r.error, tickets: [], dropped: [] };
  writeFileSync(join(OUT, `${tag}-${name}.txt`), r.text);
  const c = classify(r.text, listUrl);
  const dates = (r.text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, 20\d\d, \d{1,2}:\d\d [AP]M/g) ?? []).length;
  const urlHeader = (r.text.match(/^url: .*$/m) ?? [''])[0];
  if (c.tickets.length === 0) return { ...rec, status: 'unreadable', reason: 'the page loaded (2xx) but shows no ticket link', chars: r.text.length, urlHeader, tickets: [], dropped: c.dropped };
  return { ...rec, status: 'ok', chars: r.text.length, urlHeader, dateStrings: dates, tickets: c.tickets, dropped: c.dropped };
}

const LISTS = { flutter: 'https://github.com/flutter/flutter/issues', bareagent: 'https://github.com/hamr0/bareagent/issues?q=is%3Aissue' };
const R = { startedAt: new Date(T0).toISOString(), K5hits, looks: [], seen: {}, queues: {}, K4: [] };
const save = () => writeFileSync(join(OUT, 'results.json'), JSON.stringify(R, null, 2) + '\n');

/** the seen list + queue step: first ok look marks all seen; later ok looks queue unseen, oldest first; nothing is ever removed */
function step(name, L) {
  if (L.status !== 'ok') { R.queues[name] = [...(R.queues[name] ?? []), { tag: L.tag, status: 'unreadable', queued: null }]; return; }
  if (!R.seen[name]) { R.seen[name] = [...L.tickets]; R.queues[name] = [{ tag: L.tag, status: 'ok', queued: [] }]; return; }
  const seen = new Set(R.seen[name]);
  const queued = L.tickets.filter((a) => !seen.has(a)).sort((a, b) => num(a) - num(b));
  const gone = R.seen[name].filter((a) => !L.tickets.includes(a));
  if (gone.length) R.K4.push({ name, tag: L.tag, goneFromPage: gone, queued: queued.includes(gone[0]), stillSeen: true });
  for (const a of queued) seen.add(a);
  R.seen[name] = [...seen];
  R.queues[name].push({ tag: L.tag, status: 'ok', queued });
}

async function doLooks(tag) {
  for (const [name, url] of Object.entries(LISTS)) { const L = await look(name, url, tag); R.looks.push(L); step(name, L); save(); }
}

// --- K3 + recorded filtered URL, at the start (one browser per fetch, closed each time)
await doLooks('L1');
R.k3 = [];
for (const [id, url] of [['a-404-path', 'https://github.com/hamr0/bareagent/issues-nope'], ['b-no-such-repo', 'https://github.com/hamr0-no-such-owner/no-such-repo/issues'], ['c-empty-label', 'https://github.com/hamr0/bareagent/issues?q=is%3Aissue+label%3Ano-such-label-f94']]) {
  const L = await look(id, url, 'K3'); R.k3.push({ id, ...L, queuedAsNoNew: L.status === 'ok' }); save();
}
{
  const r = await fetchPageText('https://github.com/hamr0/bareagent', { ticket: true, connect: linkedConnect });
  const c = r.ok ? classify(r.text, 'https://github.com/hamr0/bareagent/issues') : null;
  R.k3c2 = r.ok ? { status: c.tickets.length === 0 ? 'unreadable' : 'ok', reason: c.tickets.length === 0 ? 'repo root loaded 2xx, no /issues/N link' : 'has tickets', tickets: c.tickets, dropped: c.dropped } : { status: 'unreadable', reason: r.error };
}
R.filtered = await look('flutter-P2', 'https://github.com/flutter/flutter/issues?q=is%3Aopen+label%3AP2', 'REC'); save();

// --- L2 at t = 10 min
await sleepUntil(10 * 60 * 1000);
await doLooks('L2');
const flutterNew = () => R.queues.flutter.some((q) => q.tag !== 'L1' && q.queued?.length);
if (!flutterNew()) { const t2 = Date.now() - T0; await sleepUntil(t2 + 20 * 60 * 1000); await doLooks('L3'); }
R.endedAt = new Date().toISOString();
R.leftoverProcs = mine().filter((p) => !pidsBefore.has(p)).length;
R.leftoverDirs = [...tmpDirs()].filter((d) => !dirsBefore.has(d));
save();
clearTimeout(dl);
console.log('F94 done', R.endedAt);
