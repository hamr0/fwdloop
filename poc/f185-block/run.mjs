// F185 POC 1 (never ships). Feeds bareloop v0.56.0's CheckBlock (vendor/, copied unchanged) fwd's REAL saved jobs. $0, no key, no network.
// Usage: node poc/f185-block/run.mjs [035|034]   035 = bareguard 0.35.0 from a scratch install (default), 034 = fwd's installed bareguard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] ?? '035';
const SCRATCH = '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/3ce0f482-5c76-4fdf-a7f3-a80f5a98d7a7/scratchpad/bg035';
let vendorDir = path.join(here, 'vendor');
if (mode === '035') {
  vendorDir = path.join(SCRATCH, 'vendor');
  fs.rmSync(vendorDir, { recursive: true, force: true });
  fs.cpSync(path.join(here, 'vendor'), vendorDir, { recursive: true });
  for (const dep of ['litectx', 'bare-agent']) { // the closure's other imports: scratch links to fwd's installed copies (bareguard stays the scratch 0.35.0)
    const lc = path.join(SCRATCH, 'node_modules', dep);
    if (!fs.existsSync(lc)) fs.symlinkSync(path.resolve(here, '../../node_modules', dep), lc);
  }
}
const bgVersion = JSON.parse(fs.readFileSync(mode === '035' ? path.join(SCRATCH, 'node_modules/bareguard/package.json') : path.resolve(here, '../../node_modules/bareguard/package.json'), 'utf8')).version;
console.log(`bareguard under test: ${bgVersion} (mode ${mode})`);

// ---- ADAPTER (the only fwd-specific code; counted by the markers) ----
// ADAPTER-START
/** fwd prose -> bareloop jobLines: `N. text` lines; a `guardrail: a; b` line under it is that line's `~` rules (the arbiter block is skipped). */
function jobLinesOf(prose) {
  const out = [];
  for (const raw of prose.split('\n')) {
    if (/^Arbiter guardrails/.test(raw)) break;
    const m = raw.match(/^(\d+)\.\s+(.*)$/);
    if (m) { out.push({ n: Number(m[1]), text: m[2], rules: [] }); continue; }
    const g = raw.match(/^\s+guardrail:\s*(.*)$/);
    if (g && out.length) out[out.length - 1].rules.push(...g[1].split('; ').map((s) => s.trim()).filter(Boolean));
  }
  return out;
}
/** fwd saved page-look.json -> {facts, dropped}: it already holds `look: {facts, dropped}` in the block's shape (line, forRule, reading). Nothing remapped. */
const lookOf = (pl) => pl?.look ?? { facts: [], dropped: [] };
// ADAPTER-END
const adapterLines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
const adapterSize = adapterLines.findIndex((l) => l.includes('ADAPTER-END')) - adapterLines.findIndex((l) => l.includes('ADAPTER-START')) - 1;

let CheckBlock;
try { ({ CheckBlock } = await import(pathToFileURL(path.join(vendorDir, 'checkblock.js')).href)); }
catch (e) { console.log(`IMPORT THROWS: ${e.constructor.name}: ${String(e.message).split('\n')[0]}`); process.exit(2); }

const rd = (p) => fs.readFileSync(path.join(here, 'fixtures', p), 'utf8');
const jobs = [
  { id: 'm14-walk-5', prose: rd('m14-walk-5/prose.txt'), texts: { notes: rd('m14-walk-5/notes.md') }, look: null },
  { id: 'flights (draft d-00mw9p09f3-9c72)', prose: rd('flights/draft-prose.txt'), texts: { flights: rd('flights/flights.txt') }, look: JSON.parse(rd('flights/page-look.json')) },
  { id: 'csv m10-walk-csv-4', prose: rd('csv/prose.txt'), texts: { file: rd('csv/file.csv') }, look: null },
];
const tag = (r) => ({ you: '[you]', agent: '[agent]', default: '[default]' }[r.by] ?? `[${r.by}]`);
const kindOf = (r) => ({ rule: '~', floor: '$', fact: '!', phrase: '!', count: '!', cited: '$', numbers: '$' }[r.kind] ?? '?');
const res = {};
for (const j of jobs) {
  console.log(`\n===== ${j.id}`);
  const jobLines = jobLinesOf(j.prose);
  console.log('jobLines:', JSON.stringify(jobLines));
  let block, close;
  for (const asks of [false, true]) {
    try {
      block = new CheckBlock({ texts: j.texts, labels: Object.keys(j.texts), asks, split: true });
      block.fromJob(jobLines);
      const lk = lookOf(j.look);
      block.addLook(lk.facts, lk.dropped);
      close = block.reconcile();
    } catch (e) { console.log(`THROW (asks=${asks}): ${e.stack.split('\n').slice(0, 3).join(' | ')}`); res[j.id] = { threw: true }; block = null; break; }
    if (!asks) {
      console.log('--- asks:false rows');
      for (const r of block.rows) {
        const part = r.part ? close.parts[close.map.find((m) => m.line === r.part.line && m.rows.includes(r.key))?.part] : null;
        console.log(`L${r.line} ${kindOf(r)} ${tag(r)} kind=${r.kind} ${r.state}${r.hidden ? ' HIDDEN' : ''} | ${r.text ?? r.name ?? ''} | words=${JSON.stringify(r.words ?? [])} | reason=${r.reason ?? ''}${r.lookWhy ? ` | lookWhy=${r.lookWhy}` : ''}${part ? ` | part=${JSON.stringify(part).slice(0, 400)}` : ''}`);
      }
      res[j.id] = { block, close };
    } else {
      // SUPPLEMENT (not a bar): the person's Agree on every proposed check, typed choices only, no AI. Shows what a click builds.
      const open0 = block.open.map((q) => `${q.key} proposal=${JSON.stringify(q.proposal)}`);
      block.drive({ answer: (q) => (q.offers.agree ? { choice: 'agree' } : null) });
      const c2 = block.reconcile();
      console.log(`--- asks:true: open questions before Agree: ${open0.length}: ${open0.join(' ; ')}`);
      for (const r of block.rows.filter((x) => x.kind === 'rule')) {
        const pi = c2.map.find((x) => x.rows.includes(r.key))?.part;
        console.log(`  after Agree: L${r.line} ~ "${r.text}" ${r.state} reason=${r.reason ?? ''} part=${pi === undefined ? '-' : JSON.stringify(c2.parts[pi]).slice(0, 300)}`);
      }
      continue;
    }
    if (false) console.log(`--- asks:true: open questions ${block.open.length}: ${JSON.stringify(block.open.map((q) => ({ key: q.key, ask: q.ask })))}`);
  }
}

