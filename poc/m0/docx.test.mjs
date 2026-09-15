import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { readDocxText } from './docx.mjs';

const REAL_PATH = '/home/hamr/Documents/resumes/Amr Hassan - Resume.docx';
const REAL_SHA256 = '3d6b24a881e5600e1dc2910cdcb11ce6e65c4f6d46c2238d74b4c7a7f7c5beab';

// Bit-by-bit CRC-32, independent of docx.mjs's own implementation, so the
// synthetic fixture doesn't rely on the module under test to build itself.
function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

// Hand-build a minimal one-entry (or two-entry) zip: local header + data,
// then a central directory + EOCD. No zip library — this is the negative
// mirror of docx.mjs's own hand-rolled parser.
function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localOffset = offset;
    parts.push(local, nameBuf, compressed);
    offset += local.length + nameBuf.length + compressed.length;

    const cdir = Buffer.alloc(46);
    cdir.writeUInt32LE(0x02014b50, 0);
    cdir.writeUInt16LE(20, 4);
    cdir.writeUInt16LE(20, 6);
    cdir.writeUInt16LE(0, 8);
    cdir.writeUInt16LE(8, 10);
    cdir.writeUInt16LE(0, 12);
    cdir.writeUInt16LE(0, 14);
    cdir.writeUInt32LE(crc, 16);
    cdir.writeUInt32LE(compressed.length, 20);
    cdir.writeUInt32LE(data.length, 24);
    cdir.writeUInt16LE(nameBuf.length, 28);
    cdir.writeUInt16LE(0, 30);
    cdir.writeUInt16LE(0, 32);
    cdir.writeUInt16LE(0, 34);
    cdir.writeUInt16LE(0, 36);
    cdir.writeUInt32LE(0, 38);
    cdir.writeUInt32LE(localOffset, 42);
    central.push(cdir, nameBuf);
  }
  const cdirStart = offset;
  const cdirBuf = Buffer.concat(central);
  offset += cdirBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdirBuf.length, 12);
  eocd.writeUInt32LE(cdirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cdirBuf, eocd]);
}

function makeDocx(bodyXml, name = 'word/document.xml') {
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' + bodyXml + '</w:body></w:document>';
  return makeZip([{ name, data: Buffer.from(xml, 'utf8') }]);
}

const SYNTHETIC_XML =
  '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">  leading space</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Cost</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>&amp; Value</w:t></w:r></w:p>';

const SYNTHETIC_EXPECTED = 'Hello World\n  leading space\nCost\t& Value';

test('synthetic docx: three paragraphs, preserve-space, tab, entity decode', async (t) => {
  const zipBuf = makeDocx(SYNTHETIC_XML);
  const tmp = new URL('./.tmp-synthetic.docx', import.meta.url);
  writeFileSync(tmp, zipBuf);
  try {
    const result = readDocxText(tmp);
    assert.equal(result.ok, true);
    assert.equal(result.paragraphs, 3);
    assert.equal(result.text, SYNTHETIC_EXPECTED);

    // PROOF the test can fail: flip the expected string, confirm red, restore.
    await t.test('proof: assertion actually catches a wrong value', () => {
      assert.throws(() => {
        assert.equal(result.text, SYNTHETIC_EXPECTED + ' EXTRA');
      }, assert.AssertionError);
    });
  } finally {
    unlinkSync(tmp);
  }
});

test('negative: non-zip file (100 random bytes) is rejected by signature, never throws', () => {
  const junk = Buffer.from(Array.from({ length: 100 }, (_, i) => (i * 37 + 11) % 256));
  const tmpPath = new URL('./.tmp-junk.bin', import.meta.url);
  writeFileSync(tmpPath, junk);
  try {
    const result = readDocxText(tmpPath);
    assert.equal(result.ok, false);
    assert.match(result.red, /signature|End Of Central Directory/i);
  } finally {
    unlinkSync(tmpPath);
  }
});

test('negative: valid zip without word/document.xml is rejected by name', () => {
  const zipBuf = makeDocx('<w:p><w:r><w:t>irrelevant</w:t></w:r></w:p>', 'word/other.xml');
  const tmpPath = new URL('./.tmp-noentry.docx', import.meta.url);
  writeFileSync(tmpPath, zipBuf);
  try {
    const result = readDocxText(tmpPath);
    assert.equal(result.ok, false);
    assert.match(result.red, /word\/document\.xml/);
  } finally {
    unlinkSync(tmpPath);
  }
});

test('negative: truncated docx (cut at 60%) is rejected, never throws', () => {
  const zipBuf = makeDocx(SYNTHETIC_XML);
  const truncated = zipBuf.subarray(0, Math.floor(zipBuf.length * 0.6));
  const tmpPath = new URL('./.tmp-truncated.docx', import.meta.url);
  writeFileSync(tmpPath, truncated);
  try {
    const result = readDocxText(tmpPath);
    assert.equal(result.ok, false);
    assert.ok(typeof result.red === 'string' && result.red.length > 0);
  } finally {
    unlinkSync(tmpPath);
  }
});

test('real resume: pinned sha256, extracted text, two known strings', { skip: !existsSync(REAL_PATH) && 'resume file not present (personal file, not in repo)' }, () => {
  const buf = readFileSync(REAL_PATH);
  const actualSha = createHash('sha256').update(buf).digest('hex');
  assert.equal(
    actualSha,
    REAL_SHA256,
    `pinned resume input changed: expected sha256 ${REAL_SHA256}, got ${actualSha} — refusing to trust stale strings`
  );

  const result = readDocxText(REAL_PATH);
  assert.equal(result.ok, true);
  assert.ok(result.text.length > 0);
  // Verified present via: unzip -p "<path>" word/document.xml | head -c 3000
  assert.match(result.text, /AMR HASSAN/);
  assert.match(result.text, /Technical Project Manager/);
});
