// borrowed-from: bareloop tests/learn-fixtures.js@v0.46.0 (8b3d815); parseSpineText (bareloop src/legs.js) replaced by a plain JSONL read, fwdloop has no spine
// Real archived runs for the learnings tests (tests/fixtures/learn/README.md says how they were cut): the spine records
// buildCards reads, and the gate-audit allow write/edit rows. Never authored; a test that edits one says so.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCards } from '../src/learn.js';

export const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'learn');
export const MANIFEST = JSON.parse(readFileSync(join(FIX, 'manifest.json'), 'utf8'));

/** @param {string} id @returns {{events: any[], audit: any[], workdir: string|null, job: string}} */
export function loadRun(id) {
  const events = readFileSync(join(FIX, `${id}.jsonl`), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const ap = join(FIX, `${id}-audit.jsonl`);
  const audit = existsSync(ap) ? readFileSync(ap, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { events, audit, workdir: MANIFEST[id].patient ?? null, job: MANIFEST[id].job };
}

/**
 * Build a run's cards from its fixture; `over` replaces any input.
 * @param {string} id @param {Record<string, any>} [over]
 */
export function cardsOf(id, over = {}) {
  const r = loadRun(id);
  return buildCards({ runid: id, events: r.events, audit: r.audit, workdir: r.workdir, ...over });
}
