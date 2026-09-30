// M6a piece 2: mechanical input facts (md + docx headings), $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { readInputFacts } from '../src/input-facts.js';
import { readDocxHeadings } from '../src/docx.js';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';
import { wiredMenu } from '../src/primitives.js';

function crc32(buf) {
  let crc = ~0;
  for (const b of buf) { crc ^= b; for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (~crc) >>> 0;
}

/** A one-entry zip holding word/document.xml. Test-only. */
function makeDocx(bodyXml) {
  const data = Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${bodyXml}</w:body></w:document>`);
  const comp = deflateRawSync(data);
  const name = Buffer.from('word/document.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const cdir = Buffer.alloc(46);
  cdir.writeUInt32LE(0x02014b50, 0); cdir.writeUInt16LE(20, 4); cdir.writeUInt16LE(20, 6); cdir.writeUInt16LE(8, 10);
  cdir.writeUInt32LE(crc32(data), 16); cdir.writeUInt32LE(comp.length, 20); cdir.writeUInt32LE(data.length, 24);
  cdir.writeUInt16LE(name.length, 28); cdir.writeUInt32LE(0, 42);
  const cdirOffset = local.length + name.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdir.length + name.length, 12); eocd.writeUInt32LE(cdirOffset, 16);
  return Buffer.concat([local, name, comp, cdir, name, eocd]);
}

const P = (style, text) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

function tmp() { return mkdtempSync(path.join(tmpdir(), 'fwdloop-if-')); }

test('readDocxHeadings: Title and Heading1..n only, body paragraphs excluded, entities decoded', () => {
  const dir = tmp();
  const f = path.join(dir, 'a.docx');
  writeFileSync(f, makeDocx(
    P('Title', 'Jo Doe') + P('Heading1', 'Experience') + P(null, 'Body text, not a heading')
    + P('Heading2', 'R&amp;D lead') + P('Normal', 'more body') + P('Heading1', '   '),
  ));
  const r = readDocxHeadings(f);
  assert.equal(r.ok, true, r.ok ? '' : r.red);
  assert.deepEqual(r.headings, ['Jo Doe', 'Experience', 'R&D lead']);
});

test('readDocxHeadings: a non-zip is a named red, not a throw', () => {
  const f = path.join(tmp(), 'bad.docx');
  writeFileSync(f, 'not a zip');
  const r = readDocxHeadings(f);
  assert.equal(r.ok, false);
  assert.match(r.red, /End Of Central Directory/);
});

test('readInputFacts: md headings and docx headings by role; info mentions the read verb', () => {
  const dir = tmp();
  const md = path.join(dir, 'jd.md');
  const dx = path.join(dir, 'resume.docx');
  writeFileSync(md, '# About the role\n\nBuild.\n\n## Responsibilities\nShip.\nnot # a heading\n');
  writeFileSync(dx, makeDocx(P('Heading1', 'Skills') + P(null, 'Go, JS')));
  const r = readInputFacts([{ kind: 'file', role: 'jd', path: md }, { kind: 'file', role: 'resume', path: dx }]);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.deepEqual(r.inputFacts, { jd: ['About the role', 'Responsibilities'], resume: ['Skills'] });
  assert.ok(r.info.some((l) => l.includes('resume') && l.includes('readDocx') && l.includes('Skills')));
  assert.ok(r.info.some((l) => l.includes('jd') && l.includes('"read"')));
});

test('readInputFacts: md headings at every depth h1-h6 are picked, not only h1-h2', () => {
  const md = path.join(tmp(), 'deep.md');
  writeFileSync(md, '# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n####### seven is not a heading\n');
  const r = readInputFacts([{ kind: 'file', role: 'jd', path: md }]);
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.deepEqual(r.inputFacts, { jd: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'] });
});

test('readInputFacts: missing, empty and corrupt sources are named reds; non-file sources skipped', () => {
  const dir = tmp();
  const empty = path.join(dir, 'e.md');
  writeFileSync(empty, '  \n');
  const r = readInputFacts([
    { kind: 'file', role: 'gone', path: path.join(dir, 'nope.md') },
    { kind: 'file', role: 'empty', path: empty },
    { kind: 'file', role: 'zip', path: (() => { const f = path.join(dir, 'z.docx'); writeFileSync(f, 'xx'); return f; })() },
    { kind: 'url', role: 'web', path: 'http://x' },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.reds.length, 3);
  assert.ok(r.reds.some((x) => x.includes('"gone"') && x.includes('cannot read')));
  assert.ok(r.reds.some((x) => x.includes('"empty"') && x.includes('empty')));
  assert.ok(r.reds.some((x) => x.includes('"zip"')));
  assert.deepEqual(r.inputFacts, {});
});

test('the validator accepts the reader\'s output as declaration.inputFacts (docx headings)', () => {
  const dir = tmp();
  const dx = path.join(dir, 'resume.docx');
  writeFileSync(dx, makeDocx(P('Heading1', 'Skills')));
  const signed = parseSignedText([
    '1. Read the resume.', '   guardrail: check it', '',
    'Arbiter guardrails (belong to no line; human-signed, tighten-only):',
    'guardrail: cap $0.25 per run', `guardrail: source resume = file:${dx}`,
  ].join('\n'));
  assert.equal(signed.ok, true, signed.ok ? '' : signed.reds.join('\n'));
  const facts = readInputFacts(signed.arbiter.sources);
  const decl = {
    guardrailClasses: { 1: 'green' }, unjudgeable: {}, refused: [], inputFacts: facts.inputFacts,
    steps: [{
      goal: 'Read', primitives: ['readDocx'], reads: [], emits: 'r', fromLine: 1, close: { class: 'green' }, picks: { resume: ['Skills'] },
    }],
  };
  const v = validateDeclaration(decl, {
    arbiter: signed.arbiter, lines: signed.lines, catalogue: wiredMenu(),
  });
  assert.equal(v.ok, true, v.ok ? '' : v.reds.join('\n'));
  decl.steps[0].picks = { resume: ['Nope'] };
  assert.equal(validateDeclaration(decl, { arbiter: signed.arbiter, lines: signed.lines, catalogue: wiredMenu() }).ok, false);
});
