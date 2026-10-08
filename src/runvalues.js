// M4e amendment 5 item 3 and amendment 4 item 6 (docs/wiki/the-module-ladder.md): the signed values ONE RUN uses when they differ from
// its flow's own, and the signed version a resumed run continues under.
//
// A run's folder may hold `signed-values.json` (version 0: written once by the human's two-click "Sign & run", before the run starts) and
// `signed-values-r<k>.json` (k >= 1: written once by the human's two-click "Sign & resume", one per Resume). Each file is the FULL set
// in force from then on (cap, destination, each ask's wait), never a patch, so the highest version wins whole. Write-once ('wx'): no
// version is ever overwritten, and the flow's own prose.txt / signature.json are never touched; the next plain run starts from the flow's
// signed values again. The agent, the chat notes and the drafter have no path to these files (the runner reads them; the panel's two
// doors are the only writers, and only on a hash the human's click carried).
//
//   hash   sha256 over the canonical {flow, flowSignatureHash, runId|null, version, values}: the page shows it at the first click and
//          sends it back at the second; the record carries it and every reader recomputes it (a hand-edited file reads as a refusal).
//
// ONE function decides which version a run uses (`pickRunValues`) and ONE applies it (`applyRunValues`): the runner (fresh run,
// answer-resume, continue) and the CLI's monthly hold all call these, never the files directly.
import { createHash } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readFileInside, readdirInside } from './flow.js';

export const VALUES_FILE_RE = /^signed-values(?:-r(\d+))?\.json$/;

const WAIT_RE = /^(\d+)\s*([smh])$/i;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000 };

/** An ask wait as the signed text spells it (`<int>` then `s`, `m` or `h`), in ms; null when it is not that or not above 0. @param {unknown} text */
export function parseWaitMs(text) {
  const m = typeof text === 'string' ? WAIT_RE.exec(text.trim()) : null;
  if (m === null) return null;
  const n = Number(m[1]);
  return n > 0 && Number.isSafeInteger(n) ? n * UNIT_MS[m[2].toLowerCase()] : null;
}

