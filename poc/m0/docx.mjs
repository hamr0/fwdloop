// borrowed-from: none — original POC, PRD M0b Job #2 / ladder Amendment B
// (F13: file-format knowledge is ours to write, not an upstream ask).
//
// Minimal .docx (OOXML) text reader. Stdlib only (node:fs, node:zlib, node:buffer):
// parses the zip container by hand and pulls paragraph text out of
// word/document.xml with regex, not a real XML/zip library.
//
// What this discards, and why nothing downstream needs it (PRD guiding principle:
// every summary declares what it throws away):
//   - Run formatting (bold/italic/font/color/size, w:rPr) — downstream reads text.
//   - Images (word/media/*) and drawings — no OCR/vision step reads them here.
//   - Headers, footers, footnotes, endnotes, comments — separate XML parts we never
//     open; the job body lives in word/document.xml only.
//   - Table/cell boundaries (w:tbl/w:tr/w:tc) — cells collapse to paragraph text in
//     document order; no downstream step needs a grid, only the words.
//   - Revision marks (w:ins/w:del), field codes, bookmarks, hyperlink targets —
//     visible run text survives, the markup around it does not.
//   - Content controls (w:sdt) / smart tags are not unwrapped specially — their
//     inner <w:t> runs are still captured because extraction scans raw paragraph
//     markup, not a parsed tree.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const TARGET = 'word/document.xml';

// Cap on the uncompressed size of word/document.xml — a zip bomb defense.
// Two layers enforce it (readEntryBytes): the DECLARED size from the central
// directory is checked before any data is touched, and the REAL inflated
// size is bounded via inflateRawSync's maxOutputLength so a lying header
// (small declared size, huge real payload) is also refused.
export const DOCX_MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

// Bit-by-bit CRC-32 (no precomputed table — POC scope, not a hot path).
function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function findEocd(buf) {
  const maxComment = 65535;
  const start = Math.max(0, buf.length - 22 - maxComment);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function findEntry(buf) {
  const eocd = findEocd(buf);
  if (eocd === -1) return { red: 'no End Of Central Directory record (0x06054b50) found' };
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < total; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CDIR_SIG) {
      return { red: `central directory entry ${i} missing signature (0x02014b50)` };
    }
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (name === TARGET) return { method, crc, compSize, uncompSize, localOffset };
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { red: `${TARGET} not found in zip central directory` };
}

function readEntryBytes(buf, entry) {
  const { localOffset, method, compSize, uncompSize, crc } = entry;
  if (uncompSize > DOCX_MAX_UNCOMPRESSED_BYTES) {
    return { red: `entry too large: declared ${uncompSize} bytes exceeds cap ${DOCX_MAX_UNCOMPRESSED_BYTES}` };
  }
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
    return { red: `local file header missing signature (0x04034b50) at offset ${localOffset}` };
  }
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  if (dataStart + compSize > buf.length) return { red: 'compressed data runs past end of file (truncated)' };
  const raw = buf.subarray(dataStart, dataStart + compSize);
  let data;
  if (method === 0) data = Buffer.from(raw);
  else if (method === 8) {
    try {
      data = inflateRawSync(raw, { maxOutputLength: DOCX_MAX_UNCOMPRESSED_BYTES });
    } catch (e) {
      if (e instanceof RangeError) {
        return { red: `inflate exceeded cap ${DOCX_MAX_UNCOMPRESSED_BYTES} bytes` };
      }
      return { red: `inflate failed: ${e.message}` };
    }
  } else return { red: `unsupported compression method ${method} (only 0=stored, 8=deflate)` };
  if (data.length !== uncompSize) return { red: `size mismatch: expected ${uncompSize} bytes, got ${data.length}` };
  if (crc32(data) !== crc) return { red: 'CRC-32 mismatch: decompressed data does not match stored checksum' };
  return { data };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);
}

const RUN_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
function paragraphText(block) {
  let out = '';
  RUN_RE.lastIndex = 0;
  let m;
  while ((m = RUN_RE.exec(block))) {
    if (m[1] !== undefined) out += decodeEntities(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else out += '\n';
  }
  return out;
}

function extractText(xml) {
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  return { text: paragraphs.map(paragraphText).join('\n'), paragraphs: paragraphs.length };
}

export function readDocxText(path) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch (e) {
    return { ok: false, red: `cannot read file: ${e.message}` };
  }
  const entry = findEntry(buf);
  if (entry.red) return { ok: false, red: entry.red };
  const read = readEntryBytes(buf, entry);
  if (read.red) return { ok: false, red: read.red };
  const xml = read.data.toString('utf8');
  const { text, paragraphs } = extractText(xml);
  return { ok: true, text, paragraphs };
}
