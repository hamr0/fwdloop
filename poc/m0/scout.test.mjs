// Structure tests only — NO network. Every model round in this file goes
// through an injected fake provider (a plain object satisfying bare-agent's
// `Provider.generate(messages, tools, options)` interface), never a real
// OpenAIProvider. A live probe exists only behind `SCOUT_LIVE=1` in
// scout.mjs's own CLI block, never here and never in the default `npm test`
// path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { parseCsv } from './csv.mjs';
import { menu } from './catalogue.mjs';
import {
  SCOUT_MENU, SCOUT_ROUND_BOUND, SCOUT_MAX_TOKENS,
  lookFixtures, groundFacts, makeReportFactsTool, runScoutRound,
  classifyFacts, FACTS_CAUSES, scoutJob2,
} from './scout.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CSV_PATH = join(REPO_ROOT, 'fixtures', 'ar-aging.csv');
const TEXT_PATH = join(REPO_ROOT, 'fixtures', 'message.txt');

// ---------------------------------------------------------------------------
// Negative #5 — write/store primitives are ABSENT from the scout's menu, not
// merely refused. Mirrors catalogue.test.mjs's own negative #5, but asserts
// it at THE SCOUT'S OWN call site (SCOUT_MENU), which is the thing that could
// regress if scout.mjs ever swapped `menu({classes:['read']})` for `menu()`.
// ---------------------------------------------------------------------------

test('negative #5: SCOUT_MENU has no write-class or store-class verb — absence, not refusal', () => {
  const verbs = SCOUT_MENU.map((e) => e.verb);
  assert.ok(verbs.length > 0, 'sanity: the scout menu is not accidentally empty');
  assert.ok(!verbs.includes('write'));
  assert.ok(!verbs.includes('edit'));
  assert.ok(!verbs.includes('checkpoint'));
  assert.ok(!verbs.includes('stash'));
  assert.ok(!verbs.includes('remember'));
  assert.ok(!verbs.includes('forget'));
  for (const entry of SCOUT_MENU) assert.equal(entry.class, 'read');
});

test('PROOF the test can fail: an unfiltered catalogue menu DOES include write/store verbs (sanity on the fixture, not the code under test)', () => {
  const verbs = menu().map((e) => e.verb);
  assert.ok(verbs.includes('write'));
  assert.ok(verbs.includes('stash'));
});

// ---------------------------------------------------------------------------
// Round bound — fixed in code, not spec-authorable. Enforced by
// makeReportFactsTool's execute(), not merely documented.
// ---------------------------------------------------------------------------

test('SCOUT_ROUND_BOUND is 1 — one look, no revision', () => {
  assert.equal(SCOUT_ROUND_BOUND, 1);
});

test('the round bound actually binds: a second report_facts call throws', async () => {
  const { tool, getCallCount } = makeReportFactsTool();
  await tool.execute({ csvColumns: ['Customer'] });
  assert.equal(getCallCount(), 1);
  await assert.rejects(
    () => tool.execute({ csvColumns: ['Customer'] }),
    /scout round bound exceeded \(1\)/,
  );
});

// ---------------------------------------------------------------------------
// The mechanical look — $0, deterministic, the real fixtures.
// ---------------------------------------------------------------------------

test('lookFixtures reads the REAL fixtures — header and lines are not invented', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const realParsed = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  assert.deepEqual(csvArtifact.header, realParsed.header);
  assert.equal(csvArtifact.rows.length, realParsed.rows.length);
  const realLines = readFileSync(TEXT_PATH, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
  assert.deepEqual(textArtifact.lines, realLines);
});

// ---------------------------------------------------------------------------
// Grounding — the M0a exit criterion: a reported column name must exist in
// the fixture, never be invented. Pure function, independently checked
// against a fresh parse of the real fixture (not the same call path as the
// code under test).
// ---------------------------------------------------------------------------

test('groundFacts drops an invented column and flags it — never silently trusted', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  const rawFacts = { csvColumns: [...realHeader, 'TotallyInventedColumn'] };
  const facts = groundFacts(rawFacts, { csvArtifact, textArtifact });
  assert.deepEqual(facts.invented, ['TotallyInventedColumn']);
  assert.ok(!facts.csv.columns.includes('TotallyInventedColumn'));
  for (const col of facts.csv.columns) assert.ok(realHeader.includes(col), `"${col}" is not a real column`);
});

