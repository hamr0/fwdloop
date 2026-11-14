// F185 POC 2 (never ships). Same block as POC 1 (vendor/, bareloop v0.56.0), but the adapter gives it STEP LINES ONLY. Line kinds come from fwd's own src/. $0, no key, no network.
// Usage: node poc/f185-block/run2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSignedText } from '../../src/signed-text.js';
import { sheetLineBlocks, csvRolesOf } from '../../src/sheetblock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH = '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/3ce0f482-5c76-4fdf-a7f3-a80f5a98d7a7/scratchpad/bg035';
const vendorDir = path.join(SCRATCH, 'vendor');
fs.rmSync(vendorDir, { recursive: true, force: true });
fs.cpSync(path.join(here, 'vendor'), vendorDir, { recursive: true });
for (const dep of ['litectx', 'bare-agent']) {
  const lc = path.join(SCRATCH, 'node_modules', dep);
  if (!fs.existsSync(lc)) fs.symlinkSync(path.resolve(here, '../../node_modules', dep), lc);
}
const bgVersion = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'node_modules/bareguard/package.json'), 'utf8')).version;
console.log(`bareguard under test: ${bgVersion}`);

// ---- ADAPTER ----
// ADAPTER-START
/** fwd's own parser (src/signed-text.js parseSignedText) reads the prose: numbered lines, their `guardrail:`, ask marks, send lines, sources. */
function kindsOf(prose, declaration) {
  const p = parseSignedText(prose);
  if (!p.ok) throw new Error(`parseSignedText: ${p.reds.join(' | ')}`);
  const askLines = new Set(p.arbiter.asks.map((a) => a.line));
  const sendLines = new Set(p.arbiter.sends.map((s) => s.line));
  const csvRoles = csvRolesOf(p.arbiter);
  // fwd's own sheet path (src/sheetblock.js sheetLineBlocks) says which lines are sheet lines; it needs the signed declaration (none for an unsigned draft)
  const sheet = declaration ? sheetLineBlocks({ declaration, lines: p.lines.map((l) => ({ n: l.n, guardrail: l.guardrail })), csvRoles }) : [];
  const sheetLines = new Set(sheet.map((b) => b.line));
  return { lines: p.lines, askLines, sendLines, sheetLines, sheet, csvRoles };
}
/** step lines only, in the block's jobLines shape; guardrail split on '; ' */
function stepJobLines(k) {
  return k.lines.filter((l) => !k.askLines.has(l.n) && !k.sendLines.has(l.n) && !k.sheetLines.has(l.n))
    .map((l) => ({ n: l.n, text: l.text, rules: l.guardrail ? l.guardrail.split('; ').map((s) => s.trim()).filter(Boolean) : [] }));
}
const lookOf = (pl) => pl?.look ?? { facts: [], dropped: [] };
// ADAPTER-END
const al = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
const adapterSize = al.findIndex((l) => l.includes('ADAPTER-END')) - al.findIndex((l) => l.includes('ADAPTER-START')) - 1;

const { CheckBlock } = await import(pathToFileURL(path.join(vendorDir, 'checkblock.js')).href);
const { gradeStep, sha256Of } = await import(pathToFileURL(path.join(vendorDir, 'rubricstep.js')).href);

