// F219 harness ($0, no AI, no key): M15 am3 report replay over five real saved runs (docs/logs/FINDINGS.md "F219 PRE-REGISTRATION"). Reads ~/.config/fwdloop/flows read-only
// (copies each run folder into a mkdtemp root); writes only into that root. Usage: node poc/f219-report/run.mjs [--json]
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { parseSignedText } from '../../src/signed-text.js';
import { readRunSheets } from '../../src/sheetrun.js';
import { parseCsv } from '../../src/csv.js';
import { serializeArtifact, sha256Hex } from '../../src/ask.js';
import { sendViaPrimitive } from '../../src/send.js';
import { renderBody, fileText, claimWordsOf } from './render.mjs';
import { sendReport, dayOf } from './send.mjs';
import { sheetTotalLines } from './sheettotal.mjs';

const FLOWS = join(homedir(), '.config', 'fwdloop', 'flows');
const RUNS = [
  { flow: 'm10b-expenses', run: 'run-3', kind: 'sheet+sum' },
  { flow: 'walk-m16-csv1', run: 'run-1', kind: 'sheet+count' },
  { flow: 'm10-walk-flights-5', run: 'run-3', kind: 'facts' },
  { flow: 'm14-walk-5', run: 'run-5', kind: 'text' },
  { flow: 'walk-m17-aging1-2', run: 'run-1', kind: 'sheet' },
];
const NOW = new Date(2026, 10, 18, 12, 0, 0); // 18 Nov 2026, the machine's local day
const work = mkdtempSync(join(tmpdir(), 'fwdloop-f219-'));
const results = [];
const bar = (id, run, pass, why) => { results.push({ id, run, pass, why }); };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** load one real run (copied), build the report lines the renderer takes */
function load({ flow, run }) {
  const src = join(FLOWS, flow, 'runs', run);
  const dir = join(work, flow, run);
  mkdirSync(join(work, flow), { recursive: true });
  cpSync(src, dir, { recursive: true });
  const prose = readFileSync(join(dir, 'job', 'prose.txt'), 'utf8');
  const parsed = parseSignedText(prose);
  const decl = readJson(join(dir, 'job', 'declaration.json'));
  const lc = existsSync(join(dir, 'line-checks.json')) ? readJson(join(dir, 'line-checks.json')) : null;
  const askLines = new Set(parsed.arbiter.asks.map((a) => a.line));
  const lastAsk = Math.max(...askLines);
  const allChecks = decl.steps.flatMap((s) => (Array.isArray(s.close?.sheet) ? s.close.sheet : []));
  const sheet = allChecks.length ? readRunSheets(dir, allChecks) : { ok: true, tables: {} };
  if (!sheet.ok) throw new Error(`${flow}: ${sheet.red}`);
  const lines = [];
  for (const s of decl.steps.filter((x) => x.fromLine < lastAsk)) {
    const jl = parsed.lines.find((l) => l.n === s.fromLine);
    if (askLines.has(s.fromLine)) { lines.push({ n: s.fromLine, kind: 'ask' }); continue; }
    const artifact = readJson(join(dir, 'artifacts', `${s.emits}.json`));
    const lcLine = lc?.sheet?.lines?.find((x) => x.n === s.fromLine);
    lines.push({
      n: s.fromLine, kind: 'work', text: jl.text.replace(/[,]$/, ''), rules: jl.guardrail ? jl.guardrail.split('; ').filter(Boolean) : [], artifact,
      checks: Array.isArray(s.close?.sheet) ? s.close.sheet : [], okIds: lcLine ? new Set(lcLine.results.filter((r) => r.ok).map((r) => r.id)) : null,
      proseChecked: s.close?.class === 'green' && typeof artifact.text === 'string',
    });
  }
  const runNo = Number(/^run-(\d+)$/.exec(run)?.[1] ?? NaN);
  const audit = readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const sentSha256 = audit.find((r) => r.sentSha256)?.sentSha256;
  return { flow, run, dir, lines, tables: sheet.tables, runNo: Number.isNaN(runNo) ? null : runNo, sentSha256, parsed };
}

const strip = (t) => t; // (no normalising anywhere: byte for byte)
const countOf = (hay, needle) => (needle === '' ? 0 : hay.split(needle).length - 1);

