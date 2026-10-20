// M10 piece 4: the text a cited check reads - THE RUN'S OWN frozen copy of a web page or a text/markdown doc (`<run>/inputs/<file>`, written at run start by
// `freezeInputs`), checked against the sha256 `inputs.json` recorded when it was frozen. The drafting copy lives in the draft folder and is never read here.
// Same three outcomes as the CSV reader (`readInputCells`): not a text input of this run, a refusal that names why, or the text.
// Throws away: nothing. A .docx / .csv input is not served here (a .csv is read as cells; .docx is a later piece).
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { readFileInside } from './flow.js';
import { isCellsPath } from './closers.js';

/**
 * @param {string} runDir the run's own folder @param {string} role the signed input's role
 * @returns {{ok: true, text: string, sha256: string, frozen: string}|{ok: false, red: string}}
 */
export function readRunSource(runDir, role) {
  const manifest = readFileInside(runDir, 'inputs.json');
  if (!manifest.ok) return { ok: false, red: manifest.missing ? `input "${role}": this run has no frozen inputs` : `input "${role}": ${manifest.red}` };
  let entries;
  try { entries = JSON.parse(manifest.text); } catch (err) { return { ok: false, red: `input "${role}": inputs.json is not valid JSON — ${err.message}` }; }
  const entry = Array.isArray(entries) ? entries.find((e) => e?.id === role) : undefined;
  if (!entry || typeof entry.frozen !== 'string' || typeof entry.sha256 !== 'string') return { ok: false, red: `input "${role}": this run froze no input with that name` };
  const lower = entry.frozen.toLowerCase();
  if (isCellsPath(entry.frozen) || lower.endsWith('.docx')) return { ok: false, red: `input "${role}": a quote can be checked against a web page or a text file here, not "${basename(entry.frozen)}"` };
  const file = readFileInside(runDir, `inputs/${basename(entry.frozen)}`);
  if (!file.ok) return { ok: false, red: file.missing ? `input "${role}": the frozen copy is missing` : `input "${role}": ${file.red}` };
  const sha256 = createHash('sha256').update(file.text, 'utf8').digest('hex');
  if (sha256 !== entry.sha256) return { ok: false, red: `input "${role}": the frozen copy changed since it was frozen` };
  return { ok: true, text: file.text, sha256, frozen: basename(entry.frozen) };
}
