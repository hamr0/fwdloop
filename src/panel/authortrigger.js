// M9 pieces 3 and 4 (docs/wiki/the-module-ladder.md, "M9" items 1-6, am1, am2) and M9 am20: the SCHEDULE door of the panel's backend.
//
//   prepare(body)  POST /api/author/trigger-prepare  { flow, trigger }        the first click: every $0 check, signs nothing, returns the hash
//   set(body)      POST /api/author/trigger          { flow, trigger, hash }  the second click: writes `<flow>/schedule.json` (signed by the human) and arms it;
//                                                                             trigger null = Cancel. The JOB is never opened for writing: its signature never changes.
//   read(flow)     the one read function the cards use: the trigger, whether it is armed, the next slot, the last outcome. No words.
//   fire(...)      one fire's outcome, in order: busy -> monthly -> sources -> the ONE start. Every outcome is a `triggers.jsonl` row.
//
// ONE WRITER PER FIELD: `set` writes the schedule (through `writeSchedule` in src/schedule.js); `armFor` writes the armed row and the baseline;
// `recordFire` / the file trigger's `poll` write the fire / ran rows BEFORE a start (a crash loses a run, never doubles one); `appendOutcome` writes
// `triggers.jsonl`. Nothing here is read from a model: the schedule is typed data signed by a human.
//
// Files, per job, under `<flowDir>/`:
//   schedule.json                        the current signed schedule (M9 am20): the trigger and what a fire uses (plan, inputs, model, destination)
//   schedule-ledger.jsonl                ONE queue file for the life of the job: clock and file rows, each with `sig` = the signing that wrote it
//   triggers.jsonl                       append-only history of every fire outcome (rows of this signing carry its `sig`)
// An old trigger LINE inside a job's prose (signed before am20) is never read by this door: nothing fires, nothing arms.
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { flowValues, valuesHash } from '../runvalues.js';
import { destinationRefusal, checkInputRows, runInputRows } from './authorcard.js';
import { endRow, readHistory } from '../books.js';
import { appendRow } from '../jsonl-append.js';
import { loadCatalogue } from '../catalogue.js';
import { canFlowRun, willNotRunSay } from '../canrun.js';
import {
  FLOW_FILES, checkFlowName, listFlowNames, listRunIds, planForReuse, readFileInside, readFlow, readRunJobCopy, resolveRunDir,
} from '../flow.js';
import { scheduleHead, scheduledWords } from '../summary-words.js';
import { armTrigger, nextSlot, readRows, validateSchedule } from '../trigger-clock.js';
import { checkTarget, createFileTrigger } from '../trigger-files.js';
import { WATCHABLE, ticketListsOf } from '../trigger-tickets.js';
import { readModelRecord } from '../flowmodel.js';
import { pageAddressesOf, pageAddressRefusal } from '../pagefetch.js';
import {
  carryQueue, dropQueue, finishCarry, isArmed, ledgerOf, readSchedule, recordCancelled, removeSchedule, sameTarget, sigOf, writeSchedule,
} from '../schedule.js';
import { triggerHash, triggerLine } from '../trigger-line.js';

/** @typedef {import('../trigger-line.js').Trigger} Trigger */
/** @typedef {import('../schedule.js').Schedule} Schedule */

/** A trigger in the words a row and a run reason use: `daily 09:00`, `new-file jd = file:/home/you/inbox`. @param {Trigger} t */
const describe = (t) => triggerLine(t).replace('guardrail: trigger ', '');

/** M12: the one tool a ticket schedule's look uses, signed with the schedule's two clicks. */
export const TICKET_LOOK_TOOL = 'list_issues';
export const NO_GREEN_SAY = 'This job has not had a good run yet. Run it once by hand and get it right first; then you can set when it runs. Nothing was changed.';
const HISTORY_FILE = 'triggers.jsonl';