const rd = (p) => fs.readFileSync(path.join(here, 'fixtures', p), 'utf8');
const jobs = [
  { id: 'm14-walk-5', prose: rd('m14-walk-5/prose.txt'), texts: { notes: rd('m14-walk-5/notes.md') }, look: null, decl: null },
  { id: 'flights', prose: rd('flights/draft-prose.txt'), texts: { flights: rd('flights/flights.txt') }, look: JSON.parse(rd('flights/page-look.json')), decl: null },
  { id: 'csv', prose: rd('csv/prose.txt'), texts: { file: rd('csv/file.csv') }, look: null, decl: JSON.parse(rd('csv/signed-declaration.json')) },
];
const tag = (r) => ({ you: '[you]', agent: '[agent]', default: '[default]' }[r.by] ?? `[${r.by}]`);
const res = {};
for (const j of jobs) {
  console.log(`\n===== ${j.id}`);
  const k = kindsOf(j.prose, j.decl);
  console.log(`fwd kinds: ask=${[...k.askLines]} send=${[...k.sendLines]} sheet=${[...k.sheetLines]} step=${stepJobLines(k).map((l) => l.n)} csvRoles=${k.csvRoles}`);
  const jobLines = stepJobLines(k);
  console.log('jobLines to block:', JSON.stringify(jobLines));
  const block = new CheckBlock({ texts: j.texts, labels: Object.keys(j.texts), asks: true, split: true });
  block.fromJob(jobLines);
  const lk = lookOf(j.look);
  block.addLook(lk.facts, lk.dropped);
  let close = block.reconcile();
  console.log('--- rows (as built, before any answer)');
  const show = (b, c) => { for (const r of b.rows) { const pi = c.map.find((m) => m.rows.includes(r.key))?.part; console.log(`L${r.line} ${tag(r)} kind=${r.kind} ${r.state}${r.hidden ? ' HIDDEN' : ''} | ${r.text ?? r.name ?? ''} | words=${JSON.stringify(r.words ?? [])} | reason=${r.reason ?? ''}${pi === undefined ? '' : ` | part=${JSON.stringify(c.parts[pi]).slice(0, 300)}`}`); } };
  show(block, close);
  const open0 = block.open.map((q) => `${q.key} proposal=${JSON.stringify(q.proposal)}`);
  console.log(`open questions: ${open0.length}: ${open0.join(' ; ')}`);
  const before = block.rows.length;
  block.drive({ answer: (q) => (q.offers.agree ? { choice: 'agree' } : null) }); // SUPPLEMENT: the person's typed Agree, no AI
  close = block.reconcile();
  console.log(`--- rows after Agree (${before} -> ${block.rows.length})`);
  show(block, close);
  const orphan = block.rows.filter((r) => r.kind === 'rule' && r.parent !== undefined && r.part === null);
  const followNullPart = block.rows.filter((r) => r.parent && (r.part === null || r.part === undefined) && r.state === 'built');
  console.log(`follower rows with null part: ${followNullPart.length}${followNullPart.length ? ' -> ' + followNullPart.map((r) => `L${r.line} "${r.text}"`).join('; ') : ''}`);
  res[j.id] = { k, block, close, jobLines, followNullPart };
}

// ---- bars ----
const V = [];
const bar = (key, ok, why) => { V.push([key, ok]); console.log(`BAR ${key}: ${ok ? 'PASS' : 'FAIL'}  ${why}`); };
console.log('\n===== BARS');
// (a)+(b zero rows): rows on a non-step line
for (const j of jobs) {
  const r = res[j.id];
  const nonStep = new Set([...r.k.askLines, ...r.k.sendLines, ...r.k.sheetLines]);
  const bad = r.block.rows.filter((x) => nonStep.has(x.line));
  console.log(`${j.id}: rows on non-step lines (ask/send/sheet ${[...nonStep]}): ${bad.length}`);
  r.badRows = bad.length;
}
bar('a ask and send lines get zero block rows', jobs.every((j) => res[j.id].block.rows.filter((x) => res[j.id].k.askLines.has(x.line) || res[j.id].k.sendLines.has(x.line)).length === 0), jobs.map((j) => `${j.id}:${res[j.id].block.rows.filter((x) => res[j.id].k.askLines.has(x.line) || res[j.id].k.sendLines.has(x.line)).length}`).join(' '));
{
  const r = res.csv;
  const zero = r.block.rows.filter((x) => r.k.sheetLines.has(x.line)).length === 0 && r.k.sheetLines.size > 0;
  const checks = r.k.sheet.flatMap((b) => b.checked);
  console.log('fwd sheet path: sheetLineBlocks ->', JSON.stringify(r.k.sheet.map((b) => ({ line: b.line, guardrails: b.guardrails, checked: b.checked.map((c) => ({ id: c.id, name: c.name, words: c.words })), notChecked: b.notChecked }))));
  const has = checks.some((c) => /Amount/.test(c.words) && /gt|>|greater|over|more than|500/i.test(c.words) && /500/.test(c.words));
  bar('b csv sheet line: zero block rows AND fwd sheet path still yields the signed Amount > 500 check', zero && has, `sheet lines ${[...r.k.sheetLines]}; block rows on them ${r.block.rows.filter((x) => r.k.sheetLines.has(x.line)).length}; fwd check words: ${checks.map((c) => c.words).join(' ; ')}`);
}

