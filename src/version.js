// M4d amendment 17: fwdloop's own version, for the panel header. The ONE reader: the server calls it when it serves the page, so the number is always the one in
// the package.json of the code that is running (never typed into the page). An unreadable file is "unknown", never a made-up number.
import { readFileSync } from 'node:fs';

const OWN_PACKAGE = new URL('../package.json', import.meta.url);

/** @param {string|URL} [file] a package.json (a test passes a copy) @returns {string|null} */
export function readOwnVersion(file = OWN_PACKAGE) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))?.version;
    return typeof v === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(v) ? v : null;
  } catch { return null; }
}