/** Every fire outcome of a job, oldest first, through the safe gateway. @param {string} flowDir @returns {any[]} */
export function readOutcomes(flowDir) {
  const f = readFileInside(flowDir, HISTORY_FILE);
  if (!f.ok) return [];
  return f.text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/** The ONE writer of `triggers.jsonl`: append-only, one line per fire outcome. @param {string} flowDir @param {Record<string, any>} row */
export function appendOutcome(flowDir, row) {
  appendRow(join(flowDir, HISTORY_FILE), row, { mode: 0o600 });
}

/**
 * M9 item 1 and 2: does this job have "one green run"? The ONE function that decides it. A passed run counts when the job it ran (its own
 * `job/` copy) is the job as it is now (prose and declaration, byte for byte: a schedule is its own file, so setting one never changes the job).
 * A run from before runs kept a job copy has none to compare, so it counts only when its history row's signature is the job's current one.
 * @param {string} flowDir
 */
export function hasGreenRunForJob(flowDir) {
  const cur = {};
  for (const f of FLOW_FILES) {
    const r = readFileInside(flowDir, f);
    if (!r.ok) return false;
    cur[f] = r.text;
  }
  let sig;
  try { sig = JSON.parse(cur['signature.json']).flow; } catch { return false; }
  const key = (/** @type {string} */ prose, /** @type {string} */ decl) => `${prose.trimEnd()}\n\u0000${decl}`;
  const want = key(cur['prose.txt'], cur['declaration.json']);
  const history = readHistory(flowDir);
  for (const id of listRunIds(flowDir)) {
    const r = resolveRunDir(flowDir, id);
    if (!r.ok) continue;
    const end = endRow(history, r.runDir, id);
    if (end === null || end.outcome !== 'complete') continue;
    const prose = readFileInside(r.runDir, 'job/prose.txt');
    const decl = readFileInside(r.runDir, 'job/declaration.json');
    if (prose.ok && decl.ok) { if (key(prose.text, decl.text) === want) return true; } else if (!prose.ok && prose.missing && end.signatureHash === sig) return true;
  }
  return false;
}

/**
 * The ONE writer of "this schedule was set": the starting point (am2 item 2). Idempotent per signing. A file kind records what is already there first
 * (never runs; `baseline: false` = the folder is the same as the earlier signing's, whose rows were carried), then the armed row. Throws, naming why,
 * when the target is not usable now.
 * @param {string} flowDir @param {Schedule} schedule @param {number} now epoch ms @param {{baseline?: boolean}} [o]
 * @returns {{armed: boolean, already: boolean}}
 */
export function armFor(flowDir, schedule, now, o = {}) {
  const ledger = ledgerOf(flowDir);
  const { sig, trigger } = schedule;
  if (isArmed(flowDir, sig)) return { armed: true, already: true };
  if (o.baseline !== false) {
    if (trigger.kind === 'file-updated') createFileTrigger({ mode: 'updated', target: trigger.path, ledger, sig }).arm();
    else if (trigger.kind === 'new-file') createFileTrigger({ mode: 'new', target: trigger.folder, ledger, sig }).arm();
  }
  armTrigger(ledger, now, sig);
  return { armed: true, already: false };
}

/**
 * The trigger a body asks for, checked as data: null (By hand) or exactly one of the five shapes, the role one of the job's inputs, a full
 * path. Returns the typed trigger or the sentence that says what to fix.
 * @param {unknown} t @param {string[]} roles
 * @returns {{ok: true, trigger: Trigger|null} | {ok: false, say: string}}
 */
function shapeOf(t, roles) {
  if (t === null) return { ok: true, trigger: null };
  if (!t || typeof t !== 'object' || Array.isArray(t)) return { ok: false, say: 'Pick when it runs from the choices. A schedule is not typed as text. Nothing was changed.' };
  const o = /** @type {Record<string, unknown>} */ (t);
  if (o.kind === 'file-updated' || o.kind === 'new-file') {
    const where = o.kind === 'new-file' ? 'folder' : 'path';
    const extra = Object.keys(o).filter((k) => !['kind', 'role', where].includes(k));
    if (extra.length > 0) return { ok: false, say: `A "${o.kind}" trigger takes a kind, a role and a ${where}, not "${extra[0]}". Nothing was changed.` };
    if (typeof o.role !== 'string' || !roles.includes(o.role)) return { ok: false, say: `This job has no input named "${String(o.role)}" (it takes: ${roles.join(', ') || 'none'}). Pick one of those. Nothing was changed.` };
    const p = o[where];
    // eslint-disable-next-line no-control-regex
    if (typeof p !== 'string' || p === '' || !isAbsolute(p) || /[\x00-\x1f\x7f]/.test(p)) return { ok: false, say: `The ${where} must be a full path on one line, like /home/you/inbox. Nothing was changed.` };
    return { ok: true, trigger: /** @type {Trigger} */ (o.kind === 'new-file' ? { kind: 'new-file', role: o.role, folder: p } : { kind: 'file-updated', role: o.role, path: p }) };
  }
  if (o.kind === 'new-ticket') {
    // M12 piece 2: the person picks the input; the list address, the job's server and the look's tool are filled from the signed job (inspect), never typed here
    const extra = Object.keys(o).filter((k) => !['kind', 'role', 'watch'].includes(k));
    if (extra.length > 0) return { ok: false, say: `A "new-ticket" trigger takes a kind and a role, not "${extra[0]}". Nothing was changed.` };
    if (typeof o.role !== 'string' || !roles.includes(o.role)) return { ok: false, say: `This job has no input named "${String(o.role)}" (it takes: ${roles.join(', ') || 'none'}). Pick one of those. Nothing was changed.` };
    if (o.watch !== undefined && !(Array.isArray(o.watch) && o.watch.every((w) => WATCHABLE.includes(w)))) return { ok: false, say: `A ticket schedule can watch only ${WATCHABLE.join(' and ')}. Nothing was changed.` };
    return { ok: true, trigger: /** @type {Trigger} */ ({ kind: 'new-ticket', role: o.role, list: '', server: '', tool: '', ...(o.watch ? { watch: o.watch } : {}) }) };
  }
  try { return { ok: true, trigger: validateSchedule(t) }; } catch (e) { return { ok: false, say: `${/** @type {Error} */ (e).message}. Nothing was changed.` }; }
}

/**
 * @param {{ root: string, flowsDoor: ReturnType<typeof import('./authorflows.js').createFlowsDoor>, starter: ReturnType<typeof import('./authorstart.js').createStarter>, loadEnv: () => any, monthlyClaim: (usd: number) => any, modelRefusal: (card: any, loaded: any) => { field: string, say: string }[], now?: () => number }} opts
 */
export function createTriggerDoor(opts) {
  const {
    root, flowsDoor, starter, loadEnv, monthlyClaim, modelRefusal, now = Date.now,
  } = opts;

  const realRootOrNull = () => { try { return realpathSync(root); } catch { return null; } };

  /** @param {string} realRoot @param {string} name */
  function readSigned(realRoot, name) {
    const cat = loadCatalogue();
    if (!cat.ok) return { ok: /** @type {false} */ (false), reds: [`catalogue: ${cat.reds.join('; ')}`] };
    return readFlow({ root: realRoot, name, catalogue: cat.primitives });
  }

  /**
   * Every $0 check of a trigger change, shared by both clicks. `{ok:false, reply}` or the facts a change needs.
   * @param {any} body
   */
  function inspect(body) {
    const reply = (/** @type {number} */ status, /** @type {Record<string, any>} */ b) => ({ ok: /** @type {false} */ (false), reply: { status, body: { ok: false, ...b } } });
    const realRoot = realRootOrNull();
    if (realRoot === null) return reply(400, { refused: 'root', say: 'The flows folder this panel serves does not exist.' });
    const flow = typeof body?.flow === 'string' ? body.flow : '';
    const named = checkFlowName(flow);
    if (!named.ok) return reply(400, { refused: 'flow', say: `${named.red}.` });
    const read = readSigned(realRoot, flow);
    if (!read.ok) return reply(400, { refused: 'flow', say: `"${flow}" is not a signed flow that passes its checks, so its trigger cannot be set. Nothing was changed.` });
    const roles = (read.arbiter.sources ?? []).map((s) => s.role);
    const shaped = shapeOf(body?.trigger === undefined ? 'missing' : body.trigger, roles);
    if (!shaped.ok) return reply(400, { refused: 'bad-trigger', say: shaped.say });
    let { trigger } = shaped;
    if (trigger !== null && trigger.kind === 'new-ticket') {
      // M12 piece 2 (items 8; PRD ruling "a tool counts as used if a step or the signed schedule uses it"): the look's tool is `list_issues` on the server the job names
      const list = ticketListsOf(read.arbiter)[trigger.role];
      if (list === undefined) return reply(400, { refused: 'bad-trigger', say: `The input "${trigger.role}" is not a ticket list (a GitHub issues address such as https://github.com/owner/repo/issues), so no new ticket can start a run from it. Nothing was changed.` });
      const server = read.declaration?.mcp?.server;
      if (typeof server !== 'string') return reply(400, { refused: 'bad-trigger', say: 'This job names no MCP server, so the ticket list cannot be looked at. Nothing was changed.' });
      // signed M12 item 7: the fields to watch come from the signed job (`ticketWatch`) unless the click itself names them; a job that names none watches nothing
      const jobWatch = read.declaration?.ticketWatch;
      const watch = trigger.watch ?? (Array.isArray(jobWatch) && jobWatch.length > 0 ? jobWatch : undefined);
      trigger = { kind: trigger.kind, role: trigger.role, list, server, tool: TICKET_LOOK_TOOL, ...(watch ? { watch } : {}) };
    }
    const flowDir = join(realRoot, flow);
    if (trigger !== null && !hasGreenRunForJob(flowDir)) return reply(409, { refused: 'no-green-run', say: NO_GREEN_SAY });
    // M9 am20 item 3: neither Cancel nor a new schedule is refused because a run is starting, working or waiting: a run carries on from its own copy and
    // keeps its own signed values; the next fire uses the new schedule. (A schedule never touches the job, so there is nothing for a run to collide with.)
    const fileTrigger = trigger !== null && (trigger.kind === 'file-updated' || trigger.kind === 'new-file') ? trigger : null;
    if (fileTrigger !== null && Object.hasOwn(pageAddressesOf(read.arbiter), fileTrigger.role)) {
      return reply(400, { refused: 'bad-trigger', say: `The input "${fileTrigger.role}" is a web page, not a file, so no file arrival can start a run from it. Nothing was changed.` }); // M10 am3
    }
    if (fileTrigger !== null) {
      try {
        checkTarget(fileTrigger.kind === 'new-file' ? 'new' : 'updated', fileTrigger.kind === 'new-file' ? fileTrigger.folder : fileTrigger.path);
      } catch (e) {
        return reply(400, { refused: 'bad-trigger', say: `${/** @type {Error} */ (e).message}. Nothing was changed.` });
      }
      // a file that does not exist yet may arrive (checkTarget allows it), but its folder must be there: a typo is caught now, not never
      if (fileTrigger.kind === 'file-updated') {
        try { realpathSync(dirname(fileTrigger.path)); } catch { return reply(400, { refused: 'bad-trigger', say: `The folder of ${fileTrigger.path} does not exist. Nothing was changed.` }); }
      }
    }
    // M6 am5 item 3: a schedule may carry the model of the run it was made from (a run field). Checked now by the Run door's own model check; the same as
    // the job's recorded model is no change (null). It is bound into the hash, written beside the trigger's ledger, and read by the fire.
    let scheduledModel = null;
    if (trigger !== null && (typeof body?.provider === 'string' || typeof body?.model === 'string') && (body.provider !== '' || body.model !== '')) {
      const loaded = loadEnv();
      if (!loaded.ok) return reply(409, { refused: 'keys-file', say: String(loaded.refusal) });
      const says = modelRefusal({ provider: body.provider, model: body.model }, loaded);
      if (says.length > 0) return reply(400, { refused: 'bad-model', say: says[0].say, refusals: says });
      const rec0 = readModelRecord(flowDir);
      if (rec0 === null || rec0.slot !== body.provider || rec0.model !== body.model) scheduledModel = { slot: body.provider, model: body.model };
    }
    // M6 am5 item 3, the rest: the scheduled run's DESTINATION and INPUTS, bound the same way (hash, then a file beside the ledgers, then each fired run's values).
    // A destination equal to the flow's is no change. The same checks as Sign & run (M4e am5 item 4); the input roles are exactly the job's.
    let scheduledDestination = null;
    let scheduledInputs = null;
    if (trigger !== null) {
      const own = flowValues(read.arbiter).destination;
      if (typeof body?.destination === 'string' && body.destination.trim() !== '' && body.destination.trim() !== own) {
        if (own === null) return reply(400, { refused: 'bad-destination', say: 'This flow has no send step, so there is no destination to schedule. Nothing was changed.' });
        const why = destinationRefusal(body.destination.trim(), realRoot);
        if (why !== null) return reply(400, { refused: 'bad-destination', say: `${why} Nothing was changed.` });
        scheduledDestination = body.destination.trim();
      }
      if (Array.isArray(body?.inputs)) {
        // M10 am3: a page input's address is the job's, signed: a blank row is the signed one, any other address is refused naming the input
        const pages = pageAddressesOf(read.arbiter);
        const rows = runInputRows(body.inputs).map((r) => (Object.hasOwn(pages, r.role) && r.path === '' ? { ...r, path: pages[r.role] } : r));
        const declared = roles;
        const bad = [...checkInputRows(rows)];
        rows.forEach((r, n) => { if (Object.hasOwn(pages, r.role) && r.path !== pages[r.role]) bad.push({ field: `inputs.${n}`, say: pageAddressRefusal(r.role, pages[r.role]) }); });
        for (const role of declared) if (!Object.hasOwn(pages, role) && !rows.some((r) => r.role === role)) bad.push({ field: 'inputs', say: `This flow needs an input named "${role}". Add it.` });
        for (const r of rows) if (!declared.includes(r.role)) bad.push({ field: 'inputs', say: `This flow has no input named "${r.role}" (it takes: ${declared.join(', ') || 'none'}).` });
        if (bad.length > 0) return reply(400, { refused: 'bad-inputs', say: `${bad[0].say} Nothing was changed.`, refusals: bad });
        scheduledInputs = declared.map((role) => ({ role, path: Object.hasOwn(pages, role) ? pages[role] : /** @type {{path: string}} */ (rows.find((r) => r.role === role)).path }));
      }
    }
    // M6 am9: the schedule uses the plan of the run it was set from. The workflow's own plan = nothing to bind; a different kept plan is verified now and
    // bound into the hash (the run, that plan's signature and the sha of its declaration), so the second click signs exactly this plan.
    let scheduledPlan = null;
    let scheduledFrom = null;
    const planOf = typeof body?.planOf === 'string' ? body.planOf.trim() : '';
    if (trigger !== null && planOf !== '') {
      const rr = resolveRunDir(flowDir, planOf);
      if (!rr.ok) return reply(400, { refused: 'plan', say: `"${planOf}" is not a run name. Nothing was changed.` });
      const cat = loadCatalogue();
      if (!cat.ok) return reply(500, { refused: 'catalogue', say: 'The catalogue could not be read. Nothing was changed.' });
      const pf = planForReuse({ root: realRoot, name: flow, runDir: rr.runDir, catalogue: cat.primitives });
      if (!pf.ok) return reply(409, { refused: 'plan', say: pf.red.replace('Nothing was started.', 'Nothing was changed.') });
      scheduledFrom = planOf;
      if (!pf.same) {
        const decl = readFileInside(rr.runDir, 'job/declaration.json');
        if (!decl.ok) return reply(409, { refused: 'plan', say: `The plan ${planOf} kept cannot be read. Nothing was changed.` });
        scheduledPlan = { run: planOf, flowHash: String(pf.read.signature.flow), declSha: createHash('sha256').update(decl.text).digest('hex') };
      }
    }
    return {
      ok: /** @type {true} */ (true), flow, read, trigger, flowDir, realRoot,
      model: scheduledModel, destination: scheduledDestination, inputs: scheduledInputs, plan: scheduledPlan, from: scheduledFrom,
      hash: triggerHash({ flow, flowSignatureHash: read.signature.flow, trigger, model: scheduledModel, destination: scheduledDestination, inputs: scheduledInputs, plan: scheduledPlan }),
    };
  }

  /**
   * The schedule of this job as it counts NOW: its `schedule.json`, read and checked, and only while it was set for THIS job as it is (an Edit signs a new job,
   * M9 am1: the job is By hand again; the scheduler cancels the stale file with Cancel's own words). `null` = By hand. @param {string} flowDir @param {string} jobHash
   */
  function liveSchedule(flowDir, jobHash) {
    const sc = readSchedule(flowDir);
    return sc !== null && sc.flowSignatureHash === jobHash ? sc : null;
  }

  /**
   * THE one cancel: every waiting file leaves its queue with am16's row, a `cancelled` row is written, then `schedule.json` is removed. Used by the Cancel
   * click and by the scheduler for a schedule whose job was Edited. @param {string} flow @param {string} flowDir @param {Schedule} cur
   */
  function cancelSchedule(flow, flowDir, cur) {
    const at = now();
    dropQueue(flowDir, cur.sig, at, (row) => appendOutcome(flowDir, { at: new Date(at).toISOString(), flow, trigger: 'By hand', sig: cur.sig, ...row }));
    recordCancelled(flowDir, cur.sig, at);
    removeSchedule(flowDir);
  }

  return {
    /** `POST /api/author/trigger-prepare`: the first click. Checks, signs and writes nothing. @param {any} body */
    prepare(body) {
      const s = inspect(body);
      if (!s.ok) return s.reply;
      return { status: 200, body: { ok: true, flow: s.flow, trigger: s.trigger, words: scheduledWords(s.trigger), hash: s.hash } };
    },

    /**
     * `POST /api/author/trigger`: the second click, carrying the hash it was shown. Writes `schedule.json` (signed by the human who clicked) and arms it, or
     * (trigger null) cancels. The job's files are never opened for writing. $0: no drafter, no run. A run that is starting, working or waiting is never touched.
     * @param {any} body
     */
    set(body) {
      const s = inspect(body);
      if (!s.ok) return s.reply;
      if (typeof body.hash !== 'string' || body.hash !== s.hash) {
        return { status: 409, body: { ok: false, refused: 'stale-hash', say: 'What you were shown is not what is on the card now (its hash differs). Nothing was signed. Look again, then sign.' } };
      }
      const cur = readSchedule(s.flowDir);
      if (s.trigger === null) {
        if (cur !== null) cancelSchedule(s.flow, s.flowDir, cur);
        return { status: 200, body: { ok: true, flow: s.flow, trigger: null, words: scheduledWords(null), armed: true } };
      }
      const at = now();
      const signedAt = new Date(at).toISOString();
      const bound = s.hash;
      /** @type {Schedule} */
      const schedule = {
        v: 1, flow: s.flow, trigger: s.trigger, flowSignatureHash: s.read.signature.flow, bound, sig: sigOf(bound, signedAt), signedBy: userInfo().username, signedAt,
        model: s.model, destination: s.destination, inputs: s.inputs, plan: s.plan, from: s.from,
      };
      const keep = cur !== null && sameTarget(cur.trigger, s.trigger);
      try {
        if (cur !== null && keep) carryQueue(s.flowDir, cur.sig, schedule.sig);
        armFor(s.flowDir, schedule, at, { baseline: !keep });
      } catch (e) {
        return { status: 409, body: { ok: false, refused: 'not-armed', say: `The schedule was not signed: ${/** @type {Error} */ (e).message}. Nothing was changed.` } };
      }
      writeSchedule(s.flowDir, schedule);
      if (cur !== null && keep) finishCarry(s.flowDir, cur.sig, at);
      // a changed folder drops the queue of the earlier signing, with am16's row, in this same click, but only now that the new schedule is armed and
      // written: everything that can refuse (arm) came first, so "Nothing was changed" is true. A crash between the write and the drop leaves the old
      // signing's files unrun (the old sig is not live) without their row; it never runs one twice and never fires unsigned.
      if (cur !== null && !keep) dropQueue(s.flowDir, cur.sig, at, (row) => appendOutcome(s.flowDir, { at: signedAt, flow: s.flow, trigger: describe(cur.trigger), sig: cur.sig, ...row }));
      return { status: 200, body: { ok: true, flow: s.flow, trigger: s.trigger, words: scheduledWords(s.trigger), flowHash: s.read.signature.flow, sig: schedule.sig, armed: true } };
    },

    /** Every job with a live schedule, as the scheduler needs it: `{flow, flowDir, read, schedule, trigger, sig}`. Reads each job the way the CLI will (signature verified). */
    scan() {
      const realRoot = realRootOrNull();
      if (realRoot === null) return [];
      const jobs = [];
      for (const flow of listFlowNames(realRoot)) {
        const flowDir = join(realRoot, flow);
        if (readSchedule(flowDir) === null) continue;   // the cheap test first: most jobs have none
        const read = readSigned(realRoot, flow);
        if (!read.ok) continue;
        const schedule = liveSchedule(flowDir, read.signature.flow);
        if (schedule !== null && isArmed(flowDir, schedule.sig)) jobs.push({ flow, flowDir, read, schedule, trigger: schedule.trigger, sig: schedule.sig });
      }
      return jobs;
    },

    /** A schedule whose job was Edited since (M9 am1: By hand again) is cancelled the way Cancel does it, once. Called at the top of every scheduler tick. */
    retireStale() {
      const realRoot = realRootOrNull();
      if (realRoot === null) return;
      for (const flow of listFlowNames(realRoot)) {
        const flowDir = join(realRoot, flow);
        const sc = readSchedule(flowDir);
        if (sc === null) continue;
        const read = readSigned(realRoot, flow);
        if (read.ok && sc.flowSignatureHash !== read.signature.flow) cancelSchedule(flow, flowDir, sc);
      }
    },

    /** M9 am3/am8: is a run of this job starting or still working? A run waiting at its ask is not busy. (the same check `fire` makes first) @param {{flow: string}} job */
    busy(job) {
      return flowsDoor.scheduleBusy(job.flow) !== null;
    },

    /** M9 am3: one row for a queued file that is not a fire (deleted / changed before its turn). @param {{flow: string, flowDir: string, trigger: Trigger, sig: string}} job @param {Record<string, any>} row */
    note(job, row) {
      appendOutcome(job.flowDir, { at: new Date(now()).toISOString(), flow: job.flow, trigger: describe(job.trigger), sig: job.sig, ...row });
    },

    /**
     * One row in `triggers.jsonl` that is not a fire (the trigger could not be watched). @param {{flow: string, flowDir: string, trigger: Trigger, sig: string}} job @param {string} why
     */
    refuse(job, why) {
      appendOutcome(job.flowDir, {
        at: new Date(now()).toISOString(), flow: job.flow, trigger: describe(job.trigger), sig: job.sig, outcome: 'refused', why,
      });
    },

    /**
     * M9 item 3-5: one fire, in this order, each outcome ONE row in `triggers.jsonl`: busy -> monthly-exhausted -> refused (an input or the keys
     * are missing) -> started through the ONE start path (kind `trigger`; the reason and the catch-up mark go into the run's own folder first).
     * The fire / ran ledger row was written by the caller BEFORE this, so a crash loses a run and never doubles one.
     * @param {{flow: string, flowDir: string, read: any, trigger: Trigger, schedule: Schedule}} job
     * @param {{kind: 'clock', slot: number, catchUp: boolean, missed: number} | {kind: 'file', path: string, sha: string} | {kind: 'ticket', number: number, sha: string, role: string, list: string, why?: string}} cause
     * @param {{ told?: (row: Record<string, any>) => boolean, beforeStart?: () => void, holdIfCannotStart?: boolean }} [hooks] M9 am3 (a queued file): `told(row)` true = this file
     *   already has a row for that outcome and reason (`why`), so none is written again (the outcome is still returned); `beforeStart` runs right before the ONE
     *   start, once every check has passed: the scheduler writes the file's `ran` row there. `holdIfCannotStart` (a queued file, M9 am17): the starter's `canStart` is asked first, and a no writes nothing
     *   (no row, no `beforeStart`) and returns outcome `cannot-start`.
     */
    fire(job, cause, hooks = {}) {
      const {
        flow, flowDir, read: flowRead, trigger, schedule,
      } = job;
      let read = flowRead;   // the plan this fire runs: the workflow's own, or (M6 am9) the kept plan of the run the schedule was set from
      const desc = describe(trigger);
      const base = {
        at: new Date(now()).toISOString(), flow, trigger: desc, sig: schedule.sig,
        ...(cause.kind === 'clock' ? { slot: new Date(cause.slot).toISOString(), catchUp: cause.catchUp, missed: cause.missed } : cause.kind === 'ticket' ? { ticket: cause.number, sha: cause.sha, catchUp: false } : { file: cause.path, sha: cause.sha, catchUp: false }),
      };
      const done = (/** @type {Record<string, any>} */ r) => { const row = /** @type {Record<string, any>} */ ({ ...base, ...r }); if (!(row.outcome !== 'started' && hooks.told?.(row))) appendOutcome(flowDir, row); return row; };
      const busy = flowsDoor.scheduleBusy(flow);   // M9 am8: one WORKING run at a time per job; a run waiting at its ask does not block
      if (busy !== null) return done({ outcome: 'busy', say: busy });
      // M6 am9: a schedule set from a run that kept another plan runs THAT plan; it is re-verified now, against what the second click signed
      let planRun = null;
      const planRec = schedule.plan;
      if (planRec !== null) {
        const cat = loadCatalogue();
        const rr = resolveRunDir(flowDir, planRec.run);
        const kept = rr.ok && cat.ok ? readRunJobCopy(rr.runDir, cat.primitives) : null;
        const decl = rr.ok ? readFileInside(rr.runDir, 'job/declaration.json') : null;
        const good = kept && kept.present && kept.ok && kept.signature.flow === planRec.flowHash && decl && decl.ok && createHash('sha256').update(decl.text).digest('hex') === planRec.declSha;
        if (!good) return done({ outcome: 'refused', why: `The plan of ${planRec.run} is no longer the one that was signed, so nothing started. Set the schedule again.` });
        read = /** @type {any} */ (kept);
        planRun = planRec.run;
      }
      // the Run door's own `canFlowRun` (a retired check form, an unwired verb), on the plan this fire runs, in the Run door's own sentence: refused at $0, nothing started
      const can = canFlowRun(read);
      if (!can.ok) return done({ outcome: 'refused', why: willNotRunSay(flow, String(can.red)) });
      const claim = monthlyClaim(read.arbiter.capUsd);   // the same check the Run door decides on
      if (claim && 'problem' in claim) return done({ outcome: 'refused', why: `${claim.problem}. Nothing spent.` });
      if (claim && !claim.ok) return done({ outcome: 'monthly-exhausted', leftUsd: claim.room.leftUsd, needUsd: claim.room.needUsd, atLeast: claim.room.atLeast === true });
      const roles = (read.arbiter.sources ?? []).map((x) => x.role);
      // M6 am5 item 3: the scheduled run's inputs, when the schedule carries them; else the newest run's (as before). A file trigger's own role is always the arriving file.
      let last = flowsDoor.lastSourcesOf(flow, roles).sources;
      if (schedule.inputs !== null) last = { ...last, ...Object.fromEntries(schedule.inputs.map((r) => [r.role, r.path])) };
      const sources = [];
      const pages = pageAddressesOf(read.arbiter);
      for (const role of roles) {
        if (cause.kind === 'ticket' && cause.role === role) { sources.push({ role, path: pages[role], ticket: cause.number }); continue; }   // M12: this run's input is ONE ticket of the signed list
        if (Object.hasOwn(pages, role)) { sources.push({ role, path: pages[role] }); continue; } // M10 am3: a page input is its signed address, never an earlier run's or an arriving file
        const p = 'role' in trigger && trigger.role === role && cause.kind === 'file' ? cause.path : last[role];
        if (!p) return done({ outcome: 'refused', why: `There is no earlier run of this job to take the input "${role}" from. Run it by hand once with that input. Nothing started.` });
        try { sources.push({ role, path: realpathSync(p) }); } catch { return done({ outcome: 'refused', why: `The input "${role}" is not there (${p}). Nothing started.` }); }
      }
      const loaded = loadEnv();
      if (!loaded.ok) return done({ outcome: 'refused', why: String(loaded.refusal) });
      // the Run door's model check (its one `modelRefusal`), on the job's recorded model: a trigger picks no model, so a job without a record, or whose
      // line is no longer ticked / priced / keyed in Settings, is refused here at $0, never started
      const jobRec = readModelRecord(flowDir);
      if (jobRec === null) return done({ outcome: 'refused', why: 'This job has no model recorded, so it cannot start by itself. Run it by hand once from the Chat card and pick a model. Nothing started.' });
      // M6 am5 item 3: the model this schedule was signed with (a run field) wins over the job's recorded one; it is signed into the run's own values
      let rec = jobRec; let values = null;
      if (schedule.model !== null) rec = schedule.model;
      const destination = schedule.destination;
      if (destination !== null) {
        const why = destinationRefusal(destination, realpathSync(root));   // the Sign & run checks, again at the moment of use
        if (why !== null) return done({ outcome: 'refused', why: `${why} Nothing started.` });
      }
      if (rec !== jobRec || destination !== null) {
        const vals = { ...flowValues(read.arbiter), ...(destination !== null ? { destination } : {}), ...(rec !== jobRec ? { model: rec } : {}) };
        values = { flow, flowSignatureHash: read.signature.flow, version: 0, values: vals, hash: valuesHash({ flow, flowSignatureHash: read.signature.flow, runId: null, version: 0, values: vals }), signedBy: userInfo().username, at: new Date(now()).toISOString() };
      }
      const modelSays = modelRefusal({ provider: rec.slot, model: rec.model }, loaded);
      if (modelSays.length > 0) return done({ outcome: 'refused', why: modelSays[0].say.replace(/ Nothing was spent\.$/, '. Nothing started.') });
      const catchUp = base.catchUp === true;
      const record = {
        kind: cause.kind, trigger: desc, reason: `Started by the trigger: ${desc}${catchUp ? ' (catch-up)' : ''}`, catchUp, ...(cause.kind === 'clock' ? { slot: new Date(cause.slot).toISOString(), missed: cause.missed } : cause.kind === 'ticket' ? { ticket: cause.number, sha: cause.sha, ...(cause.why ? { why: cause.why } : {}) } : { file: cause.path, sha: cause.sha }),
        // M9 am6: typed facts for the run's Job tab and Audit (their words are built from these, in src/summary-words.js, never here)
        triggerKind: trigger.kind, words: scheduleHead(trigger), at: base.at, ...(cause.kind === 'clock' ? { lateMin: Math.max(0, Math.round((now() - cause.slot) / 60_000)) } : {}),
        sig: schedule.sig, ...(schedule.from ? { fromRun: schedule.from } : {}),
      };
      if (hooks.holdIfCannotStart === true && starter.canStart({ flow, runId: '', planRun: false }, loaded) !== null) return { ...base, outcome: 'cannot-start' };   // M9 am17: nothing written, the file stays queued for the next turn
      hooks.beforeStart?.();
      const started = starter.start({
        kind: 'trigger', flow, runId: '', sources, trigger: record, values, planOf: planRun,
      }, loaded);
      if (started.status !== 202) return done({ outcome: 'refused', why: String(started.body.say ?? 'The run did not start.') });
      return done({ outcome: 'started', runId: started.body.runId, startId: started.body.startId });
    },

    /**
     * What a card shows of a job's schedule, as data (no words): the trigger (null = By hand), whether it is armed, the next slot (clock kinds), the last
     * fire outcome of THIS signing (rows with its `sig`, never a wall-clock compare). `null` when the job is not a readable signed job.
     * @param {string} flow
     */
    read(flow) {
      const realRoot = realRootOrNull();
      if (realRoot === null || !checkFlowName(flow).ok) return null;
      const r = readSigned(realRoot, flow);
      if (!r.ok) return null;
      const flowDir = join(realRoot, flow);
      const sc = liveSchedule(flowDir, r.signature.flow);
      const trigger = sc === null ? null : sc.trigger;
      const armedRow = sc === null ? undefined : readRows(ledgerOf(flowDir), sc.sig).find((x) => x.kind === 'armed');
      const outcomes = sc === null ? [] : readOutcomes(flowDir).filter((o) => o.sig === sc.sig);
      const clockKind = trigger !== null && (trigger.kind === 'daily' || trigger.kind === 'weekdays' || trigger.kind === 'weekly');
      return {
        flow, trigger, flowHash: r.signature.flow, sig: sc === null ? null : sc.sig, armed: armedRow !== undefined, armedAt: armedRow ? armedRow.at : null,
        nextSlotMs: clockKind && armedRow ? nextSlot(/** @type {any} */ (trigger), now()) : null,
        lastOutcome: outcomes.length > 0 ? outcomes[outcomes.length - 1] : null,
        hasGreenRun: hasGreenRunForJob(flowDir),
      };
    },

    /**
     * M9 am6/am7: every fact the Job tab's Schedule field, a run's Audit schedule rows and the Run tab's SCHEDULE block are built from, for one job: the
     * schedule, what it is bound to (the run it was set from, model, destination, inputs: what the fire reads from `schedule.json`), the fires of this signing
     * (each one `triggers.jsonl` row with its `sig`) and the newest one. Data only; the words are `src/summary-words.js`'s. `null` when the job is not a readable signed job.
     * @param {string} flow
     */
    facts(flow) {
      const base = this.read(flow);
      if (base === null) return null;
      const realRoot = /** @type {string} */ (realRootOrNull());
      const flowDir = join(realRoot, flow);
      const read = readSigned(realRoot, flow);
      const sc = base.sig === null ? null : readSchedule(flowDir);
      const rec = readModelRecord(flowDir);
      const roles = read.ok ? (read.arbiter.sources ?? []).map((x) => x.role) : [];
      const sources = sc !== null && sc.inputs !== null ? sc.inputs.map((x) => x.path) : Object.values(flowsDoor.lastSourcesOf(flow, roles).sources).filter(Boolean);
      return {
        ...base,
        from: sc ? sc.from : null,
        model: sc && sc.model ? sc.model.model : (rec ? rec.model : null),
        destination: sc && sc.destination ? sc.destination : (read.ok ? flowValues(read.arbiter).destination : null),
        // M10: a page input shows its FULL signed address (the page cuts it with an ellipsis, the whole on hover); a file shows its name
        inputs: sources.map((p) => (Object.values(read.ok ? pageAddressesOf(read.arbiter) : {}).includes(String(p)) ? String(p) : basename(String(p)))),
        fires: base.sig === null ? [] : readOutcomes(flowDir).filter((o) => o.sig === base.sig),
        allFires: readOutcomes(flowDir),   // M9 am9 item 4: the Audit's `tries` span every signing
      };
    },

    /**
     * What the Run card's dropdown needs of one job (M9 piece 5): the typed trigger, its words, whether it is armed, and, when the job has had
     * no good run, the server's refusal sentence (the page shows it and disables the dropdown; it invents no words). `null` when the job is not a readable signed job.
     * @param {string} flow
     */
    card(flow) {
      const r = this.read(flow);
      if (r === null) return null;
      return {
        trigger: r.trigger, words: scheduledWords(r.trigger), armed: r.armed, hasGreenRun: r.hasGreenRun,
        refusal: r.hasGreenRun ? null : NO_GREEN_SAY,
      };
    },
  };
}