// ---- bars ----
const V = [];
const bar = (k, ok, why) => { V.push([k, ok]); console.log(`BAR ${k}: ${ok ? 'PASS' : 'FAIL'}  ${why}`); };
console.log('\n===== BARS');
bar('a no throw', Object.values(res).every((x) => !x.threw) && Object.keys(res).length === 3, '');
const m = res['m14-walk-5'];
if (m?.block) {
  const rules = m.block.rows.filter((r) => r.kind === 'rule');
  bar('b1 every ~ rule is a [you] row', rules.length === 2 && rules.every((r) => r.by === 'you'), rules.map((r) => `L${r.line} "${r.text}" ${r.by} ${r.state}`).join('; '));
  const partOf = (r) => m.close.parts[m.close.map.find((x) => x.rows.includes(r.key))?.part];
  const r3 = rules.find((r) => /exactly 3 bullets/.test(r.text)), r80 = rules.find((r) => /under 80 words/.test(r.text));
  const p3 = r3 && partOf(r3), p80 = r80 && partOf(r80);
  console.log('exactly 3 bullets part:', JSON.stringify(p3), 'state', r3?.state, r3?.reason);
  console.log('under 80 words part:', JSON.stringify(p80), 'state', r80?.state, r80?.reason);
  bar('b2 exactly 3 bullets builds listItems 3', Boolean(p3) && /listItems/.test(JSON.stringify(p3)) && /\b3\b/.test(JSON.stringify(p3)) && r3.state === 'built', JSON.stringify(p3) ?? 'no part');
  const lim = p80 && JSON.stringify(p80).match(/\b(79|80)\b/);
  bar('b3 under 80 words builds a word limit naming 80 (79 or 80)', Boolean(lim) && r80.state === 'built', `limit named: ${lim?.[0] ?? 'none'}`);
} else bar('b', false, 'no block');
const f = res['flights (draft d-00mw9p09f3-9c72)'];
if (f?.block) {
  const page = f.block.texts.flights.toLowerCase();
  const bangs = f.block.rows.filter((r) => r.by === 'agent');
  const okBangs = bangs.every((r) => r.state === 'not-checked' ? Boolean(r.reason) : (r.words ?? []).length > 0 && (r.words ?? []).every((w) => page.includes(String(w).toLowerCase())));
  bar('c1 every look `!` row is [agent] built-with-words-on-page or Not checked with a reason', okBangs, bangs.map((r) => `${r.name}:${r.state}:${JSON.stringify(r.words)}`).join(' ; '));
  const rules = f.block.rows.filter((r) => r.kind === 'rule');
  bar('c2 every ~ rule is a [you] row', rules.length === 4 && rules.every((r) => r.by === 'you'), rules.map((r) => `"${r.text}" ${r.state}`).join('; '));
} else bar('c', false, 'no block');
const c = res['csv m10-walk-csv-4'];
if (c?.block) {
  const rr = c.block.rows.filter((r) => r.kind === 'rule');
  const built = rr.filter((r) => r.state === 'built');
  console.log('csv rows:', c.block.rows.map((r) => `${kindOf(r)}${tag(r)}${r.state}:${r.text ?? r.name}`).join(' ; '));
  console.log('csv: today signed sheet check = rows where Amount > 500 (rule cells, op rows). Block parts:', JSON.stringify(c.close.parts));
  bar('d csv checks not turned into rows differing from today\'s sheet check', c.close.parts.length === 0 && built.length === 0, `block built ${built.length} ~ checks, ${c.close.parts.length} parts; rule rows: ${rr.map((r) => r.state + ': ' + (r.reason ?? '')).join(' ; ')}`);
} else bar('d', false, 'no block');
const defaults = Object.values(res).flatMap((x) => x.block?.rows ?? []).filter((r) => r.by === 'default');
bar('e $ rows only [default] and only floor/cited/numbers', defaults.length > 0 && defaults.every((r) => ['floor', 'cited', 'numbers'].includes(r.kind)) && Object.values(res).flatMap((x) => x.block?.rows ?? []).filter((r) => kindOf(r) === '$').every((r) => r.by === 'default'), `default rows: ${defaults.map((r) => `L${r.line}:${r.kind}`).join(', ')}`);
console.log(`\nADAPTER: ${adapterSize} lines (jobLinesOf + lookOf)`);
console.log(`OVERALL: ${V.every(([, ok]) => ok) ? 'PASS' : 'FAIL'}`);
