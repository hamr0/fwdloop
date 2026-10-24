// M10 piece 4: the text a cited check reads - THE RUN'S OWN frozen copy of a web page or a text/markdown doc (`<run>/inputs/<file>`, written at run start by
// `freezeInputs`), checked against the sha256 `run.json` (its `inputs`) recorded when it was frozen. The drafting copy lives in the draft folder and is never read here.
// Same three outcomes as the CSV reader (`readInputCells`): not a text input of this run, a refusal that names why, or the text.
// A .docx input (M10 piece 5, item 2 "a quote in a doc") is served as its paragraph text (src/docx.js says what that throws away), its sha256 taken over the file's BYTES from the same
// read the text comes from. Throws away: nothing for a page or a text file. A .csv input is not served here (it is read as cells).
// A refusal carries `code`: 'no-manifest' / 'not-an-input' / 'not-text' (this is not a text source of this run) or 'unreadable' (it is one, and it cannot be trusted:
// the copy is missing or changed); a step that merely READS a role (src/runner.js readArtifactsMapChecked) halts only on 'unreadable'.
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { readFileInside, resolveInside } from './flow.js';
import { readRunInputs } from './runfile.js';
import { readDocxSource } from './docx.js';

/** the frozen files served as text: a saved page (.txt) or a text/markdown document. Any other kind (a spreadsheet, a .docx, a binary) is never served as text. */
const TEXT_EXTS = Object.freeze(['.txt', '.md', '.markdown']);

/**
 * @param {string} runDir the run's own folder @param {string} role the signed input's role
 * @param {{docx?: boolean}} [o] `docx`: also serve a .docx as its text. Off by default: a step that merely READS a role is never handed a .docx here (it has `readDocx`); only the
 *   cited CHECK asks for it, so a quote a step took from a .docx is proved on the same text `readDocx` gives.
 * @returns {{ok: true, text: string, sha256: string, frozen: string}|{ok: false, red: string, code: 'no-manifest'|'not-an-input'|'not-text'|'unreadable'}}
 */
export function readRunSource(runDir, role, { docx = false } = {}) {
  const manifest = readRunInputs(runDir);
  if (!manifest.ok) return { ok: false, code: manifest.code === 'missing' ? 'no-manifest' : 'unreadable', red: manifest.code === 'missing' ? `input "${role}": this run has no frozen inputs` : `input "${role}": ${manifest.red}` };
  const entry = manifest.entries.find((e) => e?.id === role);
  if (!entry || typeof entry.frozen !== 'string' || typeof entry.sha256 !== 'string') return { ok: false, code: 'not-an-input', red: `input "${role}": this run froze no input with that name` };
  const lower = entry.frozen.toLowerCase();
  if (docx && lower.endsWith('.docx')) return readRunDocx(runDir, role, entry);
  if (!TEXT_EXTS.some((x) => lower.endsWith(x))) return { ok: false, code: 'not-text', red: `input "${role}": a quote can be checked against a web page, a text file or a .docx here, not "${basename(entry.frozen)}"` };
  const file = readFileInside(runDir, `inputs/${basename(entry.frozen)}`);
  if (!file.ok) return { ok: false, code: 'unreadable', red: file.missing ? `input "${role}": the frozen copy is missing` : `input "${role}": ${file.red}` };
  const sha256 = createHash('sha256').update(file.text, 'utf8').digest('hex');
  if (sha256 !== entry.sha256) return { ok: false, code: 'unreadable', red: `input "${role}": the frozen copy changed since it was frozen` };
  return { ok: true, text: file.text, sha256, frozen: basename(entry.frozen) };
}

/** the run's own frozen .docx, through the same safe path check as every other read (no symlink, nothing outside the run folder), proved against the recorded sha256
 *  @param {string} runDir @param {string} role @param {{frozen: string, sha256: string}} entry
 *  @returns {{ok: true, text: string, sha256: string, frozen: string}|{ok: false, red: string, code: 'unreadable'}} */
function readRunDocx(runDir, role, entry) {
  const where = resolveInside(runDir, `inputs/${basename(entry.frozen)}`);
  if (!where.ok) return { ok: false, code: 'unreadable', red: where.missing ? `input "${role}": the frozen copy is missing` : `input "${role}": ${where.red}` };
  const doc = readDocxSource(where.full);
  if (!doc.ok) return { ok: false, code: 'unreadable', red: `input "${role}": ${doc.red}` };
  if (doc.sha256 !== entry.sha256) return { ok: false, code: 'unreadable', red: `input "${role}": the frozen copy changed since it was frozen` };
  return { ok: true, text: doc.text, sha256: doc.sha256, frozen: basename(entry.frozen) };
}
