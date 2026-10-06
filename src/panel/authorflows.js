// M4e piece 2b (docs/wiki/the-module-ladder.md, "M4e", scope 3 "Run a signed flow", 6, 9; negatives (iii) (iv) (v) (x)): the
// RUN-A-SIGNED-FLOW door of the panel's backend — `GET /api/author/flows` and `POST /api/author/run`. No spawn of its own: a
// run starts only through `authorstart.js`'s one `start`. Reads the disk; writes nothing.
//
//   flows()   only flows whose `readFlow` passes (a missing, unsigned or tampered flow is never listed), each with its signed
//             cap, its declared source roles, the source paths the NEWEST run of that flow used (its `inputs.json`
//             manifest `source` field; blank when none) and what is left this month (a courtesy: the CLI's own monthly
//             check is what refuses).
//   run(body) { flow, inputs: [{role, path}], runId } -> the SAME $0 input checks as the card (`checkInputRows`), the role set
//             must equal the flow's declared roles exactly, the run id the CLI's own check and no such run yet — then `start`.
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { scrub } from '../authoring.js';
import { loadCatalogue } from '../catalogue.js';
import { ConfigError, readConfig } from '../config.js';
import {
  checkFlowName, listFlowNames, listRunIds, nextRunId, readFileInside, readFlow, resolveRunDir,
} from '../flow.js';
import { spendSummary } from '../monthly.js';
import { checkInputRows, runInputRows } from './authorcard.js';
import { providerKeys } from './spawn.js';

const NO_LIMIT = 'no monthly limit set';

/**
 * @param {{ root: string, home?: string, skipMonthly?: boolean, loadEnv: () => { ok: boolean, env: Record<string, string|undefined>, refusal: string|null }, starter: ReturnType<typeof import('./authorstart.js').createStarter> }} opts
 */
