// M9 POC helpers, $0. Pure clock catch-up + poll-based file watcher with a sha ledger.
// Correct versions and deliberately wrong (naive) versions side by side.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const GRACE_MS = 120_000; // a slot seen later than this is a catch-up

export function parseSchedule(s) {
  let m;
  if ((m = /^daily (\d\d):(\d\d)$/.exec(s))) return { kind: 'daily', h: +m[1], mi: +m[2] };
  if ((m = /^weekdays (\d\d):(\d\d)$/.exec(s))) return { kind: 'weekdays', h: +m[1], mi: +m[2] };
  if ((m = /^weekly (sun|mon|tue|wed|thu|fri|sat) (\d\d):(\d\d)$/.exec(s))) return { kind: 'weekly', dow: DAYS.indexOf(m[1]), h: +m[2], mi: +m[3] };
  throw new Error(`bad schedule: ${s}`);
}

/** Slots (epoch ms, local time) in (lastMs, nowMs]. One slot per calendar day at most, so a
 *  DST change day can neither lose nor double a slot (a missing 02:30 shifts to 03:30). */
function slotsBetween(sc, lastMs, nowMs) {
  const out = [];
  const s = new Date(lastMs);
  for (let i = 0; ; i++) {
    const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
    if (d.getTime() > nowMs) break;
    const dow = d.getDay();
    const ok = sc.kind === 'daily' || (sc.kind === 'weekdays' && dow >= 1 && dow <= 5) || (sc.kind === 'weekly' && dow === sc.dow);
    if (!ok) continue;
    const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sc.h, sc.mi).getTime();
    if (slot > lastMs && slot <= nowMs) out.push(slot);
  }
  return out;
}

export function due(schedule, lastFiredISO, nowISO) {
  const slots = slotsBetween(parseSchedule(schedule), Date.parse(lastFiredISO), Date.parse(nowISO));
  if (!slots.length) return { fire: false, catchUp: false, missed: 0 };
  const latest = slots[slots.length - 1];
  const catchUp = slots.length > 1 || Date.parse(nowISO) - latest > GRACE_MS;
  return { fire: true, catchUp, missed: catchUp ? slots.length : 0, slot: new Date(latest).toISOString() };
}

/** NAIVE: one fire per missed slot. */
export function dueNaive(schedule, lastFiredISO, nowISO) {
  const slots = slotsBetween(parseSchedule(schedule), Date.parse(lastFiredISO), Date.parse(nowISO));
  if (!slots.length) return { fire: false, catchUp: false, missed: 0 };
  return { fire: true, catchUp: false, missed: 0, fires: slots.length, slot: new Date(slots[slots.length - 1]).toISOString() };
}

// ---- append-only JSONL (write-once records, never a mutable "latest" file) ----
export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
export function appendJsonl(file, rec) { fs.appendFileSync(file, JSON.stringify(rec) + '\n'); }

export function arm(file, slotISO) { appendJsonl(file, { kind: 'armed', slot: slotISO }); }

/** One clock tick: reads the ledger from disk every time (no process state). */
export function tick({ file, schedule, nowISO, naive = false }) {
  const recs = readJsonl(file);
  if (!recs.length) throw new Error('not armed');
  const last = new Date(Math.max(...recs.map((r) => Date.parse(r.slot)))).toISOString();
  const d = (naive ? dueNaive : due)(schedule, last, nowISO);
  if (d.fire) for (let i = 0; i < (d.fires ?? 1); i++) appendJsonl(file, { kind: 'fire', slot: d.slot, at: nowISO, catchUp: d.catchUp, missed: d.missed });
  return d;
}
export const fireCount = (file) => readJsonl(file).filter((r) => r.kind === 'fire').length;

// ---- file watcher: poll-based, stable-size gate, sha ledger ----
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** mode 'new' (every file in dir) or 'updated' (one file). poll() is synchronous so tests
 *  can drive it; start() wraps it in setInterval. Stability = size AND mtime unchanged for
 *  2 consecutive polls (mtime added so an in-place same-size rewrite is not missed). */
export function makeWatcher({ dir, ledger, mode, file, naive = false, onRun }) {
  const track = new Map();
  const seenNames = new Set(); const lastMtime = new Map(); // naive only: memory-only state
  const keyOf = (st) => `${st.size}:${st.mtimeMs}`;

  function take(p, t) {
    const buf = fs.readFileSync(p);
    const st2 = fs.statSync(p);
    if (t && keyOf(st2) !== t.key) return; // changed while reading: retry next poll
    const sha = sha256(buf);
    if (t) t.takenKey = t.key;
    if (!naive) {
      if (readJsonl(ledger).some((r) => r.sha === sha)) return; // this version already ran
      appendJsonl(ledger, { sha, name: path.basename(p), at: new Date().toISOString(), mode });
    }
    onRun({ path: p, sha, bytes: buf.length, at: Date.now() });
  }

  function poll() {
    const cands = mode === 'updated' ? [file] : fs.readdirSync(dir).map((n) => path.join(dir, n));
    for (const p of cands) {
      let st;
      try { st = fs.statSync(p); if (!st.isFile()) continue; } catch { continue; }
      if (naive) { // take on first sight; dedupe by name (new) / mtime (updated); memory only
        if (mode === 'new') { if (seenNames.has(path.basename(p))) continue; seenNames.add(path.basename(p)); }
        else { if (lastMtime.get(p) === st.mtimeMs) continue; lastMtime.set(p, st.mtimeMs); }
        take(p, null);
        continue;
      }
      const key = keyOf(st);
      let t = track.get(p);
      if (!t) { t = { key, same: 0, takenKey: null }; track.set(p, t); }
      else if (t.key !== key) { t.key = key; t.same = 0; }
      else t.same++;
      if (t.same >= 2 && t.takenKey !== key) take(p, t);
    }
  }
  let iv = null;
  return { poll, start(ms) { iv = setInterval(poll, ms); }, stop() { clearInterval(iv); } };
}
