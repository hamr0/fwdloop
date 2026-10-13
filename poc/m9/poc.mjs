// M9 POC, $0: clock catch-up (item 3) + file-watch safety (item 6) of the signed M9 scope.
// Usage: node poc.mjs          -> real logic
//        node poc.mjs --naive  -> deliberately wrong logic; every `catches` check must FAIL
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { arm, readJsonl, makeWatcher, sha256 } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAIVE = process.argv.includes('--naive');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwdloop-m9poc-'));
const results = [];
// catches = this check exists to catch a naive deviation; it MUST fail in --naive mode
async function check(name, catches, fn) {
  try { await fn(); results.push({ name, catches, ok: true }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, catches, ok: false }); console.log(`FAIL ${name} -- ${e.message.split('\n')[0]}`); }
}
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

// ---------- A. clock catch-up (every tick in a fresh child, TZ=Europe/Berlin) ----------
function tickChild(file, schedule, now) {
  const r = spawnSync(process.execPath, [path.join(HERE, 'tick.mjs'), file, schedule, now, NAIVE ? 'naive' : ''], { env: { ...process.env, TZ: 'Europe/Berlin' }, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`tick child failed: ${r.stderr.slice(0, 200)}`);
  return JSON.parse(r.stdout);
}
const ledgerFile = (n) => path.join(root, `clock-${n}.jsonl`);
const dow = (iso) => new Date(iso).getUTCDay(); // sanity on fixture days
if (dow('2026-10-09T12:00:00Z') !== 5 || dow('2026-10-12T12:00:00Z') !== 1) throw new Error('fixture days wrong');

async function partA() {
  let f = ledgerFile('ontime'); arm(f, '2026-10-05T09:00:00+02:00');
  await check('A1 on-time slot (now == slot, tie) fires once, catchUp false', false, () => {
    const r = tickChild(f, 'daily 09:00', '2026-10-06T09:00:00+02:00');
    eq([r.d.fire, r.d.catchUp, r.d.missed, r.fires], [true, false, 0, 1], '[fire,catchUp,missed,fires]');
  });
  await check('A1b same slot, 30s later: no second fire', false, () => {
    const r = tickChild(f, 'daily 09:00', '2026-10-06T09:00:30+02:00');
    eq([r.d.fire, r.fires], [false, 1], '[fire,fires]');
  });

  f = ledgerFile('catchup'); arm(f, '2026-10-05T09:00:00+02:00');
  await check('A2 panel off across 3 missed slots -> exactly ONE fire, catchUp true, missed 3', true, () => {
    const r = tickChild(f, 'daily 09:00', '2026-10-08T09:30:00+02:00');
    eq([r.d.fire, r.d.catchUp, r.d.missed, r.fires], [true, true, 3, 1], '[fire,catchUp,missed,fire records]');
  });
  await check('A3 after the fire is recorded, same now -> no fire', false, () => {
    const r = tickChild(f, 'daily 09:00', '2026-10-08T09:30:00+02:00');
    eq([r.d.fire, r.fires], [false, 1], '[fire,fires]');
  });
  await check('A4 restart (fresh process, ledger reread from disk) -> still no fire; next slot fires on time', false, () => {
    const a = tickChild(f, 'daily 09:00', '2026-10-08T23:00:00+02:00');
    eq([a.d.fire, a.fires], [false, 1], 'after restart');
    const b = tickChild(f, 'daily 09:00', '2026-10-09T09:00:00+02:00');
    eq([b.d.fire, b.d.catchUp, b.fires], [true, false, 2], 'next slot');
  });

  f = ledgerFile('weekdays'); arm(f, '2026-10-09T09:00:00+02:00'); // Friday
  await check('A5 weekdays skips Sat/Sun, fires Monday 09:00 (tie) on time', false, () => {
    const sun = tickChild(f, 'weekdays 09:00', '2026-10-11T12:00:00+02:00');
    eq([sun.d.fire, sun.fires], [false, 0], 'weekend');
    const mon = tickChild(f, 'weekdays 09:00', '2026-10-12T09:00:00+02:00');
    eq([mon.d.fire, mon.d.catchUp, mon.d.missed, mon.fires], [true, false, 0, 1], 'monday');
  });
  f = ledgerFile('weekdays-off'); arm(f, '2026-10-09T09:00:00+02:00');
  await check('A5b weekdays, panel off all weekend + Monday morning -> one catch-up (missed 1)', false, () => {
    const r = tickChild(f, 'weekdays 09:00', '2026-10-12T12:00:00+02:00');
    eq([r.d.fire, r.d.catchUp, r.d.missed, r.fires], [true, true, 1, 1], 'late monday');
  });
  f = ledgerFile('weekly'); arm(f, '2026-10-05T09:00:00+02:00'); // Monday
  await check('A6 weekly mon 09:00: nothing mid-week, fires next Monday once', false, () => {
    const mid = tickChild(f, 'weekly mon 09:00', '2026-10-11T23:00:00+02:00');
    eq([mid.d.fire], [false], 'mid-week');
    const mon = tickChild(f, 'weekly mon 09:00', '2026-10-12T09:00:00+02:00');
    eq([mon.d.fire, mon.d.catchUp, mon.fires], [true, false, 1], 'monday');
  });

  f = ledgerFile('dst-spring'); arm(f, '2026-03-28T02:30:00+01:00');
  await check('A7 DST spring (Berlin 2026-03-29, 02:30 does not exist): daily 02:30 fires once that day', false, () => {
    const a = tickChild(f, 'daily 02:30', '2026-03-29T03:30:00+02:00');
    eq([a.d.fire, a.d.catchUp, a.fires], [true, false, 1], 'shifted slot at 03:30 CEST');
    for (const now of ['2026-03-29T12:00:00+02:00', '2026-03-29T23:59:00+02:00']) eq(tickChild(f, 'daily 02:30', now).fires, 1, `again ${now}`);
    eq(tickChild(f, 'daily 02:30', '2026-03-30T02:30:00+02:00').fires, 2, 'next day');
  });
  f = ledgerFile('dst-autumn'); arm(f, '2026-10-24T02:30:00+02:00');
  await check('A8 DST autumn (Berlin 2026-10-25, 02:30 happens twice): daily 02:30 fires once that day', false, () => {
    eq(tickChild(f, 'daily 02:30', '2026-10-25T02:30:00+02:00').fires, 1, 'first 02:30');
    for (const now of ['2026-10-25T02:30:00+01:00', '2026-10-25T12:00:00+01:00']) eq(tickChild(f, 'daily 02:30', now).fires, 1, `again ${now}`);
    eq(tickChild(f, 'daily 02:30', '2026-10-26T02:30:00+01:00').fires, 2, 'next day');
  });
}

// ---------- B. file still being written ----------
const POLL = 250, CHUNKS = 11, CHUNK_MS = 150;
let takeDelay = null; const watchInfo = {};
async function partB() {
  const dir = path.join(root, 'b-drop'); fs.mkdirSync(dir);
  const ledger = path.join(root, 'b-seen.jsonl');
  const takes = [];
  const w = makeWatcher({ dir, ledger, mode: 'new', naive: NAIVE, onRun: (r) => takes.push(r) });
  const events = []; let fw = null;
  try { fw = fs.watch(dir, (ev, name) => events.push({ ev, name })); } catch (e) { watchInfo.error = e.code; }
  const file = path.join(dir, 'big.csv');
  w.start(POLL);
  let lastWrite = null;
  const child = spawn(process.execPath, [path.join(HERE, 'writer.mjs'), file, String(CHUNKS), String(CHUNK_MS)]);
  child.stdout.on('data', (b) => { const m = /lastWrite (\d+)/.exec(String(b)); if (m) lastWrite = +m[1]; });
  await new Promise((res) => child.on('exit', res));
  const deadline = Date.now() + 4000;
  while (!takes.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 1000)); // would a second take appear?
  w.stop(); fw?.close();
  const finalSha = sha256(fs.readFileSync(file));
  watchInfo.events = events.filter((e) => e.name === 'big.csv');
  if (takes.length && lastWrite) takeDelay = takes[0].at - lastWrite;
  await check('B1 file is taken exactly once', false, () => eq(takes.length, 1, 'takes'));
  await check('B2 not taken before the last write (size stable first)', true, () => {
    if (!takes.length || !lastWrite) throw new Error('no take / no lastWrite');
    if (takes[0].at < lastWrite) throw new Error(`taken ${lastWrite - takes[0].at}ms BEFORE the last write`);
  });
  await check('B3 sha taken == sha of the final file (and full size)', true, () => {
    if (!takes.length) throw new Error('no take');
    eq(takes[0].bytes, CHUNKS * 4096, 'bytes taken');
    eq(takes[0].sha, finalSha, 'sha');
  });
  await check('B4 delay between last write and take is >= 2 polls minus one poll of phase, < 4 polls', false, () => {
    if (takeDelay === null) throw new Error('no delay');
    if (takeDelay < POLL || takeDelay > 4 * POLL) throw new Error(`delay ${takeDelay}ms`);
  });
  // fs.watch reliability probe (informational; the watcher above does not depend on it)
  const bd = path.join(root, 'b-burst'); fs.mkdirSync(bd);
  const names = new Set(); let bw = null;
  try { bw = fs.watch(bd, (ev, n) => n && names.add(n)); } catch (e) { watchInfo.error = e.code; }
  for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(bd, `f${i}`), 'x');
  fs.writeFileSync(path.join(bd, 'tmp'), 'y'); fs.renameSync(path.join(bd, 'tmp'), path.join(bd, 'renamed'));
  await new Promise((r) => setTimeout(r, 300)); bw?.close();
  watchInfo.burstSeen = [...names].filter((n) => /^f\d+$/.test(n)).length;
  watchInfo.sawRenameTarget = names.has('renamed');
}