test('PROOF the test can fail: a real, unmodified column list passes through with nothing invented', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  const facts = groundFacts({ csvColumns: realHeader }, { csvArtifact, textArtifact });
  assert.deepEqual(facts.invented, []);
  assert.deepEqual(facts.csv.columns.sort(), [...realHeader].sort());
});

test('groundFacts falls back to the mechanical truth when the model reports nothing usable — never empty, never invented', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const facts = groundFacts({}, { csvArtifact, textArtifact });
  assert.deepEqual(facts.csv.columns, csvArtifact.header);
  assert.deepEqual(facts.invented, []);
  // F59: the fallback fills csv.columns in with the real header, but that must
  // never be read as "the scout completed" — `reported` says so explicitly.
  assert.equal(facts.reported, false, 'nothing usable was reported, so `reported` must be false even though columns is filled in');
});

// F59 continued: `reported` must be computed from the GROUNDED columns, not the raw ones — a
// survey whose every reported column is invented (never matches the real header at all) is not a
// genuine report, it is a hallucinated one, and must classify ABSENT/SURVEY_NOT_REPORTED so the
// drafter refuses at $0 instead of paying a round on facts nobody actually grounded.
test('F59: a survey whose every column is invented (nothing grounded) is NOT reported — classifies ABSENT/SURVEY_NOT_REPORTED', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const facts = groundFacts({ csvColumns: ['Client', 'Balance'] }, { csvArtifact, textArtifact });
  assert.deepEqual(facts.invented.sort(), ['Balance', 'Client']);
  assert.equal(facts.reported, false, 'an all-invented survey must not count as reported');
  assert.equal(classifyFacts(facts).state, 'ABSENT');
  assert.equal(classifyFacts(facts).cause, FACTS_CAUSES.SURVEY_NOT_REPORTED);
});

test('PROOF the test can fail: a genuine (even partial) report sets reported to true', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const facts = groundFacts({ csvColumns: [csvArtifact.header[0]] }, { csvArtifact, textArtifact });
  assert.equal(facts.reported, true);
});

// ---------------------------------------------------------------------------
// F11 regression guard — the output cap must actually bind, never theatre.
// Two levels: (a) the baseline slot's provider really does carry
// legacyMaxTokens (same assertion style as provider.test.mjs's own F11 test);
// (b) the scout's own fixed SCOUT_MAX_TOKENS constant is what actually
// reaches the request options — proven via a fake provider that records what
// it was called with, so a future call site that hardcodes a different
// number, or lets a caller override it, goes red.
// ---------------------------------------------------------------------------

test('F11: the deepseek slot the scout runs against carries legacyMaxTokens — provider.mjs is the one writer', async () => {
  const { makeProvider } = await import('./provider.mjs');
  const saved = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key-not-real';
  try {
    assert.equal(makeProvider('deepseek', { model: 'deepseek-flash' }).provider.legacyMaxTokens, true);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; else delete process.env.DEEPSEEK_API_KEY;
  }
});

// A well-behaved model calls the tool once, then finishes (no further tool
// calls) once it sees the tool result — exactly what drafter.mjs/runner.mjs's
// real rounds do in practice, and what makes ONE round the normal case. The
// fake mirrors that: `toolCallReply` is returned on the FIRST generate() call
// only; every call after that returns a plain finished stop with no tool
// calls, so a misbehaving model that tried to re-call would be visible as
// `calls.length > 1` rather than silently retried forever.
function fakeProvider(toolCallReply) {
  const calls = [];
  let n = 0;
  return {
    calls,
    generate: async (messages, tools, options) => {
      calls.push({ messages, tools, options });
      n += 1;
      if (n === 1) return toolCallReply;
      return {
        text: '', toolCalls: [], usage: { inputTokens: 5, outputTokens: 1 }, stopReason: 'stop', model: 'fake-model',
      };
    },
  };
}

