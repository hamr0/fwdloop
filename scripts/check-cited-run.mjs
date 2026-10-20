#!/usr/bin/env node
// M10 piece 4: a SEPARATE checker of a run's cited results (docs/wiki/the-module-ladder.md "M10", Done when: "Its 3 results' quotes are on the run's own saved
// page, and their values pass the rules. A separate script checks this, not our own checker.").
//
// It shares no code with the check the run used: it imports nothing from src/ and nothing from bareguard, only Node's own modules. It re-reads two files of
// the run's folder and nothing else:
//   inputs.json + inputs/<file>   the run's own saved copy of the page or doc, and the sha256 recorded when it was frozen
//   cited-checks.json             the run's result record: per job line the quotes, the values, the signed facts and the count
// and checks, in its own words: the saved copy is still the bytes that were frozen (and the bytes the record names); every quote is word for word on it
// (white space and ** / __ marks aside); every value is the one its quote writes after the fact's label; every value passes its rule; the number of results
// is as signed; a line with no results to check is not ok. `--expect <file>` takes the facts and count from a file you wrote (JSON
// `{"<line n>": {"facts": [...], "count": {"min": 3, "max": 3}}}`) instead of the record's own, so the rules do not come from the writer.
//
// Usage: node scripts/check-cited-run.mjs <run folder> [--expect <file>]      Exit 0 = every line checks out, 1 = something is wrong, 2 = a file could not be read.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const runDir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--expect');
const expectAt = args.indexOf('--expect') >= 0 ? args[args.indexOf('--expect') + 1] : null;
const fail2 = (msg) => { console.error(`cannot check: ${msg}`); process.exit(2); };
if (!runDir) fail2('usage: check-cited-run.mjs <run folder> [--expect <file>]');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return fail2(`${p}: ${e.message}`); } };

const record = readJson(join(runDir, 'cited-checks.json'));
const manifest = readJson(join(runDir, 'inputs.json'));
const expected = expectAt ? readJson(expectAt) : null;
if (!record || !Array.isArray(record.lines)) fail2('cited-checks.json has no "lines"');
if (!Array.isArray(manifest)) fail2('inputs.json is not a list');

/** white space made one space, ** and __ marks dropped, trimmed: how a quote is laid against the page */
const flat = (t) => String(t).replace(/\*\*|__/g, '').replace(/[\s  ]+/g, ' ').trim();
const minutes = (h, m, ap) => {
  let hh = Number(h);
  if (ap) { const pm = /p/i.test(ap); hh = (hh % 12) + (pm ? 12 : 0); }
  return hh * 60 + Number(m);
};
const readTime = (t) => { const m = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(String(t)); return m ? minutes(m[1], m[2], m[3]) : null; };
const passes = (v, rule) => {
  if (!rule) return true;
  if (rule.op === 'between') return v >= rule.lo && v <= rule.hi;
  return { lt: v < rule.value, lte: v <= rule.value, gt: v > rule.value, gte: v >= rule.value }[rule.op] === true;
};
/** the rule's bounds in the units the value is read in: a number, or minutes for a time */
const bound = (fact, b) => (fact.shape === 'time' ? readTime(b) : Number(b));
const normRule = (fact) => {
  if (!fact.rule) return null;
  const r = fact.rule;
  return r.op === 'between' ? { op: r.op, lo: bound(fact, r.lo), hi: bound(fact, r.hi) } : { op: r.op, value: bound(fact, r.value) };
};

const problems = [];
const bad = (n, msg) => problems.push(`line ${n}: ${msg}`);

