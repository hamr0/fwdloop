// Test-only: build a tiny .docx (a one-entry zip holding word/document.xml) from paragraph XML. Same builder as test/input-facts.test.js.
import { deflateRawSync } from 'node:zlib';

function crc32(buf) {
  let crc = ~0;
  for (const b of buf) { crc ^= b; for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (~crc) >>> 0;
}

/** @param {string} bodyXml @returns {Buffer} */
export function makeDocx(bodyXml) {
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

/** @param {string|null} style @param {string} text @returns {string} one paragraph */
export const para = (style, text) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
