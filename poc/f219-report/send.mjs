// F219 POC (not src/): the M15 am3 send. Uses fwd's REAL checkSendDestination, serializeArtifact, sha256Hex and bare-agent's real shell_write (what src/send.js uses).
// Differences from src/send.js `sendViaPrimitive`, all from the signed text: the file is `<job>-YYYY-MM-DD[-n].md` (a taken name goes to the next free one, never over it) and holds the
// title + Passed line + body; the accepted hash binds the BODY (`{text: body}`), not the file.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createShellTools } from 'bare-agent/tools';
import { checkSendDestination } from '../../src/runner.js';
import { serializeArtifact, sha256Hex } from '../../src/ask.js';
import { fileText } from './render.mjs';

const WRITE = createShellTools().tools.find((t) => t.name === 'shell_write');
const pad = (n) => String(n).padStart(2, '0');
export const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** @param {{target: string, job: string, runNo: number|null, now: Date, body: string, acceptedSha256: string|null, ctx?: any, overwrite?: boolean}} o */
export async function sendReport({ target, job, runNo, now, body, acceptedSha256, ctx = {}, overwrite = false }) {
  const dest = checkSendDestination(target, ctx);
  if (!dest.ok) return { ok: false, red: dest.red };
  if (typeof acceptedSha256 !== 'string' || !acceptedSha256) return { ok: false, red: 'send: no accepted-body hash was recorded for this accept — refused (nothing shipped)' };
  const actual = sha256Hex(serializeArtifact({ text: body }));
  if (actual !== acceptedSha256) return { ok: false, red: `send: the body changed after it was accepted (accepted sha256 ${acceptedSha256}, about to send ${actual}) — refused (nothing shipped)` };
  const base = `${job}-${dayOf(now)}`;
  const first = `${base}.md`;
  let name = first;
  if (!overwrite) for (let n = 2; existsSync(join(dest.dir, name)); n += 1) name = `${base}-${n}.md`;
  const path = join(dest.dir, name);
  await WRITE.execute({ path, content: fileText(job, runNo, now, body) });
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0) return { ok: false, red: `send: "${path}" wrote 0 bytes` };
  return { ok: true, path, name, bytes: bytes.byteLength, sentSha256: createHash('sha256').update(bytes).digest('hex'), note: name === first ? null : `saved under a new name because ${first} was already taken` };
}