// (c) m14-walk-5 real accepted output (run-5, outcome complete), graded by the block's own runner (gradeStep -> real bareguard 0.35.0 checkStep)
{
  const r = res['m14-walk-5'];
  const runDir = path.join(process.env.HOME, '.config/fwdloop/flows/m14-walk-5/runs/run-5');
  const hist = fs.readFileSync(path.join(runDir, '../../history.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  console.log(`\nrun-5 history outcome: ${hist.find((h) => h.runId === 'run-5')?.outcome}`);
  const notes = fs.readFileSync(path.join(runDir, 'inputs/notes.md'), 'utf8');
  console.log(`run-5 inputs/notes.md == fixture notes.md: ${notes === jobs[0].texts.notes}`);
  const artifactOf = { 1: 'garden_lines', 3: 'week_jobs', 5: 'neighbour_note' }; // from the run's declaration.json (fromLine -> emits)
  const decl = JSON.parse(fs.readFileSync(path.join(runDir, 'job/declaration.json'), 'utf8'));
  for (const [n, name] of Object.entries(artifactOf)) if (!decl.steps.some((s) => s.fromLine === Number(n) && s.emits === name)) console.log(`WARN artifact map mismatch for line ${n}`);
  const inputs = { notes }; const shas = { notes: sha256Of(notes) };
  let allPass = true; const lines = [];
  for (const [n, parts] of Object.entries(r.close.map.reduce((m, x) => { (m[x.line] ??= []).push(x); return m; }, {}))) {
    const bytes = fs.readFileSync(path.join(runDir, 'artifacts', `${artifactOf[n]}.json`), 'utf8');
    const stepParts = parts.map((x) => r.close.parts[x.part]);
    // all parts of the line together (as the run would), then each part alone so a red is named
    const together = await gradeStep({ params: { step: Number(n), parts: stepParts }, bytes, outputBytes: bytes, inputs, factQuotes: {}, factMissing: [] }, shas);
    console.log(`line ${n} (${artifactOf[n]}) all parts together: ${together.verdict} ${together.gapLines.join(' || ')} ${together.fault ?? ''}`);
    for (const x of parts) {
      const p = r.close.parts[x.part];
      const g = await gradeStep({ params: { step: Number(n), parts: [p] }, bytes, outputBytes: bytes, inputs, factQuotes: {}, factMissing: [] }, shas);
      const rowNames = x.rows.map((k) => { const row = r.block.rows.find((y) => y.key === k); return `${row.kind}${tag(row)}:${row.text ?? row.name ?? row.kind}`; });
      const l = `  L${n} part ${p.check ?? p.class} [${rowNames.join(', ')}] -> ${g.verdict}${g.gapLines.length ? ' : ' + g.gapLines.join(' || ') : ''}${g.fault ? ' fault ' + g.fault : ''}`;
      console.log(l); lines.push({ n, check: p.check ?? p.class, verdict: g.verdict, rows: rowNames });
    }
  }
  const nonCited = lines.filter((x) => x.check !== 'cited');
  const cited = lines.filter((x) => x.check === 'cited');
  const numb = lines.filter((x) => x.check === 'numbersFromFacts');
  console.log(`cited ($) rows: ${cited.map((x) => `L${x.n}=${x.verdict}`).join(' ') || 'none'}; numbers ($) rows: ${numb.map((x) => `L${x.n}=${x.verdict}`).join(' ') || 'none'}`);
  const falseRed = lines.filter((x) => x.verdict !== 'green');
  bar('c m14-walk-5: every built row passes on the real accepted output, no false red', falseRed.length === 0 && lines.length > 0, `parts graded ${lines.length}; non-green: ${falseRed.map((x) => `L${x.n} ${x.check} ${x.verdict}`).join(', ') || 'none'}; non-cited parts all green: ${nonCited.every((x) => x.verdict === 'green')}; cited verdicts: ${cited.map((x) => `L${x.n}=${x.verdict}`).join(' ')}`);
}

// (d) flights, POC 1 bar (c) on step lines only
{
  const f = res.flights;
  const page = f.block.texts.flights.toLowerCase();
  const bangs = f.block.rows.filter((r) => r.by === 'agent');
  const okBangs = bangs.every((r) => r.state === 'not-checked' || r.state === 'suggested' ? Boolean(r.reason) : (r.words ?? []).length > 0 && (r.words ?? []).every((w) => page.includes(String(w).toLowerCase())));
  bar('d1 every look `!` row is [agent] built-with-words-on-page or Not checked/Suggested with a reason', okBangs && bangs.length > 0, bangs.map((r) => `L${r.line} ${r.name}:${r.state}:${JSON.stringify(r.words)}`).join(' ; '));
  const rules = f.block.rows.filter((r) => r.kind === 'rule' && !r.parent);
  const rulesAll = f.block.rows.filter((r) => r.kind === 'rule');
  bar('d2 every ~ rule is a [you] row', rules.length === 4 && rulesAll.every((r) => r.by === 'you'), rulesAll.map((r) => `L${r.line} "${r.text}" ${r.by} ${r.state}`).join('; '));
}
console.log(`\nADAPTER: ${adapterSize} lines (kindsOf + stepJobLines + lookOf)`);
console.log(`OVERALL: ${V.every(([, ok]) => ok) ? 'PASS' : 'FAIL'}`);