for (const line of record.lines) {
  const n = line.n;
  const want = expected ? expected[String(n)] : line.check;
  if (!want || !Array.isArray(want.facts)) { bad(n, 'no facts to check the results against'); continue; }
  // 1. the saved copy is the bytes that were frozen, and the bytes the record names
  const entry = manifest.find((e) => e && e.id === line.source);
  if (!entry) { bad(n, `this run froze no input named "${line.source}"`); continue; }
  let bytes;
  try { bytes = readFileSync(join(runDir, 'inputs', basename(entry.frozen)), 'utf8'); } catch (e) { fail2(`the saved copy of "${line.source}": ${e.message}`); }
  const sha = createHash('sha256').update(bytes, 'utf8').digest('hex');
  if (sha !== entry.sha256) bad(n, `the saved copy of "${line.source}" is not the bytes that were frozen`);
  if (line.check && line.check.sha256 !== sha) bad(n, `the record names a copy ("${line.check.sha256}") that is not this run's saved copy`);
  const page = flat(bytes);
  // 2. the results
  const rows = Array.isArray(line.rows) ? line.rows : [];
  if (!Array.isArray(line.rows)) bad(n, line.passed === true ? 'the record says passed but holds no results' : 'the record holds no results to check (the line did not pass)');
  rows.forEach((row) => {
    const at = `result ${row.n}`;
    const quote = flat(row.quote ?? '');
    if (quote === '' || !page.includes(quote)) { bad(n, `${at}: the quote is not on the saved page word for word`); return; }
    for (const fact of want.facts) {
      const who = `${at}, fact "${fact.name}"`;
      if (fact.shape === 'phrase') {
        if (!quote.toLowerCase().includes(flat(fact.phrase).toLowerCase())) bad(n, `${who}: the quote does not say "${fact.phrase}"`);
        continue;
      }
      const claimed = row.values ? row.values[fact.name] : undefined;
      if (claimed === undefined || claimed === '') { bad(n, `${who}: no value was recorded`); continue; }
      const anchor = fact.anchor ? flat(fact.anchor) : null;
      if (anchor === null) { bad(n, `${who}: the fact has no label to read the value after`); continue; }
      const hits = [];
      for (let i = quote.indexOf(anchor); i !== -1; i = quote.indexOf(anchor, i + 1)) hits.push(i);
      if (hits.length !== 1) { bad(n, `${who}: the label "${fact.anchor}" is in the quote ${hits.length} times, not once`); continue; }
      const after = quote.slice(hits[0] + anchor.length);
      if (fact.shape === 'text') {
        const stop = fact.until === undefined ? -1 : after.toLowerCase().indexOf(String(fact.until).toLowerCase());
        const field = (stop >= 0 ? after.slice(0, stop) : after).trim();
        if (field.toLowerCase() !== flat(claimed).toLowerCase()) bad(n, `${who}: the quote holds "${field}", the record says "${claimed}"`);
        continue;
      }
      let read;
      if (fact.shape === 'time') {
        const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(after);
        read = m ? minutes(m[1], m[2], m[3]) : null;
        if (read === null) { bad(n, `${who}: no time is written after "${fact.anchor}"`); continue; }
        if (readTime(claimed) !== read) { bad(n, `${who}: the quote holds a time that is not "${claimed}"`); continue; }
      } else {
        const m = /^\s*[$€£]?\s*(\d[\d,]*(?:\.\d+)?)/.exec(after);
        read = m ? Number(m[1].replace(/,/g, '')) : null;
        if (read === null) { bad(n, `${who}: no number is written after "${fact.anchor}"`); continue; }
        if (Number(String(claimed).replace(/[$€£,]/g, '')) !== read) { bad(n, `${who}: the quote holds ${read}, the record says ${claimed}`); continue; }
      }
      if (!passes(read, normRule(fact))) bad(n, `${who}: the value in the quote (${claimed}) does not pass its rule`);
    }
  });
  // 3. the count
  const c = want.count;
  if (c && c.min !== undefined && rows.length < c.min) bad(n, `${rows.length} result(s) are recorded, at least ${c.min} are required`);
  if (c && c.max !== undefined && rows.length > c.max) bad(n, `${rows.length} results are recorded, at most ${c.max} are allowed`);
}

if (problems.length === 0) {
  console.log(`ok: ${record.lines.length} line(s), ${record.lines.reduce((s, l) => s + (Array.isArray(l.rows) ? l.rows.length : 0), 0)} result(s) checked against the run's saved copy`);
  process.exit(0);
}
for (const p of problems) console.log(`WRONG ${p}`);
process.exit(1);
