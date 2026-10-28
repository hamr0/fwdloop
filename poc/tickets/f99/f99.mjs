// F99 run step: bareguard carriesAny (ruling #69) on F98's 32 real tickets. $0, NO model calls. Pre-registered in docs/logs/FINDINGS.md (F99).
// Run: BAREGUARD_F99_PATH=<scratch dir holding the extracted bareguard sha> timeout 300 node poc/tickets/f99/f99.mjs
// Refuses if the env var is unset. The real node_modules bareguard is NEVER imported here.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { here, KW, loadTickets, C1_NUMBERS, C5, C3_FIELDS, C6 } from './common.mjs';
import { refMatched } from './ref.mjs';

const dir = process.env.BAREGUARD_F99_PATH;
if (!dir) { console.error('REFUSED: BAREGUARD_F99_PATH is unset (scratch copy of the bareguard sha under test)'); process.exit(2); }
const root = resolve(dir);
if (!existsSync(join(root, 'package.json'))) { console.error('REFUSED: no package.json under ' + root); process.exit(2); }
if (root.includes('/node_modules/') || root.startsWith(resolve(here, '../../..') + '/node_modules')) { console.error('REFUSED: path is inside a node_modules'); process.exit(2); }
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const ex = pkg.exports?.['.']; const entry = (typeof ex === 'string' ? ex : ex?.import ?? ex?.default) ?? pkg.main ?? 'index.js';
const { createRubric, checkStep } = await import(pathToFileURL(join(root, entry)).href);

const R = { bareguard: { path: root, version: pkg.version }, checks: {} };
const expected = JSON.parse(readFileSync(join(here, 'out/expected.json'), 'utf8'));
const T = loadTickets();
const rub = (checks) => createRubric({ schema: 1, goal: 'ticket filter', checkpoints: { filter: { gating: true, checks } }, maxReds: 9999 });
const rAny = (field, phrases, strict) => rub([{ id: 'any', rule: 'carriesAny', field, phrases, ...(strict ? { strict: true } : {}) }]);
const rMust = (phrase) => rub([{ id: 'kw', rule: 'mustCarry', field: 'text', phrases: [phrase] }]);
const run = async (r, fields) => checkStep(r, 'filter', fields);
const isGreen = (res) => res.verdict !== 'red'; // same reading as F98
const gapsOf = (res) => res.gaps ?? res.full?.gaps ?? [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// run every ticket: forgiving + strict, ONE carriesAny check with the 12 signed phrases
const forg = rAny('text', KW, false), strictR = rAny('text', KW, true);
const per = {};
for (const t of T) {
  const f = await run(forg, { text: t.text }), s = await run(strictR, { text: t.text });
  per[t.id] = { number: t.issue.number ?? null, green: isGreen(f), gaps: gapsOf(f), matched: f.full?.matched, strictGreen: isGreen(s) };
}
// C1
const c1 = C1_NUMBERS.map((n) => { const id = T.find((t) => t.issue.number === n)?.id; return { number: n, id, green: id ? per[id].green : null }; });
R.checks.C1 = { verdict: c1.every((x) => x.id && x.green === false) ? 'PASS' : 'FAIL', per: c1 };
// C2
const c2bad = T.filter((t) => per[t.id].green !== (expected.per[t.id].forgiving === 'green')).map((t) => t.id);
R.checks.C2 = { verdict: c2bad.length === 0 ? 'PASS' : 'FAIL', agree: T.length - c2bad.length, of: T.length, disagree: c2bad };
// C3
const reds = T.filter((t) => !per[t.id].green);
const redBad = reds.filter((t) => { const g = per[t.id].gaps; return !(g.length === 1 && g[0].kind === 'none-found' && eq(g[0].phrases, KW)); }).map((t) => t.id);
const noBody = await run(rAny('body', KW, false), C3_FIELDS.noBody), numBody = await run(rAny('body', KW, false), C3_FIELDS.numberBody);
const kindOf = (res) => gapsOf(res).map((g) => g.kind);
R.checks.C3 = { verdict: redBad.length === 0 && reds.length === 16 && eq(kindOf(noBody), ['missing']) && eq(kindOf(numBody), ['wrong-type']) ? 'PASS' : 'FAIL',
  reds: reds.length, redBad, noBodyKinds: kindOf(noBody), numberBodyKinds: kindOf(numBody) };
// C4
const greens = T.filter((t) => per[t.id].green);
const c4bad = greens.filter((t) => { const m = per[t.id].matched; return !(Array.isArray(m) && m.length === 1 && eq(m[0].phrases, expected.per[t.id].found)); }).map((t) => t.id);
const redMatchedBad = reds.filter((t) => !(Array.isArray(per[t.id].matched) && per[t.id].matched.length === 0)).map((t) => t.id);
R.checks.C4 = { verdict: c4bad.length === 0 && redMatchedBad.length === 0 ? 'PASS' : 'FAIL', greens: greens.length, c4bad, redMatchedBad };
// C5
const c5 = []; for (const [label, text, phrase, strict, expect] of C5) { const got = isGreen(await run(rAny('text', [phrase], strict), { text })); c5.push({ label, got, expect, ref: refMatched(text, [phrase], strict).length > 0 }); }
const strictGreener = T.filter((t) => per[t.id].strictGreen && !per[t.id].green).map((t) => t.id);
R.checks.C5 = { verdict: c5.every((x) => x.got === x.expect) && strictGreener.length === 0 ? 'PASS' : 'FAIL', failed: c5.filter((x) => x.got !== x.expect), strictGreener, strictGreen: T.filter((t) => per[t.id].strictGreen).length };
// C6
const c6 = [];
try { rAny('text', ['crash'], false); c6.push({ label: 'control (valid)', ok: true }); } catch (e) { c6.push({ label: 'control (valid)', ok: false, threw: String(e.message) }); }
for (const [label, phrases, item] of C6) {
  let thrown = false, path = null;
  try { rAny('text', phrases, false); } catch (e) { thrown = true; path = e.path ?? null; }
  c6.push({ label, ok: thrown && typeof path === 'string' && path.includes(item ? 'phrases[' : 'phrases'), thrown, path });
}
R.checks.C6 = { verdict: c6.every((x) => x.ok) ? 'PASS' : 'FAIL', per: c6 };
// C7: mustCarry results (12 single-phrase checks per ticket) byte-identical to F98's recorded g3Hits
const f98 = JSON.parse(readFileSync(join(here, '../f98/out/results.json'), 'utf8')).perTicket; const c7bad = [];
for (const t of T) { const hits = []; for (const k of KW) if (isGreen(await run(rMust(k), { text: t.text }))) hits.push(k); if (JSON.stringify(hits) !== JSON.stringify(f98[t.id].g3Hits)) c7bad.push({ id: t.id, now: hits, f98: f98[t.id].g3Hits }); }
R.checks.C7 = { verdict: c7bad.length === 0 ? 'PASS' : 'FAIL', identical: T.length - c7bad.length, of: T.length, differ: c7bad };
R.perTicket = per;
writeFileSync(join(here, 'out/results.json'), JSON.stringify(R, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(R.checks).map(([k, v]) => [k, v.verdict]))));
