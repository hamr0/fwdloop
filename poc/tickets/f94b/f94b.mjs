// F94b POC: flood. Read flutter issues page 1..N until a page holds an already-seen ticket. $0, no model, no key.
// Run (from the F92 scratch copy): node poc/tickets/f94b/f94b.mjs <outdir> <old-results.json>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fetchPageText } from '../../../src/pagefetch.js';

const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const OLD = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const oldSeen = new Set(OLD.looks[0].tickets);               // flutter L1 (looks[0]); NOT the grown `seen` field
const L1_AT = Date.parse(OLD.looks[0].at);
const L1_MIN = Math.floor(L1_AT / 60000);                    // minute resolution on the page
const LIMIT = 10;
const BASE = 'https://github.com/flutter/flutter/issues';
const PREFIX = '/flutter/flutter/issues';
const { connect } = await import('barebrowse');
const linkedConnect = (o) => connect({ ...o, links: true });

const src = readFileSync(new URL(import.meta.url), 'utf8');
const banned = [['make', 'Provider'], ['bare', '-agent'], ['DEEP', 'SEEK'], ['process', '.env']].map((a) => a.join(''));
const K5hits = banned.filter((w) => src.split('\n').filter((l) => !l.includes('const banned')).join('\n').includes(w));

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseDate(s) { // "Oct 28, 2026, 10:01 AM GMT+1" -> epoch ms
  const m = s.match(/^(\w{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d\d) (AM|PM) GMT([+-]\d+)(?::(\d\d))?$/); if (!m) return null;
  let h = Number(m[4]) % 12 + (m[6] === 'PM' ? 12 : 0);
  const off = Number(m[7]) * 60 + (m[8] ? Math.sign(Number(m[7])) * Number(m[8]) : 0);
  return Date.UTC(Number(m[3]), MON[m[1]], Number(m[2]), h, Number(m[5])) - off * 60000;
}
const num = (a) => Number(a.split('/').pop());
const ticketRe = new RegExp(`^${PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d+$`);
const ind = (l) => l.length - l.trimStart().length;

/** one page -> tickets {addr, date, pinned}, dropped links, structure */
function parsePage(text) {
  const lines = text.split('\n');
  // pinned block: lines after list "...pinned issues list." that are indented deeper than it
  const pinned = new Set(); const pinLine = lines.findIndex((l) => /list "[^"]*pinned issues list\./.test(l));
  if (pinLine >= 0) for (let i = pinLine + 1; i < lines.length && ind(lines[i]) > ind(lines[pinLine]); i++) for (const m of lines[i].matchAll(/<(https?:\/\/[^>\s]+)>/g)) pinned.add(canon(m[1]));
  const kept = new Map(); const dropped = [];
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/<(https?:\/\/[^>\s]+)>/g)) {
      let u; try { u = new URL(m[1]); } catch { continue; }
      if (u.host === 'github.com' && ticketRe.test(u.pathname)) {
        const a = canon(m[1]);
        if (!kept.has(a)) { // date = first generic "<date>" within the next 14 lines
          let d = null; for (let j = i; j < Math.min(lines.length, i + 14); j++) { const dm = lines[j].match(/generic "([^"]+GMT[^"]*)"/); if (dm) { d = dm[1]; break; } }
          kept.set(a, { addr: a, dateStr: d, date: d ? parseDate(d) : null, pinned: pinned.has(a) });
        }
      } else if (/\/issues|\/pull\//.test(u.pathname + u.search)) dropped.push(m[1]);
    }
  });
  const pagination = (lines.find((l) => /Pagination:/.test(l)) ?? '').trim();
  return { tickets: [...kept.values()], dropped: [...new Set(dropped)], pagination };
}
function canon(h) { const u = new URL(h); return `${u.protocol}//${u.host}${u.pathname}`; }

const R = { startedAt: new Date().toISOString(), K5hits, L1_AT: new Date(L1_AT).toISOString(), oldSeenCount: oldSeen.size, pages: [] };
const save = () => writeFileSync(join(OUT, 'results.json'), JSON.stringify(R, null, 2) + '\n');
const deadline = setTimeout(() => { console.error('F94b deadline'); process.exit(3); }, 280000);

async function readPage(n) {
  const url = n === 1 ? BASE : `${BASE}?page=${n}`;
  const t = Date.now();
  const r = await fetchPageText(url, { ticket: true, connect: linkedConnect });
  const ms = Date.now() - t;
  if (!r.ok) return { n, url, ms, status: 'unreadable', reason: r.error };
  writeFileSync(join(OUT, `page-${n}.txt`), r.text);
  const p = parsePage(r.text);
  return { n, url, ms, status: p.tickets.length ? 'ok' : 'unreadable', reason: p.tickets.length ? undefined : 'no ticket link', ...p };
}

