// M4e piece 2b (docs/wiki/the-module-ladder.md, "M4e", scope 3 "Run a signed flow", 6, 9; negatives (iii) (iv) (v) (x)): the
// RUN-A-SIGNED-FLOW door of the panel's backend — `GET /api/author/flows` and `POST /api/author/run`. No spawn of its own: a
// run starts only through `authorstart.js`'s one `start`. Reads the disk; writes nothing.
//
//   flows()   only flows whose `readFlow` passes (a missing, unsigned or tampered flow is never listed), that `canFlowRun` accepts
//             (the one function shared with the run's own preflight: an unwired verb is not listed; amendment 22) and that have at least one
//             passed run (amendment 7 item 7; Run again reaches the rest), each with its signed
//             cap, its declared source roles, the source paths the NEWEST run of that flow used (its `inputs.json`
//             manifest `source` field; blank when none) and what is left this month (a courtesy: the CLI's own monthly
//             check is what refuses).
//   run(body) { flow, inputs: [{role, path}], runId } -> the SAME $0 input checks as the card (`checkInputRows`), the role set
//             must equal the flow's declared roles exactly, the run id the CLI's own check and no such run yet — then `start`.
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { scrub } from '../authoring.js';
import { endRow, readHistory } from '../books.js';
import { canFlowRun, willNotRunSay } from '../canrun.js';
import { loadCatalogue } from '../catalogue.js';
import { ConfigError, readConfig } from '../config.js';
import {
  changeSentence, checkFlowName, listFlowNames, listRunIds, nextRunId, readFileInside, readFlow, resolveRunDir, suggestFlowName,
} from '../flow.js';
import { jobKeyOfCard, jobKeyOfSigned } from '../jobkey.js';
import { spendSummary } from '../monthly.js';
import { userInfo } from 'node:os';
import {
  applyRunValues, flowValues, pickRunValues, valuesHash,
} from '../runvalues.js';
import {
  capFloorOf, cardFromSigned, checkInputRows, runInputRows,
} from './authorcard.js';
import { checkValues } from './authorvalues.js';
import { getRunControls } from './data.js';
import { providerKeys } from './spawn.js';
import { readModelRecord, writeModelRecord } from '../flowmodel.js';

/** M6 amendment 1: the sentence the page shows and the sign route refuses with, for a job with a run running or waiting at its ask. @param {string} runId */
export const editBlockedSay = (runId) => `finish or stop ${runId} first`;
/** M6 amendment 3: the sentence for a job with a start still alive (its start folder in phase `starting`). */
export const EDIT_STARTING_SAY = 'a run is starting';
const NO_LIMIT = 'no monthly limit set';
/** The body keys a run start takes (amendment 5 item 2): the open boxes plus the hash of the second click. Any other key is refused by name. */
const RUN_KEYS = ['flow', 'inputs', 'runId', 'destination', 'capUsd', 'askWaits', 'hash', 'provider', 'model'];

/**
 * What the Run / Resume forms show of a signed flow (read from its own files, never from a model): the job lines as the signed text has them
 * (an ask line carries its question and its wait), the values the open boxes start from, and the cap floor. Amendment 5 item 2: all the rest is dimmed.
 * @param {any} read `readFlow`'s ok result @param {string} [home] the config home Settings is read from @param {string} [flowDir] the signed flow's folder: the model recorded beside it is the one it runs with (M4d amendment 6)
 * @param {{ slot: string, model: string }|null} [picked] a flow with no record runs with the model picked in Chat (M4d amendment 7b): its price is the cap floor
 */
