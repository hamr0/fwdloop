// M4e amendment 4 items 1, 4, 6 and amendment 5 item 1 (docs/wiki/the-module-ladder.md): the RESUME door of the panel's backend —
// `POST /api/author/resume-prepare` (the first click of "Sign & resume": what is about to be signed, a hash) and `POST /api/author/resume`
// (the second click: the hash must be the one the disk gives now). A Resume continues the SAME run (a run that stopped at its cap or by Stop);
// the ONLY thing it can change is the cap, written as a NEW signed version beside the old one (`signed-values-r<k>.json`, write-once) —
// never an edit of the flow's prose.txt / signature.json, never of an earlier version. No spawn of its own: the continue starts only through
// `authorstart.js`'s `startContinue`.
//
//   resume-prepare {flow, runId, capUsd}      every $0 check, writes NOTHING -> { hash, version, spentUsd, ... }
//   resume         {flow, runId, capUsd, hash} the same checks again, the hash recomputed from the disk NOW; a stale or missing hash signs nothing
//
// One writer of each field: `writeRunValues` writes the version file (this door is its only caller for versions >= 1); the runner reads the
// highest version through `pickRunValues` and nothing else. The agent, the chat notes and the drafter have no path here.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';

import { scrub } from '../authoring.js';
import { loadCatalogue } from '../catalogue.js';
import { checkFlowName, readFileInside, readFlow, resolveRunDir } from '../flow.js';
import { readResumeLock } from '../liveness.js';
import { auditSpend } from '../runner.js';
import {
  flowValues, pickRunValues, valuesHash, writeRunValues,
} from '../runvalues.js';
import { capFloorFor, capFloorText } from './authorcard.js';
import { formFacts } from './authorflows.js';
import { checkValues } from './authorvalues.js';
import { getRunControls } from './data.js';
import { providerKeys } from './spawn.js';

const KEYS = ['flow', 'runId', 'capUsd', 'hash'];

/**
 * @param {{ root: string, loadEnv: () => { ok: boolean, env: Record<string, string|undefined>, refusal: string|null }, monthlyClaim: (usd: number) => any, starter: ReturnType<typeof import('./authorstart.js').createStarter> }} opts
 */