/** The wait text for a ttl in ms (`2h`, `30m`, `45s`). @param {number} ms */
export function waitText(ms) {
  if (ms % 3_600_000 === 0 && ms > 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0 && ms > 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}

/**
 * The values a flow's own signature gives: the cap, the ONE send's destination folder (null when the flow has no single file send, so a
 * destination cannot be added or changed), and each ask's wait by its line number.
 * @param {any} arbiter `readFlow`'s arbiter
 * @returns {{ capUsd: number, destination: string|null, askWaits: Record<string, string> }}
 */
export function flowValues(arbiter) {
  const sends = arbiter.sends ?? [];
  const destination = sends.length === 1 && sends[0].target?.kind === 'file' ? String(sends[0].target.path) : null;
  const askWaits = Object.fromEntries((arbiter.asks ?? []).map((a) => [String(a.line), waitText(a.ttlMs)]));
  return { capUsd: arbiter.capUsd, destination, askWaits };
}

/** @param {{capUsd: number, destination: string|null, askWaits: Record<string,string>}} v the values in canonical key order */
function canonValues(v) {
  return {
    capUsd: v.capUsd,
    destination: v.destination ?? null,
    askWaits: Object.fromEntries(Object.entries(v.askWaits ?? {}).sort(([a], [b]) => Number(a) - Number(b))),
  };
}

/**
 * The hash the human's click is bound to.
 * @param {{ flow: string, flowSignatureHash: string, runId?: string|null, version: number, values: {capUsd: number, destination: string|null, askWaits: Record<string,string>} }} a
 */
export function valuesHash({
  flow, flowSignatureHash, runId = null, version, values,
}) {
  return createHash('sha256').update(JSON.stringify({
    flow, flowSignatureHash, runId, version, values: canonValues(values),
  })).digest('hex');
}

/** True when `a` and `b` are the same values (cap, destination, every wait). */
export function sameValues(a, b) {
  return JSON.stringify(canonValues(a)) === JSON.stringify(canonValues(b));
}

/** File name of a version. @param {number} version */
export const valuesFileName = (version) => (version === 0 ? 'signed-values.json' : `signed-values-r${version}.json`);

/**
 * The ONE writer of a version file: write-once (`wx`), mode 0600. Refuses a record whose hash does not match its own fields.
 * @param {string} runDir
 * @param {{ flow: string, flowSignatureHash: string, runId: string, version: number, values: any, hash: string, signedBy: string, at: string }} record
 * @returns {{ok: true, file: string} | {ok: false, red: string}}
 */
export function writeRunValues(runDir, record) {
  const want = valuesHash({
    flow: record.flow, flowSignatureHash: record.flowSignatureHash, runId: record.version === 0 ? null : record.runId, version: record.version, values: record.values,
  });
  if (want !== record.hash) return { ok: false, red: 'signed values: the hash does not match the values — nothing written' };
  const file = join(runDir, valuesFileName(record.version));
  try {
    writeFileSync(file, `${JSON.stringify({ ...record, values: canonValues(record.values) }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    return { ok: false, red: err.code === 'EEXIST' ? `signed values: version ${record.version} of this run already exists — never overwritten` : `signed values: could not write ${valuesFileName(record.version)} (${err.code ?? err.message})` };
  }
  return { ok: true, file };
}

/**
 * The ONE decision "which signed version does this run use": the highest version file in the run folder.
 * `{ok:true, none:true}` = the flow's own values; `{ok:true, version, record}`; `{ok:false, red}` = a file that cannot be trusted
 * (unreadable, not JSON, wrong shape, a hash that does not match its fields, a name that disagrees with its version).
 * @param {string} runDir
 * @returns {{ok: true, none: true} | {ok: true, none?: false, version: number, record: any} | {ok: false, red: string}}
 */
export function pickRunValues(runDir) {
  let best = null;
  for (const name of readdirInside(runDir, '.')) {
    const m = VALUES_FILE_RE.exec(name);
    if (m === null) continue;
    const version = m[1] === undefined ? 0 : Number(m[1]);
    if (best === null || version > best.version) best = { version, name };
  }
  if (best === null) return { ok: true, none: true };
  const f = readFileInside(runDir, best.name);
  if (!f.ok) return { ok: false, red: `signed values: ${best.name} — ${f.missing ? 'unreadable' : f.red}` };
  let record;
  try { record = JSON.parse(f.text); } catch (err) { return { ok: false, red: `signed values: ${best.name} is not valid JSON — ${err.message}` }; }
  const v = record?.values;
  const shaped = record && typeof record === 'object' && record.version === best.version && typeof record.flow === 'string' && typeof record.flowSignatureHash === 'string'
    && typeof record.hash === 'string' && v && typeof v === 'object' && Number.isFinite(v.capUsd) && v.capUsd > 0
    && (v.destination === null || (typeof v.destination === 'string' && v.destination !== ''))
    && v.askWaits && typeof v.askWaits === 'object' && Object.values(v.askWaits).every((w) => parseWaitMs(w) !== null);
  if (!shaped) return { ok: false, red: `signed values: ${best.name} does not have the shape of a signed values record` };
  const want = valuesHash({
    flow: record.flow, flowSignatureHash: record.flowSignatureHash, runId: best.version === 0 ? null : (record.runId ?? null), version: best.version, values: v,
  });
  if (want !== record.hash) return { ok: false, red: `signed values: ${best.name} does not match its own hash — it was changed after it was signed` };
  return { ok: true, version: best.version, record };
}

/**
 * The arbiter a run executes under: the flow's own, with the picked record's cap, send folder and ask waits laid over it. The flow's
 * arbiter object is never mutated. A record for another flow or a changed flow signature is refused; so is a record that names a send
 * or an ask the flow does not have.
 * @param {any} arbiter `readFlow`'s arbiter @param {string} flow @param {string} flowSignatureHash
 * @param {ReturnType<typeof pickRunValues>} picked
 * @returns {{ok: true, arbiter: any, version: number|null} | {ok: false, red: string}}
 */
export function applyRunValues(arbiter, flow, flowSignatureHash, picked) {
  if (!picked.ok) return { ok: false, red: picked.red };
  if (picked.none) return { ok: true, arbiter, version: null };
  const { record } = picked;
  if (record.flow !== flow || record.flowSignatureHash !== flowSignatureHash) {
    return { ok: false, red: `signed values: ${valuesFileName(picked.version)} was signed for another flow or another signature of this flow — refusing` };
  }
  const own = flowValues(arbiter);
  const v = record.values;
  if ((v.destination === null) !== (own.destination === null)) return { ok: false, red: 'signed values: the destination does not fit this flow (it has no single send folder to change) — refusing' };
  const lines = Object.keys(own.askWaits).sort().join(',');
  if (Object.keys(v.askWaits).sort().join(',') !== lines) return { ok: false, red: 'signed values: the ask waits do not name this flow\'s asks — refusing' };
  return {
    ok: true,
    version: picked.version,
    arbiter: {
      ...arbiter,
      capUsd: v.capUsd,
      sends: (arbiter.sends ?? []).map((s) => (v.destination === null ? s : { ...s, target: { ...s.target, path: v.destination } })),
      asks: (arbiter.asks ?? []).map((a) => ({ ...a, ttlMs: parseWaitMs(v.askWaits[String(a.line)]), ttlSigned: true })),
    },
  };
}

/**
 * A start that refused before the run began (monthly limit, empty key ...) leaves a run folder holding nothing but its signed values
 * file: remove that one file so the folder can be removed too and the run name is not burned. Never touches a folder with anything else.
 * @param {string} runDir @returns {boolean} true when the file was removed
 */
export function dropUnstartedValues(runDir) {
  const names = readdirInside(runDir, '.');
  if (names.length !== 1 || names[0] !== valuesFileName(0)) return false;
  try { unlinkSync(join(runDir, names[0])); return true; } catch { return false; }
}
