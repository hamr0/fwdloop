// POC of the page-sign gate: the typed name must equal target.json's name BEFORE signDraft is called.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signDraft } from '../../src/authoring.js';

export function pageSign({ dir, approve, typedName, signedBy = 'poc-os-user', env = {} }) {
  let name;
  try { name = JSON.parse(readFileSync(join(dir, 'target.json'), 'utf8')).name; } catch { return { ok: false, reds: ['page sign: draft has no readable target.json name'] }; }
  if (typeof typedName !== 'string' || typedName === '') return { ok: false, reds: ['page sign: type the flow name to sign'] };
  if (typedName !== name) return { ok: false, reds: ['page sign: the typed name does not match the flow name'] };
  return signDraft({ dir, approve, signedBy, env });
}