// ---------- C. never twice ----------
const pollN = (w, n = 3) => { for (let i = 0; i < n; i++) w.poll(); };
async function partC() {
  const dir = path.join(root, 'c-inbox'); fs.mkdirSync(dir);
  const ledger = path.join(root, 'c-seen.jsonl');
  const runs = [];
  const mk = () => makeWatcher({ dir, ledger, mode: 'new', naive: NAIVE, onRun: (r) => runs.push(path.basename(r.path)) });
  let w = mk();
  const X = path.join(dir, 'X.csv');
  fs.writeFileSync(X, 'invoice,100\n');
  pollN(w, 6);
  await check('C1 new-file: drop X -> one run (and polling again does not re-run it)', false, () => eq(runs, ['X.csv'], 'runs'));
  let n0 = runs.length;
  fs.writeFileSync(path.join(dir, 'X-copy.csv'), 'invoice,100\n');
  pollN(w, 4);
  await check('C2 identical content under another name -> no run (sha already ran)', true, () => eq(runs.length - n0, 0, 'extra runs'));
  n0 = runs.length;
  w = mk(); // restart: fresh state, ledger reread from disk
  pollN(w, 4);
  fs.unlinkSync(X); fs.writeFileSync(X, 'invoice,100\n'); // re-drop X
  pollN(w, 4);
  await check('C3 after restart (fresh state), existing files + re-dropped X -> no run', true, () => eq(runs.length - n0, 0, 'extra runs'));
  n0 = runs.length;
  fs.writeFileSync(path.join(dir, 'Y.csv'), 'invoice,200\n');
  pollN(w, 4);
  await check('C4 a different file -> exactly one run', false, () => eq(runs.slice(n0), ['Y.csv'], 'new runs'));

  // file-updated mode
  const uf = path.join(root, 'c-updated.csv');
  const uledger = path.join(root, 'c-updated-seen.jsonl');
  const uruns = [];
  const uw = makeWatcher({ ledger: uledger, mode: 'updated', file: uf, naive: NAIVE, onRun: (r) => uruns.push(r.sha.slice(0, 6)) });
  const sh = (s) => sha256(Buffer.from(s)).slice(0, 6);
  fs.writeFileSync(uf, 'v1\n'); pollN(uw, 4);
  fs.writeFileSync(uf, 'version two\n'); pollN(uw, 4);
  await check('C5 file-updated: content change -> one run per new content', false, () => eq(uruns, [sh('v1\n'), sh('version two\n')], 'runs'));
  let u0 = uruns.length;
  const later = new Date(Date.now() + 60000); fs.utimesSync(uf, later, later); // touch, same content
  pollN(uw, 4);
  await check('C6 touch (mtime changes, sha same) -> no run', true, () => eq(uruns.length - u0, 0, 'extra runs'));
  u0 = uruns.length;
  fs.writeFileSync(uf, 'v1\n'); pollN(uw, 4); // back to earlier content
  await check('C7 change back to an earlier content whose sha already ran -> no run', true, () => eq(uruns.length - u0, 0, 'extra runs'));
  u0 = uruns.length;
  fs.writeFileSync(uf, 'v3 new\n'); pollN(uw, 4);
  await check('C8 genuinely new content afterwards -> one run', false, () => eq(uruns.length - u0, 1, 'new runs'));
  // ledger is append-only jsonl keyed by sha
  await check('C9 ledger holds one record per distinct sha (write-once)', false, () => {
    const shas = readJsonl(ledger).map((r) => r.sha);
    eq(shas.length, new Set(shas).size, 'duplicate sha records');
  });
}