export function createFlowsDoor(opts) {
  const {
    root, home, skipMonthly = false, loadEnv, starter,
  } = opts;

  /** What is left of the monthly limit, as a courtesy line: the limit minus this month's counted spend (holds are the CLI's business). */
  function leftThisMonth() {
    // a test process with no config home: the CLI skips its monthly check, so there is no limit to read (and no real home to touch)
    if (skipMonthly) return { limitUsd: null, leftUsd: null, atLeast: false, say: NO_LIMIT };
    let limit;
    try { limit = readConfig({ home }).monthlyLimitUsd ?? null; } catch (e) {
      return { limitUsd: null, leftUsd: null, atLeast: false, say: e instanceof ConfigError ? 'The Settings file cannot be read.' : 'The monthly limit cannot be read.' };
    }
    if (limit === null) return { limitUsd: null, leftUsd: null, atLeast: false, say: NO_LIMIT };
    const month = spendSummary({ home }).month;
    const left = Math.max(0, Math.floor((limit - month.usd) * 100 + 1e-6) / 100);
    return {
      limitUsd: limit, leftUsd: left, atLeast: month.atLeast, say: `${month.atLeast ? 'at most ' : ''}$${left.toFixed(2)} left this month`,
    };
  }

  /** The source paths the newest run of this flow used: role -> path, from that run's `inputs.json`. Blank = none. @param {string} flowDir @param {string[]} roles */
  function lastSources(flowDir, roles) {
    /** @type {Record<string, string>} */
    const out = Object.fromEntries(roles.map((r) => [r, '']));
    let newest = null;
    for (const id of listRunIds(flowDir)) {
      const r = resolveRunDir(flowDir, id);
      if (!r.ok) continue;
      let t;
      try { t = lstatSync(join(r.runDir, 'inputs.json')).mtimeMs; } catch { continue; }
      if (newest === null || t > newest.t || (t === newest.t && id > newest.id)) newest = { t, id, runDir: r.runDir };
    }
    if (newest === null) return { runId: null, sources: out };
    const f = readFileInside(newest.runDir, 'inputs.json');
    let rows = [];
    try { rows = f.ok ? JSON.parse(f.text) : []; } catch { rows = []; }
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row && typeof row.id === 'string' && roles.includes(row.id) && typeof row.source === 'string') out[row.id] = row.source;
    }
    return { runId: newest.id, sources: out };
  }

  /** Read one flow the way the CLI will (`readFlow`: signature verified). @param {string} realRoot @param {string} name */
  function readSigned(realRoot, name) {
    const cat = loadCatalogue();
    if (!cat.ok) return { ok: /** @type {false} */ (false), reds: [`catalogue: ${cat.reds.join('; ')}`] };
    return readFlow({ root: realRoot, name, catalogue: cat.primitives });
  }

  return {
    /** `GET /api/author/flows`. */
    flows() {
      let realRoot;
      try { realRoot = realpathSync(root); } catch { return { status: 200, body: { ok: true, flows: [] } }; }
      const left = leftThisMonth();
      const flows = [];
      for (const name of listFlowNames(realRoot)) {
        const read = readSigned(realRoot, name);
        if (!read.ok) continue;
        const roles = (read.arbiter.sources ?? []).map((s) => s.role);
        const last = lastSources(join(realRoot, name), roles);
        flows.push({
          flow: name, capUsd: read.arbiter.capUsd, roles, nextRunId: nextRunId(join(realRoot, name)), lastRunId: last.runId, lastSources: last.sources, leftThisMonth: left,
        });
      }
      return { status: 200, body: { ok: true, flows, leftThisMonth: left } };
    },

    /**
     * `POST /api/author/run`: $0 checks -> the one start. A refusal names the box, spends $0 and creates nothing.
     * @param {any} body
     */
    run(body) {
      const loaded = loadEnv();
      if (!loaded.ok) return { status: 409, body: { ok: false, refused: 'keys-file', say: String(loaded.refusal) } };
      let realRoot;
      try { realRoot = realpathSync(root); } catch { return { status: 400, body: { ok: false, refused: 'root', say: 'The flows folder this panel serves does not exist.' } }; }
      const flow = typeof body?.flow === 'string' ? body.flow : '';
      const named = checkFlowName(flow);
      if (!named.ok) return { status: 400, body: { ok: false, refused: 'flow', refusals: [{ field: 'flow', say: `${named.red}.` }] } };
      const read = readSigned(realRoot, flow);
      if (!read.ok) {
        const keys = providerKeys(loaded.env);
        return {
          status: 400,
          body: {
            ok: false, refused: 'flow', refusals: [{ field: 'flow', say: `"${flow}" is not a signed flow that passes its checks, so it will not run.` }], reds: read.reds.map((r) => scrub(String(r), keys)),
          },
        };
      }
      /** @type {{field: string, say: string}[]} */
      const refusals = [];
      const rows = runInputRows(body?.inputs);
      refusals.push(...checkInputRows(rows));
      const declared = (read.arbiter.sources ?? []).map((s) => s.role);
      for (const role of declared) {
        if (!rows.some((r) => r.role === role)) refusals.push({ field: 'inputs', say: `This flow needs an input named "${role}". Add it.` });
      }
      rows.forEach((r, n) => {
        if (r.role !== '' && !declared.includes(r.role)) refusals.push({ field: `inputs.${n}`, say: `This flow has no input named "${r.role}" (it takes: ${declared.join(', ') || 'none'}).` });
      });
      const runId = typeof body?.runId === 'string' ? body.runId.trim() : '';
      if (runId !== '') {
        const run = starter.checkRun(flow, runId);
        if (!run.ok) refusals.push({ field: 'runId', say: String(run.say) });
      }
      if (refusals.length > 0) return { status: 400, body: { ok: false, refused: 'run', refusals } };
      return starter.start({
        kind: 'run', flow, runId, sources: declared.map((role) => ({ role, path: /** @type {{path: string}} */ (rows.find((r) => r.role === role)).path })),
      }, loaded.env);
    },
  };
}