export function formFacts(read, home, flowDir, picked = null) {
  const asks = new Map((read.arbiter.asks ?? []).map((a) => [a.line, a]));
  const values = flowValues(read.arbiter);
  const jobLines = read.lines.map((l) => ({
    n: l.n, text: l.text, guardrail: l.guardrail || null, ask: asks.has(l.n) ? { wait: values.askWaits[String(l.n)] } : null,
  }));
  const hasRound = read.declaration.steps.some((st) => !asks.has(st.fromLine));
  const recorded = flowDir === undefined ? null : readModelRecord(flowDir);
  const pick = recorded ?? picked;
  return {
    values, jobLines, hasSend: values.destination !== null, capFloorUsd: capFloorOf(hasRound, home, pick).usd, floorModel: capFloorOf(hasRound, home, pick).model,
    model: recorded === null ? null : { slot: recorded.slot, model: recorded.model, label: `${recorded.slot} · ${recorded.model}` },
  };
}

/**
 * @param {{ root: string, home?: string, skipMonthly?: boolean, loadEnv: () => { ok: boolean, env: Record<string, string|undefined>, refusal: string|null }, starter: ReturnType<typeof import('./authorstart.js').createStarter>, monthlyClaim: (usd: number) => any, modelRefusal: (card: any, loaded: any) => { field: string, say: string }[] }} opts
 */