export function createResumeDoor(opts) {
  const {
    root, loadEnv, monthlyClaim, starter,
  } = opts;

  /**
   * Every $0 check, shared by both clicks. `{ok:false, reply}` or the facts the clicks need.
   * @param {any} body
   */
  function inspect(body, formOnly = false) {
    const no = (status, body2) => ({ ok: /** @type {false} */ (false), reply: { status, body: { ok: false, ...body2 } } });
    let realRoot;
    try { realRoot = realpathSync(root); } catch { return no(400, { refused: 'root', say: 'The flows folder this panel serves does not exist.' }); }
    const b = body && typeof body === 'object' ? body : {};
    const flow = typeof b.flow === 'string' ? b.flow : '';
    const named = checkFlowName(flow);
    if (!named.ok) return no(400, { refused: 'flow', refusals: [{ field: 'flow', say: `${named.red}.` }] });
    const runId = typeof b.runId === 'string' ? b.runId : '';
    const rd = resolveRunDir(join(realRoot, flow), runId);
    if (!rd.ok) return no(400, { refused: 'run-id', say: `${rd.red.replace(/^run: /, '')}.` });
    const cat = loadCatalogue();
    if (!cat.ok) return no(500, { refused: 'catalogue', say: 'The catalogue could not be loaded. Nothing was signed.' });
    const read = readFlow({ root: realRoot, name: flow, catalogue: cat.primitives });
    if (!read.ok) return no(400, { refused: 'flow', say: `"${flow}" is not a signed flow that passes its checks, so a run of it will not resume.` });
    const controls = getRunControls({
      root: realRoot, flow, runId, catalogue: cat.primitives,
    });
    if (controls === null) return no(404, { refused: 'no-such-run', say: 'There is no such run.' });
    if (controls.canStop && !controls.atAsk) return no(409, { refused: 'running', say: 'This run is still running. Stop it first, or wait for it to end; a Resume is for a run that stopped.' });
    if (!controls.canResume) return no(409, { refused: 'not-resumable', say: 'This run did not stop at its cap or by Stop, so there is nothing to resume. Start a new run instead.' });
    const lock = readResumeLock(rd.runDir);
    if (lock.state === 'live' || lock.state === 'unknown') return no(409, { refused: 'already-resuming', say: 'This run is already carrying on. Wait a moment, then look again.' });
    const picked = pickRunValues(rd.runDir);
    if (!picked.ok) return no(409, { refused: 'values', say: `${picked.red}. Nothing was signed.` });
    const base = picked.none ? flowValues(read.arbiter) : picked.record.values;
    const version = picked.none ? 1 : picked.version + 1;
    const spent = auditSpend(rd.runDir);
    if (!spent.ok) return no(409, { refused: 'books', say: `The run's books cannot be read (${spent.red}). Nothing was signed.` });
    const hasRound = read.declaration.steps.some((st) => !(read.arbiter.asks ?? []).some((a) => a.line === st.fromLine));
    if (formOnly) return { ok: /** @type {true} */ (true), flow, runId, runDir: rd.runDir, version, base, spentUsd: spent.total, read, hasRound };
    const checked = checkValues({
      allowedKeys: KEYS, body: b, base, realRoot, capOnly: true, floorUsd: capFloorFor(hasRound), spentUsd: spent.total, monthlyClaim, always: true,
    });
    if (!checked.ok) {
      return no(checked.status, checked.refused ? { refused: checked.refused, say: checked.say, refusals: checked.refusals } : { refused: 'resume', refusals: checked.refusals, say: checked.refusals[0]?.say ?? 'Not resumed. Fix the marked box.' });
    }
    const hash = valuesHash({
      flow, flowSignatureHash: read.signature.flow, runId, version, values: checked.values,
    });
    return {
      ok: /** @type {true} */ (true), flow, runId, runDir: rd.runDir, version, values: checked.values, hash, spentUsd: spent.total, remainingUsd: checked.remainingUsd, signatureHash: read.signature.flow, hashGiven: b.hash,
    };
  }

  return {
    /**
     * `GET /api/author/resume-form?flow=&runId=`: what the "Resume run-<n>" form shows — the same locating checks as the clicks (a run that is not
     * stopped or cap-halted gets the same refusal), then the values in force (dimmed on the form except the cap), what the run has spent, the
     * job lines as signed and the files it froze. Writes nothing.
     * @param {string|null} flow @param {string|null} runId
     */
    form(flow, runId) {
      const s = inspect({ flow: flow ?? '', runId: runId ?? '' }, true);
      if (!s.ok) return s.reply;
      const inputsRead = readFileInside(s.runDir, 'inputs.json');
      let inputs = [];
      try { inputs = inputsRead.ok ? JSON.parse(inputsRead.text).map((m) => ({ role: String(m.id), path: String(m.source) })) : []; } catch { inputs = []; }
      const floorUsd = capFloorFor(s.hasRound);
      return {
        status: 200,
        body: {
          ok: true, flow: s.flow, runId: s.runId, version: s.version, values: s.base, spentUsd: s.spentUsd, inputs, floorUsd, floorText: capFloorText(floorUsd), jobLines: formFacts(s.read).jobLines,
        },
      };
    },

    /** `POST /api/author/resume-prepare`: the first click. Writes nothing. @param {any} body */
    prepare(body) {
      const s = /** @type {any} */ (inspect(body));
      if (!s.ok) return s.reply;
      return {
        status: 200,
        body: {
          ok: true, flow: s.flow, runId: s.runId, version: s.version, hash: s.hash, capUsd: s.values.capUsd, spentUsd: s.spentUsd, remainingUsd: s.remainingUsd,
        },
      };
    },

    /**
     * `POST /api/author/resume`: the second click. The hash must be the one the disk gives now (a changed run, a changed cap, a newer version
     * all make it stale); then the new version is written once and the continue is started. Anything else signs nothing, writes nothing.
     * @param {any} body
     */
    resume(body) {
      const loaded = loadEnv();
      if (!loaded.ok) return { status: 409, body: { ok: false, refused: 'keys-file', say: String(loaded.refusal) } };
      const s = /** @type {any} */ (inspect(body));
      if (!s.ok) return s.reply;
      if (typeof s.hashGiven !== 'string' || s.hashGiven !== s.hash) {
        return { status: 409, body: { ok: false, refused: 'stale-hash', say: 'What you were shown is not what is on disk now (its hash differs). Nothing was signed. Look again, then sign.' } };
      }
      const w = writeRunValues(s.runDir, {
        flow: s.flow, flowSignatureHash: s.signatureHash, runId: s.runId, version: s.version, values: s.values, hash: s.hash, signedBy: userInfo().username, at: new Date().toISOString(),
      });
      if (!w.ok) {
        const keys = providerKeys(loaded.env);
        return { status: 409, body: { ok: false, refused: 'sign-refused', say: `${scrub(w.red, keys)}. Nothing was started.` } };
      }
      const started = starter.startContinue({ flow: s.flow, runId: s.runId, version: s.version }, loaded.env);
      if (started.status !== 202) return { status: started.status, body: { ...started.body, signed: true, say: `${started.body.say ?? 'The resume did not start.'} The new cap is signed; try Resume again.` } };
      return { status: 202, body: { ...started.body, signed: true, version: s.version } };
    },
  };
}