/** the expected skeleton, written BY HAND from each run's prose (not by the renderer): the structural lines of the file */
const NOCHK = '### The AI\'s answer (not checked — you judge it at Accept)';
const SKELETON = {
  'm10b-expenses': ['# m10b-expenses — run-3', 'Passed · 18 Nov 2026', '## 1. Read the expenses sheet', '## 2. List every expense over 500, with how many there are and their total', 'Rule: Amount over 500', '### Checked by code'],
  'walk-m16-csv1': ['# walk-m16-csv1 — run-1', 'Passed · 18 Nov 2026', '## 1. Read the expenses sheet', NOCHK, '## 2. list every expense over 500', 'Rule: Price over 500', 'Rule: use the column \'Amount\' for \'Price\'', '### Checked by code', 'Line 3: you accepted this at the Ask.', '## 4. and once I accept, write it out.', NOCHK],
  'm10-walk-flights-5': ['# m10-walk-flights-5 — run-3', 'Passed · 18 Nov 2026', '## 1. Read the flights page', NOCHK, '## 2. list 3 flights from Madrid to Rome', 'Rule: under $150', 'Rule: nonstop', '### Checked by code'],
  'm14-walk-5': ['# m14-walk-5 — run-5', 'Passed · 18 Nov 2026', '## 1. Write 3 lines about my garden from the notes', NOCHK, 'Line 2: you accepted this at the Ask.', '## 3. List 3 jobs for this week from the notes', 'Rule: exactly 3 bullets', NOCHK, 'Line 4: you accepted this at the Ask.', '## 5. Write a short closing note to my neighbour', 'Rule: under 80 words', NOCHK],
  'walk-m17-aging1-2': ['# walk-m17-aging1-2 — run-1', 'Passed · 18 Nov 2026', '## 1. Read the aging report', NOCHK, '## 2. For each invoice, work out the days past due as of 2026-10-11 and put it in its bucket: Current, 1-30, 31-60, 61-90, 90+', 'Rule: every invoice appears exactly once', 'Rule: each invoice is in one bucket', 'Rule: days past due = days since \'Due date\' as of 2026-10-11', '### Checked by code'],
};
const STRUCT = /^(# |Passed · |## \d+\. |Rule: |### |Line \d+: you accepted)/;
const skeletonOf = (file) => file.split('\n').filter((l) => STRUCT.test(l) && !l.startsWith('### The answer'));
/** the leaves the report must hold, from the ARTIFACT and the signed checks (not from the renderer): [{kind, text}] in artifact order */
function expectedLeaves(l) {
  const a = l.artifact;
  const out = [];
  if (typeof a.text === 'string' && a.text.trim()) out.push(a.text);
  if (Array.isArray(a.results)) for (const r of a.results) { out.push(...Object.values(r.values).map((v) => `: ${Array.isArray(v) ? v.join(', ') : v}\n`)); if (typeof r.quote === 'string') out.push(`from the page: "${r.quote}"`); }
  const words = claimWordsOf(l.checks, l.okIds);
  for (const [id, box] of Object.entries(a)) {
    if (!l.checks.length || !Object.hasOwn(words, id) || words[id] === null) continue;
    for (const [k, v] of Object.entries(box)) {
      if (k === 'days' || k === 'bands') out.push(...Object.entries(v).map(([row, x]) => `row ${row}: ${x}`));
      else out.push(Array.isArray(v) ? v.join(', ') : String(v));
    }
  }
  return out;
}
const orderedOnce = (file, leaves) => {
  let at = 0;
  for (const t of leaves) { const i = file.indexOf(t, at); if (i < 0) return `missing or out of order: ${JSON.stringify(t.slice(0, 60))}`; at = i + t.length; }
  return null;
};
const BAD_MARKS = /[✓✔✗✘☑✅❌]/u;
const jsonish = (f) => /[{}]/.test(f) || /^\s*[[\]]\s*$/m.test(f) || /"[A-Za-z_]+":/.test(f);
const centsOf = (cell) => Math.round(Number(String(cell).trim().replace(/,/g, '')) * 100);

// ───────────────────────── today's send, for the record (not a bar) ─────────────────────────
const TODAY = [];
{
  const dest = join(work, 'today-dest'); mkdirSync(dest);
  const content = { text: 'hello' };
  const sha = sha256Hex(serializeArtifact(content));
  const a = await sendViaPrimitive(`file:${dest}`, 'x.md', content, sha, {});
  const b = await sendViaPrimitive(`file:${dest}`, 'x.md', content, sha, {});
  TODAY.push(`sendViaPrimitive first write ok=${a.ok}; the same name again ok=${b.ok} (${b.red ? b.red.replace(dest, '<dest>') : ''})`);
}

// ───────────────────────── bars 1 to 5 over the five real runs, both total modes ─────────────────────────
const loaded = RUNS.map((r) => load(r));
const MODES = ['literal', 'samewhere'];
const files = {};
for (const L of loaded) for (const mode of MODES) {
  const body = renderBody({ lines: L.lines, tables: L.tables, mode });
  files[`${L.flow}/${mode}`] = { body, file: fileText(L.flow, L.runNo, NOW, body) };
}
for (const L of loaded) {
  const f = files[`${L.flow}/samewhere`].file;
  const got = skeletonOf(f);
  const want = SKELETON[L.flow];
  const same = JSON.stringify(got) === JSON.stringify(want);
  bar(1, L.flow, same, same ? 'skeleton equal' : `got ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`);
  const miss = L.lines.filter((l) => l.kind === 'work').map((l) => orderedOnce(f, expectedLeaves(l))).filter(Boolean)[0] ?? null;
  const dup = L.lines.filter((l) => l.kind === 'work' && typeof l.artifact.text === 'string' && l.artifact.text.trim()).filter((l) => countOf(f, l.artifact.text) !== 1).map((l) => `line ${l.n} text appears ${countOf(f, l.artifact.text)} times`)[0] ?? null;
  bar(2, L.flow, miss === null && dup === null, miss ?? dup ?? 'every leaf once, unchanged, in order');
  const artifactHasMarks = L.lines.some((l) => l.kind === 'work' && (BAD_MARKS.test(JSON.stringify(l.artifact)) || /[{}]/.test(String(l.artifact.text ?? ''))));
  bar(4, L.flow, !jsonish(f) && !BAD_MARKS.test(f), artifactHasMarks ? 'WARNING: the saved artifact itself carries braces or marks' : 'no JSON braces, no check marks');
}
{
  const L = loaded.find((x) => x.flow === 'm10-walk-flights-5');
  const f = files[`${L.flow}/samewhere`].file;
  const page = readFileSync(join(L.dir, 'inputs', 'flights.txt'), 'utf8');
  const quotes = L.lines.find((l) => l.n === 2).artifact.results.map((r) => r.quote);
  const bad = quotes.filter((q) => countOf(f, `from the page: "${q}"`) !== 1 || !page.includes(q));
  bar(3, L.flow, quotes.length === 3 && bad.length === 0, `${quotes.length} quotes; ${bad.length} not byte-exact in the file or not a substring of the frozen page`);
}
// bar 5
{
  const L = loaded.find((x) => x.flow === 'm10b-expenses');
  const l2 = L.lines.find((l) => l.n === 2);
  const table = L.tables.expenses;
  const col = table.header.indexOf('Amount');
  const named = l2.artifact.expenseRows.rows;
  const cents = named.map((n) => centsOf(table.rows.find((r) => r.rowNumber === n).cells[col])).reduce((a, b) => a + b, 0);
  const check = (file) => {
    const lines = file.split('\n');
    const ci = lines.findIndex((x) => /^- Count: /.test(x));
    const ti = lines.findIndex((x) => /^- Total: /.test(x));
    if (ci < 0 || ti < 0) return `no Count/Total bullets (Count at ${ci}, Total at ${ti})`;
    if (!(ci < ti)) return 'Total comes before Count';
    if (lines[ci] !== `- Count: ${named.length}`) return `Count line is ${JSON.stringify(lines[ci])}, want ${named.length}`;
    const got = Math.round(Number(lines[ti].slice('- Total: '.length).replace(/,/g, '')) * 100);
    return got === cents ? null : `Total ${lines[ti]} is not the by-hand sum ${cents / 100}`;
  };
  for (const mode of MODES) {
    const r = check(files[`${L.flow}/${mode}`].file);
    bar(5, `${L.flow} [${mode}]`, r === null, r ?? `Count ${named.length} then Total ${cents / 100}, equal to the by-hand sum`);
  }
  // the AI's own numbers are never written: set them to 99999 / 1 and the report must not change
  const mut = JSON.parse(JSON.stringify(l2.artifact));
  mut.expenseTotal.value = 99999; mut.expenseCount.value = 1;
  const lines2 = L.lines.map((l) => (l.n === 2 ? { ...l, artifact: mut } : l));
  const same = renderBody({ lines: lines2, tables: L.tables, mode: 'samewhere' }) === files[`${L.flow}/samewhere`].body;
  bar(5, `${L.flow} [AI numbers 99999/1 do not change the report]`, same, same ? 'byte-identical' : 'the AI number reached the report');
  const csv1 = files['walk-m16-csv1/samewhere'].file;
  const aging = files['walk-m17-aging1-2/samewhere'].file;
  bar(5, 'walk-m16-csv1 [samewhere]', /^- Count: 17$/m.test(csv1) && !/^- Total: /m.test(csv1), 'Count only, no Total');
  bar(5, 'walk-m17-aging1-2 [samewhere]', !/^- (Count|Total): /m.test(aging), 'neither Count nor Total');
  // bar 6: strict numbers on a copy of the frozen table, real run, both modes; and bareloop's own shared-box shape, literal
  const tryCell = (cell, mode) => {
    const t = JSON.parse(JSON.stringify(L.tables));
    t.expenses.rows.find((r) => r.rowNumber === named[0]).cells[col] = cell;
    return renderBody({ lines: L.lines, tables: t, mode }).split('\n').find((x) => x.startsWith('- Total: ')) ?? '(no Total line)';
  };
  for (const mode of MODES) {
    const bad = ['12,50', '1e3', '0x10'].map((c) => [c, tryCell(c, mode)]);
    const want = `- Total: not computed (row ${named[0]} has no number in the column "Amount")`;
    const ok = bad.every(([, t]) => t === want);
    const thousands = tryCell('1,200.50', mode);
    bar(6, `${L.flow} [${mode}]`, ok && /^- Total: [\d,]+\.\d\d$/.test(thousands), ok ? `12,50 / 1e3 / 0x10 not computed; 1,200.50 sums (${thousands})` : `got ${JSON.stringify(bad)}`);
  }
  const shared = (cells) => sheetTotalLines([{ rule: 'cells', op: 'sumIf', table: 't', column: 'Amount', claim: 'c' }], { c: { rows: cells.map((_, i) => i + 2) } }, { t: { header: ['Amount'], rows: cells.map((c, i) => ({ rowNumber: i + 2, cells: [c] })) } })[0];
  const sb = ['12,50', '1e3', '0x10'].every((c) => /not computed \(row 2 has no number in the column "Amount"\)/.test(shared([c]))) && shared(['1,234.50', ' 10 ']) === 'Total of rows 2, 3: 1,244.50 (computed by code from the rows named)';
  bar(6, 'bareloop shared-box shape [literal, synthetic table]', sb, sb ? 'strict test behaves as in bareloop\'s own test' : 'strict test differs');
  // order: sumIf before countIf in the signed list still writes Count first
  const swappedChecks = l2.checks.filter((c) => c.op !== 'countIf').concat(l2.checks.filter((c) => c.op === 'countIf'));
  const ordered = renderBody({ lines: L.lines.map((l) => (l.n === 2 ? { ...l, checks: swappedChecks } : l)), tables: L.tables, mode: 'samewhere' });
  const lines = ordered.split('\n');
  bar(6, `${L.flow} [sumIf listed before countIf]`, lines.findIndex((x) => x.startsWith('- Count: ')) < lines.findIndex((x) => x.startsWith('- Total: ')), 'Count first whatever the check order');
}

// ───────────────────────── bars 7 and 8: the send, on the m10b report ─────────────────────────
{
  const L = loaded.find((x) => x.flow === 'm10b-expenses');
  const { body } = files[`${L.flow}/samewhere`];
  const dest = join(work, 'dest'); mkdirSync(dest);
  const accepted = sha256Hex(serializeArtifact({ text: body }));
  const before = readdirSync(dest);
  bar(8, 'no file before the accept', before.length === 0, `Destination holds ${before.length} files before the send call`);
  const ctx = { runDir: L.dir };
  const o = { target: `file:${dest}`, job: L.flow, runNo: L.runNo, now: NOW, body, acceptedSha256: accepted, ctx };
  const tampered = await sendReport({ ...o, body: `${body}x` });
  bar(8, 'a body changed by one byte after accept', tampered.ok === false && readdirSync(dest).length === 0, tampered.ok ? 'WRITTEN' : `refused, nothing written (${tampered.red.slice(0, 60)}...)`);
  const none = await sendReport({ ...o, acceptedSha256: null });
  bar(8, 'no recorded hash', none.ok === false && readdirSync(dest).length === 0, none.ok ? 'WRITTEN' : 'refused, nothing written');
  const s1 = await sendReport(o);
  const day = dayOf(NOW);
  const firstHash = createHash('sha256').update(readFileSync(s1.path)).digest('hex');
  bar(8, 'sha256 of the file equals sentSha256', s1.ok && s1.sentSha256 === firstHash && s1.name === `${L.flow}-${day}.md`, s1.ok ? `name ${s1.name}; sentSha256 equals an independent hash of the bytes on disk: ${s1.sentSha256 === firstHash}` : s1.red);
  bar(8, 'the accepted hash is of the body, not the file', sha256Hex(serializeArtifact({ text: body })) === accepted && accepted !== s1.sentSha256, 'body hash differs from the file hash (title + Passed line are not bound)');
  const s2 = await sendReport(o);
  const s3 = await sendReport(o);
  const afterHash = createHash('sha256').update(readFileSync(s1.path)).digest('hex');
  const want2 = `saved under a new name because ${L.flow}-${day}.md was already taken`;
  bar(7, 'second and third send the same day', s2.name === `${L.flow}-${day}-2.md` && s3.name === `${L.flow}-${day}-3.md` && afterHash === firstHash && s2.note === want2 && s3.note === want2, `names ${s1.name}, ${s2.name}, ${s3.name}; first file unchanged: ${afterHash === firstHash}; note ${JSON.stringify(s2.note)}`);
  TODAY.push(`(ambiguity, for hamr: the -3 note names the BASE name taken; signed text says "<taken name>" without saying which)`);
  // pre-break e: a send that overwrites
  const dest2 = join(work, 'dest2'); mkdirSync(dest2);
  const f1 = await sendReport({ ...o, target: `file:${dest2}`, overwrite: true });
  const h1 = createHash('sha256').update(readFileSync(f1.path)).digest('hex');
  const f2 = await sendReport({ ...o, target: `file:${dest2}`, overwrite: true, now: NOW, body: body.replace('Read the expenses sheet', 'Read the expenses sheet') });
  // an overwriting send with a DIFFERENT report: the first file's bytes change
  const f3 = await sendReport({ ...o, target: `file:${dest2}`, overwrite: true, runNo: 99 });
  const h3 = createHash('sha256').update(readFileSync(f1.path)).digest('hex');
  bar('10e', 'a send that overwrites a taken name reads red on bar 7', h1 !== h3 && f3.name === f1.name, h1 !== h3 ? 'the taken file changed: bar 7 would be red' : 'NOT seen red');
  void f2;
}

// ───────────────────────── pre-breaks a, b, c, d ─────────────────────────
{
  const L = loaded.find((x) => x.flow === 'm10-walk-flights-5');
  const dropped = renderBody({ lines: L.lines, tables: L.tables, mode: 'samewhere', dropValue: true });
  const f = fileText(L.flow, L.runNo, NOW, dropped);
  const r = L.lines.filter((l) => l.kind === 'work').map((l) => orderedOnce(f, expectedLeaves(l))).filter(Boolean)[0] ?? null;
  bar('10a', 'drop one value: bar 2 red', r !== null, r ?? 'NOT seen red');
  const arts = JSON.parse(JSON.stringify(L.lines.find((l) => l.n === 2).artifact));
  const q = arts.results[0].quote;
  arts.results[0].quote = `${q.slice(0, 10)}X${q.slice(11)}`;
  const f2 = fileText(L.flow, L.runNo, NOW, renderBody({ lines: L.lines.map((l) => (l.n === 2 ? { ...l, artifact: arts } : l)), tables: L.tables, mode: 'samewhere' }));
  const page = readFileSync(join(L.dir, 'inputs', 'flights.txt'), 'utf8');
  bar('10c', 'one character of one quote changed: bar 3 red', !page.includes(arts.results[0].quote) && countOf(f2, `from the page: "${q}"`) === 0, 'the changed quote is not in the frozen page and the original is not in the file: bar 3 red');
  const m = loaded.find((x) => x.flow === 'm10b-expenses');
  const swapped = fileText(m.flow, m.runNo, NOW, renderBody({ lines: m.lines, tables: m.tables, mode: 'samewhere', swapOrder: true })).split('\n');
  bar('10b', 'Total before Count: bar 5 red', swapped.findIndex((x) => x.startsWith('- Total: ')) < swapped.findIndex((x) => x.startsWith('- Count: ')), 'Total sits before Count under the swapped writer: the order check reads red');
  bar('10d', 'JSON braces appended: bar 4 red', jsonish(`${files['m14-walk-5/samewhere'].file}\n{"a": 1}`), 'braces detected');
}

// ───────────────────────── report ─────────────────────────
console.log(`F219 work root: ${work}`);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  bar ${r.id}  ${r.run}\n   ${r.why}`);
console.log('--- today (src/send.js), for the record ---');
for (const t of TODAY) console.log(t);
console.log('--- the m10b report (samewhere) ---');
console.log(files['m10b-expenses/samewhere'].file);
console.log('--- the m10b body written by the literal copy ---');
console.log(files['m10b-expenses/literal'].file.split('\n').filter((l) => /Count|Total|## /.test(l)).join('\n'));
void strip; void existsSync;