export function createFlowsDoor(opts) {
  const {
    root, home, skipMonthly = false, loadEnv, starter, monthlyClaim, modelRefusal,
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

  /** The source paths one run froze: role -> path, from that run's `inputs.json`. Blank = none. @param {string} runDir @param {string[]} roles */
  function sourcesOf(runDir, roles) {
    /** @type {Record<string, string>} */
    const out = Object.fromEntries(roles.map((r) => [r, '']));
    if (runDir === '') return out;
    const f = readFileInside(runDir, 'inputs.json');
    let rows = [];
    try { rows = f.ok ? JSON.parse(f.text) : []; } catch { rows = []; }
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row && typeof row.id === 'string' && roles.includes(row.id) && typeof row.source === 'string') out[row.id] = row.source;
    }
    return out;
  }

  /** The source paths the newest run of this flow used: role -> path, from that run's `inputs.json`. Blank = none. @param {string} flowDir @param {string[]} roles */
  function lastSources(flowDir, roles) {
    let newest = null;
    for (const id of listRunIds(flowDir)) {
      const r = resolveRunDir(flowDir, id);
      if (!r.ok) continue;
      let t;
      try { t = lstatSync(join(r.runDir, 'inputs.json')).mtimeMs; } catch { continue; }
      if (newest === null || t > newest.t || (t === newest.t && id > newest.id)) newest = { t, id, runDir: r.runDir };
    }
    if (newest === null) return { runId: null, sources: sourcesOf('', roles) };
    return { runId: newest.id, sources: sourcesOf(newest.runDir, roles) };
  }

  /** The values one run ran with: the flow's own, with the run's newest signed version laid over (`applyRunValues`). Unreadable = the flow's own. @param {any} read @param {string} name @param {string} runDir */
  function runValuesOf(read, name, runDir) {
    const applied = applyRunValues(read.arbiter, name, read.signature.flow, pickRunValues(runDir));
    return { values: flowValues(applied.ok ? applied.arbiter : read.arbiter) };
  }

  /**
   * What the Signed flow list shows of a flow's runs, read from its books: the passed runs (each with the values and input paths it
   * ran with, so picking a run fills them in) and the track record (bareloop's reuse-estimate shape). An average reads only figures that
   * are exact: a run with an unpriced spend or no wall time is left out of it, never counted as $0 or 0 min (unknown is never zero).
   * @param {string} flowDir @param {string} name @param {any} read @param {string[]} roles
   */
  function runsOf(flowDir, name, read, roles) {
    const history = readHistory(flowDir);
    const passed = [];
    let green = 0; let notGreen = 0; let spendSum = 0; let spendN = 0; let wallSum = 0; let wallN = 0;
    for (const id of listRunIds(flowDir)) {
      const r = resolveRunDir(flowDir, id);
      if (!r.ok) continue;
      const end = endRow(history, r.runDir, id);
      if (end === null) continue;   // not ended (running, parked, died): neither green nor not green
      if (end.outcome === 'complete') {
        green += 1;
        passed.push({ runId: id, ...runValuesOf(read, name, r.runDir), sources: sourcesOf(r.runDir, roles) });
      } else notGreen += 1;
      if (end.spendComplete === true && Number.isFinite(end.spentUsd) && end.spentUsd >= 0) { spendSum += end.spentUsd; spendN += 1; }
      if (Number.isFinite(end.wallMs) && end.wallMs > 0) { wallSum += end.wallMs; wallN += 1; }
    }
    const asks = new Set((read.arbiter.asks ?? []).map((a) => a.line));
    return {
      passed,
      stats: {
        steps: read.declaration.steps.filter((st) => !asks.has(st.fromLine)).length, asks: asks.size, green, notGreen,
        avgSpendUsd: spendN > 0 ? spendSum / spendN : null, avgWallMs: wallN > 0 ? wallSum / wallN : null,
      },
    };
  }

  /** The real path of the flows folder this panel serves, or null when it is not there — the one place `root` is resolved. */
  function realRootOrNull() {
    try { return realpathSync(root); } catch { return null; }
  }

  /** Read one flow the way the CLI will (`readFlow`: signature verified). @param {string} realRoot @param {string} name */
  function readSigned(realRoot, name) {
    const cat = loadCatalogue();
    if (!cat.ok) return { ok: /** @type {false} */ (false), reds: [`catalogue: ${cat.reds.join('; ')}`] };
    return readFlow({ root: realRoot, name, catalogue: cat.primitives });
  }

  /**
   * Every $0 check of a run start, shared by `runPrepare` (the first click) and `run`. `{ok:false, reply}` or the facts a start needs.
   * Amendment 5 items 2-4: the open boxes are Inputs, Destination, Cap $ and each ask's wait; anything else in the body is refused by name.
   * @param {any} body @param {any} loaded the keys load
   */
  function inspect(body, loaded) {
    const keys = providerKeys(loaded);
    const reply = (status, b) => ({ ok: /** @type {false} */ (false), reply: { status, body: { ok: false, ...b } } });
    const realRoot = realRootOrNull();
    if (realRoot === null) return reply(400, { refused: 'root', say: 'The flows folder this panel serves does not exist.' });
    const flow = typeof body?.flow === 'string' ? body.flow : '';
    const named = checkFlowName(flow);
    if (!named.ok) return reply(400, { refused: 'flow', refusals: [{ field: 'flow', say: `${named.red}.` }] });
    const read = readSigned(realRoot, flow);
    if (!read.ok) {
    return reply(400, { refused: 'flow', refusals: [{ field: 'flow', say: `"${flow}" is not a signed flow that passes its checks, so it will not run.${changeSentence(read.reds.map((r) => scrub(String(r), keys)))}` }], reds: read.reds.map((r) => scrub(String(r), keys)) });
    }
    const can = canFlowRun(read);   // amendment 21 item 1: a flow the list shows refused is refused here too, in the same sentence
    if (!can.ok) {
      const red = scrub(String(can.red), keys);
      return reply(409, { refused: 'flow', say: willNotRunSay(flow, red), refusals: [{ field: 'flow', say: willNotRunSay(flow, red) }] });
    }
    // M4d amendment 7b: a flow with no recorded model takes the one picked in Chat (checked now, at the click) and records it.
    // M6 am5/am6: a flow WITH a record keeps it unless the body names a different model: that is this run's own model (a run field, Sign & run).
    const record = readModelRecord(join(realRoot, flow));
    const noRecord = record === null;
    const namedModel = typeof body?.provider === 'string' && body.provider !== '' && typeof body?.model === 'string' && body.model !== '';
    const modelReds = noRecord || namedModel ? modelRefusal({ provider: body?.provider, model: body?.model }, loaded) : [];
    const newPick = noRecord && modelReds.length === 0 ? { slot: body.provider, model: body.model } : null;
    const runModel = !noRecord && namedModel && modelReds.length === 0 && (body.provider !== record.slot || body.model !== record.model) ? { slot: body.provider, model: body.model } : null;
    const floorFacts = formFacts(read, home, runModel === null ? join(realRoot, flow) : undefined, runModel ?? newPick);
    const checked = checkValues({
    allowedKeys: RUN_KEYS, body, base: flowValues(read.arbiter), realRoot, capOnly: false, floorUsd: floorFacts.capFloorUsd, floorModel: floorFacts.floorModel, monthlyClaim,
    });
    if (!checked.ok && checked.refused) return reply(checked.status, { refused: checked.refused, say: checked.say, refusals: checked.refusals });
    /** @type {{field: string, say: string}[]} */
    const refusals = checked.ok ? [...modelReds] : [...checked.refusals, ...modelReds];
    if (!checked.ok && checked.status === 409) return reply(409, { refused: 'monthly', say: checked.say });
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
    if (refusals.length > 0 || !checked.ok) return reply(400, { refused: 'run', refusals });
    const values = runModel === null ? checked.values : { ...checked.values, model: runModel };   // the run's own model is part of what the second click signs
    const hash = valuesHash({
    flow, flowSignatureHash: read.signature.flow, runId: null, version: 0, values,
    });
    return {
    ok: /** @type {true} */ (true), flow, read, declared, rows, runId, values, differs: checked.differs || runModel !== null, hash, newPick, flowDir: join(realRoot, flow),
    };
  }

  /**
   * Why a job cannot be edited right now, in the sentence the page shows and the sign route refuses with; `null` when it can. M6 amendment 1:
   * the newest run that is running or waiting at its ask, by the panel's ONE decision (`runControls`, via `getRunControls`: `canStop`) ->
   * "finish or stop run-N first". M6 amendment 3: a start folder in phase `starting` for this flow whose child is alive (`starter.startingFor`,
   * the start door's own rule) -> "a run is starting"; a start that is done, refused or dead unlocks. A stopped, finished or expired run does not count.
   * @param {string} realRoot @param {string} name @returns {string|null}
   */
  function editBlockOf(realRoot, name) {
    const cat = loadCatalogue();
    if (!cat.ok) return null;
    if (starter.startingFor(name, []) !== null) return EDIT_STARTING_SAY;
    const ids = listRunIds(join(realRoot, name)).filter((id) => /^run-\d+$/.test(id)).sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
    for (const id of ids) {
      const c = getRunControls({ root: realRoot, flow: name, runId: id, catalogue: cat.primitives });
      if (c?.canStop === true) return editBlockedSay(id);
    }
    return null;
  }

  /** One flow's record for the page: its signed values and facts, its last run's inputs, its passed runs and its track record. @param {string} realRoot @param {string} name @param {any} read @param {any} left */
  function entryFor(realRoot, name, read, left) {
    const roles = (read.arbiter.sources ?? []).map((s) => s.role);
    const flowDir = join(realRoot, name);
    const last = lastSources(flowDir, roles);
    const { passed, stats } = runsOf(flowDir, name, read, roles);
    return {
      flow: name, capUsd: read.arbiter.capUsd, roles, nextRunId: nextRunId(flowDir), lastRunId: last.runId, lastSources: last.sources, leftThisMonth: left,
      runs: passed, stats,
      ...formFacts(read, home, flowDir),
      // M6: the job as a card to edit (`ok:true, card, flowHash` = the signature hash it is opened at), or why it cannot be (`ok:false, say`)
      edit: (() => {
        const blocked = editBlockOf(realRoot, name);
        if (blocked !== null) return { ok: false, say: blocked };
        const c = cardFromSigned(read); return c.ok ? { ok: true, card: c.card, flowHash: read.signature.flow } : c;
      })(),
    };
  }

  return {
    /** M6 amendments 1 and 3: the sentence that says why this flow cannot be edited now, or null (the sign route's check). @param {string} name */
    editBlock(name) {
      const realRoot = realRootOrNull();
      return realRoot === null ? null : editBlockOf(realRoot, name);
    },

    /**
     * M6 am5/am6: the job key of the signed flow `name` (see src/jobkey.js), or null when it is not a signed flow that reads. The draft door compares a Reuse card with it.
     * @param {string} name
     */
    signedJobKey(name) {
      const realRoot = realRootOrNull();
      if (realRoot === null || !checkFlowName(name).ok) return null;
      const read = readSigned(realRoot, name);
      return read.ok ? jobKeyOfSigned(read) : null;
    },

    /**
     * `POST /api/author/reuse-check` (M6 am6 item 2): what the ONE Reuse card's button is for the fields as typed, decided here, at $0, writes nothing.
     * Any job field changed (lines, guardrails, asks, steps) = `draft` (with the next free name); else a destination, cap or ask wait different from the
     * signed value = `sign-run` (with the hash the second click carries); else `run`. The run's colour never enters. `fromRun` (the run the card was
     * opened from) is the page's own key and is dropped before the run checks; `job` is read here and never reaches the run door.
     * @param {any} body
     */
    reuseCheck(body) {
      const { job, fromRun, ...rest } = body && typeof body === 'object' ? body : /** @type {any} */ ({});
      void fromRun;
      const realRoot = realRootOrNull();
      if (realRoot !== null && typeof job === 'string' && typeof rest.flow === 'string' && checkFlowName(rest.flow).ok) {
        const read = readSigned(realRoot, rest.flow);
        if (read.ok && jobKeyOfCard(job) !== jobKeyOfSigned(read)) {
          return { status: 200, body: { ok: true, kind: 'draft', suggestedName: suggestFlowName(realRoot, rest.flow) } };
        }
      }
      const r = this.runPrepare(rest);
      if (r.status !== 200) return r;
      return { status: 200, body: { ...r.body, kind: r.body.needsSign ? 'sign-run' : 'run' } };
    },

    /** M9: the source paths the newest run of this job used, role -> path (blank = none), for a start a trigger fires. @param {string} name @param {string[]} roles */
    lastSourcesOf(name, roles) {
      const realRoot = realRootOrNull();
      return realRoot === null ? { runId: null, sources: Object.fromEntries(roles.map((r) => [r, ''])) } : lastSources(join(realRoot, name), roles);
    },

    /** `GET /api/author/flows`. */
    flows() {
      const realRoot = realRootOrNull();
      if (realRoot === null) return { status: 200, body: { ok: true, flows: [] } };
      const left = leftThisMonth();
      const flows = [];
      for (const name of listFlowNames(realRoot)) {
        const read = readSigned(realRoot, name);
        if (!canFlowRun(read).ok) continue;   // a refused flow (unreadable, unwired verb, unbuildable check) is never listed
        const entry = entryFor(realRoot, name, read, left);
        if (entry.runs.length === 0) continue;   // amendment 7 item 7: only a flow with a passed run is listed
        flows.push(entry);
      }
      return { status: 200, body: { ok: true, flows, leftThisMonth: left } };
    },

    /**
     * `GET /api/author/run-again?flow=&runId=` (amendment 7 item 6): the Signed flow form for ONE run of a signed flow, any outcome, with that
     * run's values and input paths as `pick`. The list's rule (passed run, preflight accepts) does not apply here; a flow the run's own
     * preflight would refuse says why, in the preflight's words. Reads only.
     * @param {string|null} flow @param {string|null} runId
     */
    runAgain(flow, runId) {
      const no = (status, say, extra = {}) => ({ status, body: { ok: false, refused: 'run-again', say, ...extra } });
      const realRoot = realRootOrNull();
      if (realRoot === null) return no(400, 'The flows folder this panel serves does not exist.');
      // a missing query value is refused by name, never passed on as null
      if (typeof flow !== 'string' || flow === '') return no(400, 'Say which flow to run again.');
      if (typeof runId !== 'string' || runId === '') return no(400, 'Say which run to run again.');
      const named = checkFlowName(flow);
      if (!named.ok) return no(400, `${named.red}.`);
      const rr = resolveRunDir(join(realRoot, flow), runId);
      if (!rr.ok) return no(400, `${rr.red}.`);
      if (!listRunIds(join(realRoot, flow)).includes(runId)) return no(404, `"${flow}" has no run "${runId}".`);
      const readRaw = readSigned(realRoot, flow);
      const can = canFlowRun(readRaw);
      if (!can.ok) {
        const red = scrub(String(can.red), providerKeys(loadEnv()));
        return no(409, willNotRunSay(flow, red), { red });
      }
      const read = /** @type {Extract<typeof readRaw, { ok: true }>} */ (readRaw); // canFlowRun refuses every failed read above
      const roles = (read.arbiter.sources ?? []).map((s) => s.role);
      return {
        status: 200,
        body: {
          ok: true, flow: entryFor(realRoot, flow, read, leftThisMonth()), pick: { runId, ...runValuesOf(read, flow, rr.runDir), sources: sourcesOf(rr.runDir, roles) },
        },
      };
    },

    /**
     * `POST /api/author/run-prepare` (the first click of "Sign & run"): the same $0 checks as `run`, never starts anything and writes nothing.
     * `needsSign` = the Destination, Cap $ or an ask wait differs from the flow's signed value, so the start needs the human's second click
     * carrying `hash` (amendment 5 item 3); false = a plain Run (one click).
     * @param {any} body
     */
    runPrepare(body) {
      const s = inspect(body, loadEnv());
      if (!s.ok) return s.reply;
      return {
        status: 200, body: {
          ok: true, flow: s.flow, needsSign: s.differs, hash: s.differs ? s.hash : null, values: s.values, capUsd: s.values.capUsd,
        },
      };
    },

    /**
     * `POST /api/author/run`: $0 checks -> the one start. A refusal names the box, spends $0 and creates nothing. A run whose Destination, Cap $
     * or ask wait differs from the flow's signed values starts only with the `hash` of those values (the human's second click, like page
     * sign): none or a stale one signs nothing and starts nothing. The signed values are written once into the run's own folder first.
     * @param {any} body
     */
    run(body) {
      const loaded = loadEnv();
      if (!loaded.ok) return { status: 409, body: { ok: false, refused: 'keys-file', say: String(loaded.refusal) } };
      const s = inspect(body, loaded);
      if (!s.ok) return s.reply;
      let values = null;
      if (s.differs) {
        if (typeof body.hash !== 'string' || body.hash === '') {
          return { status: 409, body: { ok: false, refused: 'needs-sign', say: 'This run changes the destination, the cap or an ask wait, so it has to be signed: use Sign & run (two clicks). Nothing was started.' } };
        }
        if (body.hash !== s.hash) {
          return { status: 409, body: { ok: false, refused: 'stale-hash', say: 'What you were shown is not what is on the card now (its hash differs). Nothing was signed. Look again, then sign.' } };
        }
        values = {
          flow: s.flow, flowSignatureHash: s.read.signature.flow, version: 0, values: s.values, hash: s.hash, signedBy: userInfo().username, at: new Date().toISOString(),
        };
      }
      const started = starter.start({
        kind: 'run', flow: s.flow, runId: s.runId, sources: s.declared.map((role) => ({ role, path: /** @type {{path: string}} */ (s.rows.find((r) => r.role === role)).path })), values, pick: s.newPick,
      }, loaded);
      // M4d amendment 7b: the pick of a flow that had no record is written only once the start succeeded (a refused start leaves none), beside the signed files, never in them
      if (started.status === 202 && s.newPick !== null) {
        try { writeModelRecord(s.flowDir, s.newPick); } catch { /* a record that appeared meanwhile stays: written once */ }
      }
      return started;
    },
  };
}