try {
  console.log(`# M9 POC mode: ${NAIVE ? 'NAIVE (expect FAILs on checks marked catches)' : 'REAL'}  tmp=${root}`);
  await partA(); await partB(); await partC();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
const fails = results.filter((r) => !r.ok);
console.log(`\nmeasured: take delay after last write = ${takeDelay === null ? 'n/a' : takeDelay + ' ms'} (poll ${POLL} ms, writer ${CHUNKS} chunks every ${CHUNK_MS} ms)`);
console.log(`fs.watch: ${watchInfo.error ? 'COULD NOT START: ' + watchInfo.error + ' (inotify instances exhausted on this machine; the poll watcher above was unaffected). ' : ''}${watchInfo.events?.length ?? '?'} events for ${CHUNKS} appends to one file (${[...new Set((watchInfo.events || []).map((e) => e.ev))].join('/')}); burst of 50 files: saw ${watchInfo.burstSeen}/50 names; atomic rename target seen: ${watchInfo.sawRenameTarget}`);
console.log(`tmp removed: ${!fs.existsSync(root)}`);
let broken = 0;
if (NAIVE) {
  for (const r of results.filter((x) => x.catches && x.ok)) { broken++; console.log(`BROKEN-CHECK ${r.name} passed in naive mode`); }
  console.log(`naive: ${results.filter((x) => x.catches && !x.ok).length}/${results.filter((x) => x.catches).length} catching checks failed as they must; ${broken} broken`);
}
console.log(`${results.length - fails.length} PASS, ${fails.length} FAIL`);
process.exit(fails.length || broken ? 1 : 0);
