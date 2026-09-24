// borrowed-from: fwdloop poc/m0/docx.mjs@76a3607 (verbatim logic — F13,
// 2026-09-09 ruling: file-format/domain knowledge is fwdloop's own to
// write, never an upstream ask). Minimal .docx (OOXML) text reader, stdlib
// only: parses the zip container by hand and pulls paragraph text out of
// word/document.xml with regex, not a real XML/zip library.
//
// What this discards (every summary declares what it throws away, per
// AGENT_RULES): run formatting, images/drawings, headers/footers/
// footnotes/endnotes/comments, table/cell boundaries (cells collapse to
// paragraph text in document order), revision marks/field codes/bookmarks,
// and content-control wrappers (their inner text still survives — the scan
// is over raw paragraph markup, not a parsed tree).

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const TARGET = 'word/document.xml';

// Zip-bomb defense: the DECLARED size is checked before any data is
// touched, and the REAL inflated size is bounded via inflateRawSync's
// maxOutputLength, so a lying header (small declared size, huge real
// payload) is also refused.
export const DOCX_MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function findEocd(buf) {
  const maxComment = 65535;
  const start = Math.max(0, buf.length - 22 - maxComment);
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function findEntry(buf) {
  const eocd = findEocd(buf);
  if (eocd === -1) return { red: 'no End Of Central Directory record (0x06054b50) found' };
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < total; i += 1) {
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
    if (name === TARGET) return {
      method, crc, compSize, uncompSize, localOffset,
    };
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { red: `${TARGET} not found in zip central directory` };
}

function readEntryBytes(buf, entry) {
  const {
    localOffset, method, compSize, uncompSize, crc,
  } = entry;
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

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};
function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);
}

const RUN_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
function paragraphText(block) {
  let out = '';
  RUN_RE.lastIndex = 0;
  let m = RUN_RE.exec(block);
  while (m) {
    if (m[1] !== undefined) out += decodeEntities(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else out += '\n';
    m = RUN_RE.exec(block);
  }
  return out;
}

function extractText(xml) {
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  return { text: paragraphs.map(paragraphText).join('\n'), paragraphs: paragraphs.length };
}

/** @param {string} path @returns {{ok:true,text:string,paragraphs:number}|{ok:false,red:string}} */
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
  if (read.red || !read.data) return { ok: false, red: read.red ?? 'no data decoded' };
  const xml = read.data.toString('utf8');
  const { text, paragraphs } = extractText(xml);
  return { ok: true, text, paragraphs };
}
