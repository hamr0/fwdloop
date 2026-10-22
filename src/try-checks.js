// M4d am29 item 2: what one try saves about its checks. The runner runs the checks (done, happened, the close); this module only words them
// and records the output they judged. Numbers are identities, not run order: #1 the output exists, #2 the model said done, #3 and up the close's
// checks. A check that did not run (the done check halts before the others) is not listed. A hitl close has no mechanical check, so it adds none.
import { createHash } from 'node:crypto';
import { serializeArtifact } from './ask.js';

export const EVERY_STEP = 'every step';

/** The size words of a byte count: `412 B`, `7.9 KB`, `1.2 MB`. @param {number} n */
export function sizeWords(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Where a guardrail check comes from: the job line it belongs to (guardrail n belongs to job line n). @param {{fromLine?: unknown}} step */
export const lineSource = (step) => (Number.isInteger(step?.fromLine) ? `line ${step.fromLine} ~` : 'the step\'s guardrail');

/** #2, the model's own `done`. @param {{verdict: 'done'|'not-done'}} doneCheck @param {unknown} artifact */
export function doneRecord(doneCheck, artifact) {
  const said = /** @type {any} */ (artifact)?.done;
  return {
    n: 2, text: 'the model said done: true', ok: doneCheck.verdict === 'done', result: doneCheck.verdict === 'done' ? null : (typeof said === 'boolean' ? 'it said done: false' : 'no true/false done'), source: EVERY_STEP,
  };
}

/** #1, the happened check: the output exists and is not empty. @param {{verdict: string, red?: string}} happened @param {unknown} artifact */
export function happenedRecord(happened, artifact) {
  const ok = happened.verdict !== 'red';
  return {
    n: 1, text: 'the output exists and isn\'t empty', ok, result: ok ? sizeWords(Buffer.byteLength(serializeArtifact(artifact), 'utf8')) : String(happened.red ?? '').replace(/^.*? produced /, ''), source: EVERY_STEP,
  };
}

/** The output a try judged: the file it is saved as when the step closes, with the size and sha256 of those exact bytes. Never its content. @param {{emits?: string}} step @param {unknown} artifact */
export function outputRecord(step, artifact) {
  const bytes = serializeArtifact(artifact);
  return { file: `artifacts/${step?.emits ?? 'step'}.json`, bytes: Buffer.byteLength(bytes, 'utf8'), sha256: createHash('sha256').update(Buffer.from(bytes, 'utf8')).digest('hex') };
}

/**
 * #3 and up: the close's own checks. A softgreen close carries each of its checks; a green close is one check over all its cited fields; a close that
 * judged nothing (`unparseable`, `crash`) is one check that could not run, with that third outcome as its result.
 * @param {any} step @param {any} artifact @param {{verdict: string, red?: string|null, checks?: Array<{text:string, ok:boolean, result:string|null}>}} closed
 */
export function closeRecords(step, artifact, closed) {
  const source = lineSource(step);
  if (closed.verdict === 'unparseable' || closed.verdict === 'crash') {
    return [{
      n: 3, text: 'the close could run', ok: false, result: closed.verdict, source,
    }];
  }
  if (step?.close?.class === 'green' && step?.close?.cited) {
    const n = Array.isArray(artifact?.results) ? artifact.results.length : 0;
    return [{
      n: 3, text: 'every result is quoted from the saved copy and passes its rules', ok: closed.verdict === 'green', result: `${n} result${n === 1 ? '' : 's'}`, source,
    }];
  }
  if (step?.close?.class === 'green') {
    const n = Object.keys(artifact?.fields ?? {}).length;
    return [{
      n: 3, text: 'every cited field matches its source', ok: closed.verdict === 'green', result: `${n} field${n === 1 ? '' : 's'}`, source,
    }];
  }
  return (closed.checks ?? []).map((c, i) => ({
    n: 3 + i, text: c.text, ok: c.ok, result: c.result, source,
  }));
}