test('the fixed SCOUT_MAX_TOKENS reaches the request options — no call site or caller can widen it', async () => {
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  const provider = fakeProvider({
    text: null,
    toolCalls: [{ id: 't1', name: 'report_facts', arguments: { csvColumns: realHeader } }],
    usage: { inputTokens: 50, outputTokens: 20 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  });
  const report = await runScoutRound('fake-model', {
    csvPath: CSV_PATH, textPath: TEXT_PATH, provider, rates: { in: 0, out: 0 },
  });
  // bare-agent's Loop always needs one further generate() call to close out cleanly after a
  // tool call (it feeds the tool result back for the model's finishing turn) — same mechanics
  // drafter.mjs/runner.mjs already run on. What's fixed in code is that `report_facts` itself
  // can succeed only ONCE (see "the round bound actually binds" above); every generate() call
  // this produces still carries the same capped maxTokens, asserted on all of them below.
  assert.ok(provider.calls.length >= 1 && provider.calls.length <= 2, `expected 1-2 provider calls, got ${provider.calls.length}`);
  for (const call of provider.calls) assert.equal(call.options.maxTokens, SCOUT_MAX_TOKENS);
  assert.equal(report.toolCalled, true);
  assert.deepEqual(report.facts.csv.columns.sort(), [...realHeader].sort());
});

// ---------------------------------------------------------------------------
// End-to-end (still no network): fake provider hands back an invented column
// alongside real ones — proves the whole pipeline (menu absence + round bound
// + grounding) works together, not just each piece in isolation.
// ---------------------------------------------------------------------------

test('runScoutRound end-to-end with a fake provider: an invented column never survives to the final facts', async () => {
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  const provider = fakeProvider({
    text: null,
    toolCalls: [{
      id: 't1', name: 'report_facts', arguments: { csvColumns: [...realHeader, 'MadeUpColumn'], customerMentioned: 'Northwind' },
    }],
    usage: { inputTokens: 60, outputTokens: 25 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  });
  const report = await runScoutRound('fake-model', {
    csvPath: CSV_PATH, textPath: TEXT_PATH, provider, rates: { in: 0, out: 0 },
  });
  assert.deepEqual(report.facts.invented, ['MadeUpColumn']);
  assert.ok(!report.facts.csv.columns.includes('MadeUpColumn'));
  assert.equal(report.facts.customerMentioned, 'Northwind');
});

test('PROOF the test can fail: no tool call at all leaves toolCalled false and facts still grounded in the mechanical truth', async () => {
  const provider = fakeProvider({
    text: 'I cannot help with that.',
    toolCalls: [],
    usage: { inputTokens: 30, outputTokens: 10 },
    stopReason: 'stop',
    model: 'fake-model',
  });
  const report = await runScoutRound('fake-model', {
    csvPath: CSV_PATH, textPath: TEXT_PATH, provider, rates: { in: 0, out: 0 },
  });
  assert.equal(report.toolCalled, false);
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  assert.deepEqual(report.facts.csv.columns, realHeader);
  // F59: a mechanically-filled-in columns list must never be read as a completed
  // survey — `reported` is false and classifyFacts must say ABSENT/SURVEY_NOT_REPORTED.
  assert.equal(report.facts.reported, false);
  assert.equal(classifyFacts(report.facts).state, 'ABSENT');
  assert.equal(classifyFacts(report.facts).cause, FACTS_CAUSES.SURVEY_NOT_REPORTED);
});

// ---------------------------------------------------------------------------
// Finding 6 (2026-09-12) — a `max_tokens` stop is a TRUNCATION, never the
// same fact as "the scout said nothing" (SURVEY_NOT_REPORTED). Both leave
// `toolCalled` false (report_facts was never reached), so `toolCalled`/
// `reported` alone cannot tell them apart — this is exactly the F4 misread,
// now mirrored at the scout's own call site (runner.mjs already handles it
// for the runner's model steps).
// ---------------------------------------------------------------------------

test('a max_tokens stop is TRUNCATED, never SURVEY_NOT_REPORTED', async () => {
  const provider = fakeProvider({
    text: '',
    toolCalls: [],
    usage: { inputTokens: 40, outputTokens: 2000 },
    stopReason: 'max_tokens',
    model: 'fake-model',
  });
  const report = await runScoutRound('fake-model', {
    csvPath: CSV_PATH, textPath: TEXT_PATH, provider, rates: { in: 0, out: 0 },
  });
  assert.equal(report.toolCalled, false);
  assert.equal(report.stopReason, 'max_tokens');
  assert.equal(report.facts.truncated, true);
  assert.equal(report.facts.outputTokens, 2000);
  const classified = classifyFacts(report.facts);
  assert.equal(classified.state, 'ABSENT');
  assert.equal(classified.cause, FACTS_CAUSES.TRUNCATED);
  assert.match(classified.reason, /truncated: 2000 tokens/);
});

test('PROOF the test can fail: the same no-tool-call shape with a CLEAN stop (not max_tokens) is SURVEY_NOT_REPORTED, not TRUNCATED', async () => {
  const provider = fakeProvider({
    text: 'I cannot help with that.',
    toolCalls: [],
    usage: { inputTokens: 40, outputTokens: 10 },
    stopReason: 'stop',
    model: 'fake-model',
  });
  const report = await runScoutRound('fake-model', {
    csvPath: CSV_PATH, textPath: TEXT_PATH, provider, rates: { in: 0, out: 0 },
  });
  assert.equal(report.facts.truncated, false);
  assert.equal(classifyFacts(report.facts).cause, FACTS_CAUSES.SURVEY_NOT_REPORTED);
  assert.notEqual(classifyFacts(report.facts).cause, FACTS_CAUSES.TRUNCATED);
});

// ---------------------------------------------------------------------------
// groundFacts's `csv.realColumns` — the FULL mechanical header, always,
// independent of whatever (possibly partial) subset the model reported. This
// is the field the drafter's column listing rule checks against, never
// `csv.columns` (which may legitimately be a subset — see the test above,
// where the model reported nothing and `columns` happens to equal the full
// header only because of the empty-report fallback, not because `columns`
// is always complete).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// scoutMenuText's `${e.desc}` field (added when mailproof's verbs were
// dropped from SCOUT_MENU) had no assertion anywhere — a typo or missing
// `desc` in a SCOUT_MENU entry would render "undefined" into the drafter/
// scout prompt text silently. Asserted via the fake provider's recorded
// system message, the same call path runScoutRound actually sends.
// ---------------------------------------------------------------------------

test("scoutMenuText renders each menu entry's desc into the system message", async () => {
  const realHeader = parseCsv(readFileSync(CSV_PATH, 'utf8')).header;
  const provider = fakeProvider({
    text: null,
    toolCalls: [{ id: 't1', name: 'report_facts', arguments: { csvColumns: realHeader } }],
    usage: { inputTokens: 50, outputTokens: 20 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  });
  await runScoutRound('fake-model', {
    csvPath: CSV_PATH, textPath: TEXT_PATH, provider, rates: { in: 0, out: 0 },
  });
  const readEntry = SCOUT_MENU.find((e) => e.verb === 'read');
  assert.ok(readEntry, 'sanity: the read-class menu has a "read" verb entry');
  const systemMessage = provider.calls[0].messages[0].content;
  assert.ok(
    systemMessage.includes(readEntry.desc),
    `system message should include the menu entry's desc ("${readEntry.desc}")`,
  );
});

test('groundFacts.csv.realColumns is the FULL real header even when the model reports only a partial subset', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const realHeader = csvArtifact.header;
  const partial = realHeader.slice(0, 2); // a genuine subset, not all of it
  const facts = groundFacts({ csvColumns: partial }, { csvArtifact, textArtifact });
  assert.deepEqual(facts.csv.columns, partial, 'columns stays the partial, grounded report');
  assert.deepEqual(facts.csv.realColumns, realHeader, 'realColumns is always the FULL mechanical header');
});

test('PROOF the test can fail: with a partial report, csv.columns and csv.realColumns are genuinely different arrays', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const realHeader = csvArtifact.header;
  const partial = realHeader.slice(0, 2);
  const facts = groundFacts({ csvColumns: partial }, { csvArtifact, textArtifact });
  assert.ok(facts.csv.columns.length < facts.csv.realColumns.length, 'columns must be the strictly smaller, partial list');
});

// ---------------------------------------------------------------------------
// classifyFacts — the M0a exit gap's ABSENT gate, checked before the
// drafter's model call ever runs. Every route to ABSENT is named (no unnamed
// "facts are falsy" catch-all), mirroring bareloop's classifySurvey in
// spirit, never in code (this module's facts object is a different, always-
// grounded shape, so the check is structural rather than a byte floor).
// ---------------------------------------------------------------------------

test('classifyFacts: no facts object at all is ABSENT, cause MISSING', () => {
  assert.deepEqual(classifyFacts(undefined).state, 'ABSENT');
  assert.equal(classifyFacts(undefined).cause, FACTS_CAUSES.MISSING);
  assert.equal(classifyFacts(null).cause, FACTS_CAUSES.MISSING);
});

test('classifyFacts: a non-object facts value is ABSENT, cause MALFORMED', () => {
  assert.equal(classifyFacts('a string').cause, FACTS_CAUSES.MALFORMED);
  assert.equal(classifyFacts(42).cause, FACTS_CAUSES.MALFORMED);
  assert.equal(classifyFacts(['an', 'array']).cause, FACTS_CAUSES.MALFORMED);
});

test('classifyFacts: an object whose mechanical read found no CSV header at all is ABSENT, cause NO_COLUMNS', () => {
  // `reported: true` isolates this from SURVEY_NOT_REPORTED — the model DID
  // report something, but the mechanical read itself found no header at all.
  const noHeader = {
    csv: {
      artifactId: 'x', sha256: 'y', rowCount: 0, columns: [], realColumns: [],
    },
    text: { artifactId: 'z', sha256: 'w', lineCount: 0, lines: [] },
    customerMentioned: null,
    notes: null,
    invented: [],
    reported: true,
  };
  assert.equal(classifyFacts(noHeader).cause, FACTS_CAUSES.NO_COLUMNS);
});

test('classifyFacts: a facts object whose survey never reported is ABSENT, cause SURVEY_NOT_REPORTED — the F59 gap', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  // groundFacts(null, ...) is EXACTLY "the model never called report_facts" —
  // the mechanical fallback still fills csv.columns in with the real header,
  // but that must never read as a completed survey.
  const facts = groundFacts(null, { csvArtifact, textArtifact });
  assert.equal(facts.reported, false, 'sanity: this really is the not-reported path');
  assert.deepEqual(facts.csv.columns, csvArtifact.header, 'sanity: the fallback DID fill columns in with the real header');
  assert.equal(classifyFacts(facts).state, 'ABSENT');
  assert.equal(classifyFacts(facts).cause, FACTS_CAUSES.SURVEY_NOT_REPORTED);
});