// R-lit stops at first page holding any old-seen ticket; R-pin ignores the pinned block.
let stopLit = null, stopPin = null, extra = null;
for (let n = 1; n <= LIMIT + 1; n++) {
  if (n > LIMIT && stopPin !== null) break;
  if (n > LIMIT) break;
  const pg = await readPage(n); R.pages.push(pg); save();
  if (pg.status !== 'ok') { R.unreadablePage = n; break; }
  if (stopLit === null && pg.tickets.some((t) => oldSeen.has(t.addr))) stopLit = n;
  if (stopPin === null && pg.tickets.some((t) => !t.pinned && oldSeen.has(t.addr))) { stopPin = n; if (n < LIMIT) { extra = await readPage(n + 1); R.pages.push(extra); extra.isExtra = true; save(); } break; }
}
R.stopLit = stopLit; R.stopPin = stopPin;
R.status = R.unreadablePage ? 'unreadable' : stopPin === null ? 'too-many-new' : 'ok';

// ground truth over every page read (incl. the extra one), deduped by address
const byAddr = new Map(); const appearsOn = {};
for (const pg of R.pages) for (const t of pg.tickets ?? []) { (appearsOn[t.addr] ??= []).push(pg.n); if (!byAddr.has(t.addr)) byAddr.set(t.addr, t); }
R.dupAcrossPages = Object.entries(appearsOn).filter(([, v]) => v.length > 1).map(([a, v]) => ({ a, pages: v }));
const isNew = (t) => !oldSeen.has(t.addr) && t.date !== null && Math.floor(t.date / 60000) >= L1_MIN && !t.pinned;
const noDate = [...byAddr.values()].filter((t) => t.date === null).map((t) => t.addr);
R.noDate = noDate;
const truth = [...byAddr.values()].filter(isNew).sort((a, b) => num(a.addr) - num(b.addr));
R.border = truth.filter((t) => Math.floor(t.date / 60000) === L1_MIN).map((t) => t.addr);
R.truthNew = truth.map((t) => ({ a: t.addr, d: t.dateStr, page: appearsOn[t.addr] }));
R.totalNew = truth.length;
R.onPage1 = truth.filter((t) => appearsOn[t.addr].includes(1)).length;
R.N1_notOnPage1 = truth.filter((t) => !appearsOn[t.addr].includes(1)).length;

// queues
const queueFor = (stop) => { const seenAddrs = new Set(); const q = []; if (stop === null) return null;
  for (const pg of R.pages) { if (pg.isExtra || pg.n > stop) continue; for (const t of pg.tickets) if (!seenAddrs.has(t.addr) && !oldSeen.has(t.addr) && !t.pinned && t.date !== null && Math.floor(t.date / 60000) >= L1_MIN) { seenAddrs.add(t.addr); q.push(t); } }
  return q.sort((a, b) => num(a.addr) - num(b.addr)); };
const qPin = queueFor(stopPin), qLit = queueFor(stopLit);
R.queuePin = qPin?.map((t) => t.addr) ?? null; R.queueLit = qLit?.map((t) => t.addr) ?? null;
R.page1OnlyQueue = (queueFor(1) ?? []).map((t) => t.addr);

// checks
const C = {};
C.P1 = R.totalNew >= 26 && R.N1_notOnPage1 >= 1 ? 'PASS' : 'INCONCLUSIVE';
if (R.status === 'ok') {
  const truthSet = new Set(truth.map((t) => t.addr)), qSet = new Set(qPin.map((t) => t.addr));
  const missing = [...truthSet].filter((a) => !qSet.has(a)), bogus = [...qSet].filter((a) => !truthSet.has(a));
  const byDate = [...qPin].sort((a, b) => a.date - b.date || num(a.addr) - num(b.addr)).map((t) => t.addr);
  const orderOk = JSON.stringify(byDate) === JSON.stringify(qPin.map((t) => t.addr));
  const extraNew = extra ? (extra.tickets ?? []).filter(isNew).length : null;
  R.P2detail = { missing, bogus, orderOk, extraPageRead: extra?.n ?? null, extraPageNew: extraNew, queueLen: qPin.length };
  C.P2 = (missing.length || bogus.length || !orderOk || (extraNew ?? 0) > 0) ? 'FAIL' : (R.totalNew >= 26 ? 'PASS' : 'INCONCLUSIVE (flood absent; checks held)');
  C.P3 = stopPin !== null ? 'PASS' : 'FAIL';
} else if (R.status === 'too-many-new') { C.P2 = 'INCONCLUSIVE'; C.P3 = 'PASS (emitted too-many-new at limit)'; }
else { C.P2 = 'INCONCLUSIVE (unreadable page)'; C.P3 = 'INCONCLUSIVE (unreadable page)'; }
const allKept = R.pages.flatMap((p) => (p.tickets ?? []).map((t) => t.addr));
C.P4 = allKept.every((a) => /^https:\/\/github\.com\/flutter\/flutter\/issues\/\d+$/.test(a)) ? 'PASS' : 'FAIL';
C.P5 = K5hits.length === 0 ? 'PASS' : 'FAIL';
R.checks = C; R.endedAt = new Date().toISOString(); save(); clearTimeout(deadline);
console.log(JSON.stringify({ status: R.status, stopLit, stopPin, totalNew: R.totalNew, onPage1: R.onPage1, N1: R.N1_notOnPage1, queuePin: R.queuePin?.length, queueLit: R.queueLit?.length, dup: R.dupAcrossPages.length, C }, null, 1));
