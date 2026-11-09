// F164 replay (POC, NOT the product). $0: a FAKE provider, no network, no keys. Runs the real draft() of a given repo root on a saved prose + saved page,
// the page-map answer = the saved mapping (what the AI said then), the drafter answer = a hand-built Oct-style cited close on line 2.
// Writes the drafter's system prompt and prints whether the code accepts the close.
// usage: node replay.mjs <repoRoot> <draftDir (has prose.txt pages/flights.txt declaration.json)> <outPrefix> [mapdir=<draftDir whose page-look.json mapping is the map answer>] [price=<n>] [dest=1 adds the destination phrase fact]
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { pathToFileURL } from 'node:url';
const [root, dd, out] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { draft } = await imp('src/drafter.js');
const { fakeProvider, toolReply, textReply, RATES, MODEL } = await imp('test/drafter-fixture.mjs');
const rd = (f) => fs.readFileSync(path.join(dd, f), 'utf8');
const prose = rd('prose.txt');
const page = rd('pages/flights.txt');
const mapdir = (process.argv.find((a) => a.startsWith('mapdir=')) || '').slice(7) || dd;
const mapping = JSON.parse(fs.readFileSync(path.join(mapdir, 'page-look.json'), 'utf8')).pages[0].mapping;
const decl = JSON.parse(rd('declaration.json'));
const price = Number((process.argv.find((a) => a.startsWith('price=')) || 'price=150').slice(6));
const guard = /under \$40/.test(prose) ? 40 : price;
// the Oct-style close: origin phrase, price after "From" in US dollars, nonstop phrase, count 3 (copied from the signed flights-learn-3 / m10-walk-flights-5 shape)
const cited = { source: 'flights', facts: [
  { name: 'origin airport', shape: 'phrase', phrase: 'Leaves Adolfo Suárez Madrid-Barajas Airport' },
  { name: 'price', shape: 'money', unit: 'US dollars', currency: '$', anchor: 'From', rule: { op: 'lt', value: guard } },
  ...(process.argv.includes('dest=1') ? [{ name: 'destination airport', shape: 'phrase', phrase: 'arrives at Leonardo da Vinci International Airport' }] : []),
  { name: 'stops', shape: 'phrase', phrase: 'Nonstop' }], count: { min: 3, max: 3 } };
const steps = decl.steps.map((s) => (s.fromLine === 2 ? { ...s, reads: ['flights'], close: { class: 'green', cited } } : s));
const handDecl = { steps, guardrailClasses: { 2: 'green' }, unjudgeable: {}, refused: [], notChecked: ['x'] };
const prov = fakeProvider([{ ...textReply(JSON.stringify(mapping)), usage: { inputTokens: 1000, outputTokens: 200 } }, toolReply(handDecl)]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f164-'));
let r;
try {
  r = await draft({ proseText: prose, provider: prov, rates: RATES, modelId: MODEL, draftDir: path.join(tmp, 'd'), fetchPage: async (url) => ({ ok: true, text: page, url }), offerQuestions: false });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
const sysI = prov.calls.findIndex((c) => c.tools.includes('emit_declaration'));
const sys = sysI >= 0 ? prov.calls[sysI].messages[0].content : '(no drafting call)';
fs.writeFileSync(`${out}.system.txt`, sys);
const l2 = r.declaration?.steps?.find((s) => s.fromLine === 2);
const kept = (sys.match(/Kept, line[^\n]*/) || [''])[0];
console.log(JSON.stringify({ kept: kept.slice(0, 700), root: path.basename(root), ok: r.ok, stop: r.stop, calls: prov.calls.length, reds: r.reds, line2: l2 ? l2.close.class + (l2.close.cited ? '+cited' : '') : null, sysChars: sys.length }));