test('classifyFacts: a real, mechanically-grounded facts object with a genuine report is PRESENT, never ABSENT', () => {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  const facts = groundFacts({ csvColumns: csvArtifact.header }, { csvArtifact, textArtifact });
  assert.deepEqual(classifyFacts(facts), { state: 'PRESENT', cause: null, reason: null });
});

test('PROOF the classifyFacts tests can fail: a facts object with a genuinely non-empty csv.columns AND reported:true is not ABSENT', () => {
  const facts = {
    csv: {
      artifactId: 'x', sha256: 'y', rowCount: 1, columns: ['Customer'], realColumns: ['Customer'],
    },
    text: { artifactId: 'z', sha256: 'w', lineCount: 0, lines: [] },
    customerMentioned: null,
    notes: null,
    invented: [],
    reported: true,
  };
  assert.equal(classifyFacts(facts).state, 'PRESENT');
});

// ---------------------------------------------------------------------------
// JOB #2's LOOK (M0b Amendment B, Claim 2 evidence) — `scoutJob2`, $0,
// deterministic, over a resume .docx and a markdown JD instead of job #1's
// CSV/text fixtures. No model round (see scoutJob2's own header for why),
// so these tests need no fake provider at all — same "no network" discipline
// as the rest of this file, trivially satisfied.
//
// The zip-by-hand builder below mirrors job2.test.mjs's own `makeZip`/
// `makeDocxBuffer` (not imported from it — that file's own header explains
// why: never read hamr's real resume in a test file, and no test file
// imports another test file's helpers here either).
// ---------------------------------------------------------------------------

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function makeDocxBuffer(paragraphs) {
  const bodyXml = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${bodyXml}</w:body></w:document>`;
  const data = Buffer.from(xml, 'utf8');
  const name = 'word/document.xml';
  const nameBuf = Buffer.from(name, 'utf8');
  const compressed = deflateRawSync(data);
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const cdir = Buffer.alloc(46);
  cdir.writeUInt32LE(0x02014b50, 0);
  cdir.writeUInt16LE(20, 4);
  cdir.writeUInt16LE(20, 6);
  cdir.writeUInt16LE(8, 10);
  cdir.writeUInt32LE(crc, 16);
  cdir.writeUInt32LE(compressed.length, 20);
  cdir.writeUInt32LE(data.length, 24);
  cdir.writeUInt16LE(nameBuf.length, 28);
  cdir.writeUInt32LE(0, 42); // localOffset 0

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdir.length + nameBuf.length, 12);
  eocd.writeUInt32LE(local.length + nameBuf.length + compressed.length, 16);

  return Buffer.concat([local, nameBuf, compressed, cdir, nameBuf, eocd]);
}

function job2TmpFiles({ resumeParagraphs, jdText }) {
  const base = mkdtempSync(join(tmpdir(), 'm0-scout-job2-'));
  const resumePath = join(base, 'resume.docx');
  writeFileSync(resumePath, makeDocxBuffer(resumeParagraphs));
  const jdPath = join(base, 'jd.md');
  writeFileSync(jdPath, jdText);
  return { resumePath, jdPath };
}

test('scoutJob2: resume facts are {kind:"docx", paragraphs, words, firstLine} from readDocxText, never the body text itself', () => {
  const { resumePath, jdPath } = job2TmpFiles({
    resumeParagraphs: ['AMR HASSAN', 'Story of experience filler text here.'],
    jdText: '# Applied AI Architect\n\nBuild agents.\n',
  });
  const report = scoutJob2({ resumePath, jdPath });
  assert.equal(report.ok, true);
  assert.deepEqual(report.facts.resume, {
    kind: 'docx', paragraphs: 2, words: 8, firstLine: 'AMR HASSAN',
  });
  assert.ok(!('text' in report.facts.resume), 'the resume body text never travels forward to the drafter');
});

test('scoutJob2: JD facts are {kind:"markdown", words, headings[]}, headings read from real "#" lines', () => {
  const { resumePath, jdPath } = job2TmpFiles({
    resumeParagraphs: ['AMR HASSAN'],
    jdText: '# Applied AI Architect\n\nWe need agents.\n\n## Requirements\n\n5 years experience.\n',
  });
  const report = scoutJob2({ resumePath, jdPath });
  assert.equal(report.ok, true);
  assert.equal(report.facts.jd.kind, 'markdown');
  assert.deepEqual(report.facts.jd.headings, ['Applied AI Architect', 'Requirements']);
  assert.equal(report.facts.jd.words, 12);
});

test('scoutJob2: a corrupt/unreadable resume reds BY NAME (readDocx), never silently produces empty facts', () => {
  const base = mkdtempSync(join(tmpdir(), 'm0-scout-job2-bad-'));
  const resumePath = join(base, 'resume.docx');
  writeFileSync(resumePath, Buffer.from('not a zip at all'));
  const jdPath = join(base, 'jd.md');
  writeFileSync(jdPath, '# JD\n\nsome text\n');

  const report = scoutJob2({ resumePath, jdPath });
  assert.equal(report.ok, false);
  assert.match(report.red, /scout: resume \(readDocx\)/);
});

test('scoutJob2: an unreadable JD path reds BY NAME (read), distinct from the resume\'s own red', () => {
  const { resumePath } = job2TmpFiles({ resumeParagraphs: ['AMR HASSAN'], jdText: 'x' });
  const report = scoutJob2({ resumePath, jdPath: join(tmpdir(), 'does-not-exist-m0-scout-job2.md') });
  assert.equal(report.ok, false);
  assert.match(report.red, /scout: jd \(read\)/);
});

test('PROOF scoutJob2 can fail: a real resume + real jd passes; corrupting the resume alone reds it', () => {
  const { resumePath, jdPath } = job2TmpFiles({ resumeParagraphs: ['AMR HASSAN'], jdText: '# JD\n\ntext\n' });
  assert.equal(scoutJob2({ resumePath, jdPath }).ok, true);
  writeFileSync(resumePath, Buffer.from('corrupted'));
  assert.equal(scoutJob2({ resumePath, jdPath }).ok, false);
});
