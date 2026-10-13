// M9 pieces 3 and 4 (docs/wiki/the-module-ladder.md, "M9" items 1-6, am1, am2): the TRIGGER door of the panel's backend.
//
//   prepare(body)  POST /api/author/trigger-prepare  { flow, trigger }        the first click: every $0 check, signs nothing, returns the hash
//   set(body)      POST /api/author/trigger          { flow, trigger, hash }  the second click: re-signs the SAME plan with only the trigger line
//                                                                             changed (the M6 replace path), then arms it
//   read(flow)     the one read function the cards use: the trigger, whether it is armed, the next slot, the last outcome. No words.
//   fire(...)      one fire's outcome, in order: busy -> monthly -> sources -> the ONE start. Every outcome is a `triggers.jsonl` row.
//
// ONE WRITER PER FIELD: `set` writes the trigger line (through `proseWithTrigger` and `writeFlow`); `armFor` writes the armed row and the
// baseline; `recordFire` / the file trigger's `poll` write the fire / ran rows BEFORE a start (a crash loses a run, never doubles one);
// `appendOutcome` writes `triggers.jsonl`. Nothing here is read from a model: the trigger is typed data in the signed arbiter block.
//
// Files, per job, under `<flowDir>/`:
//   triggers.jsonl                       append-only history of every fire outcome (all signed triggers of the job)
//   triggers/<flowSignatureHash>/        the ledgers of ONE signed trigger. A new signing (a changed trigger, an Edit) is a new hash, so a
//     clock.jsonl                        new folder: an older trigger's rows can never carry over (a fresh folder per signature, not rows
//     seen.jsonl                         tagged by hash: nothing to filter, nothing to forget to filter). `clock.jsonl`'s `armed` row is
//                                        the one "this trigger was set" fact for BOTH kinds; `seen.jsonl` is the file kinds' sha ledger.
import {
  appendFileSync, mkdirSync, realpathSync, writeFileSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import { scrub } from '../authoring.js';
import { endRow, readHistory } from '../books.js';
import { loadCatalogue } from '../catalogue.js';
import {
  FLOW_FILES, checkFlowName, listFlowNames, listRunIds, readFileInside, readFlow, resolveRunDir, writeFlow,
} from '../flow.js';
import { parseSignedText } from '../signed-text.js';
import { armTrigger, nextSlot, readRows, validateSchedule } from '../trigger-clock.js';
import { checkTarget, createFileTrigger } from '../trigger-files.js';
import {
  proseWithTrigger, stripTrigger, triggerHash, triggerLine,
} from '../trigger-line.js';

/** @typedef {import('../trigger-line.js').Trigger} Trigger */

/** A trigger in the words a row and a run reason use: `daily 09:00`, `new-file jd = file:/home/you/inbox`. @param {Trigger} t */
const describe = (t) => triggerLine(t).replace('guardrail: trigger ', '');

const NO_GREEN_SAY = 'This job has not had a good run yet. Run it once by hand and get it right first; then you can set when it runs. Nothing was changed.';
const HISTORY_FILE = 'triggers.jsonl';
const HASH_RE = /^[0-9a-f]{64}$/;

/** The folder holding the ledgers of ONE signed trigger. @param {string} flowDir @param {string} flowHash */
export function triggerLedgerDir(flowDir, flowHash) {
  if (!HASH_RE.test(flowHash)) throw new Error('trigger ledger: the flow signature hash is not a sha256');
  return join(flowDir, 'triggers', flowHash);
}

/** Every fire outcome of a job, oldest first, through the safe gateway. @param {string} flowDir @returns {any[]} */
export function readOutcomes(flowDir) {
  const f = readFileInside(flowDir, HISTORY_FILE);
  if (!f.ok) return [];
  return f.text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/** The ONE writer of `triggers.jsonl`: append-only, one line per fire outcome. @param {string} flowDir @param {Record<string, any>} row */
export function appendOutcome(flowDir, row) {
  appendFileSync(join(flowDir, HISTORY_FILE), `${JSON.stringify(row)}\n`, { mode: 0o600 });
}

/**
 * M9 item 1 and 2: does this job have "one green run"? The ONE function that decides it. A passed run counts when the job it ran (its own
 * `job/` copy) is the current job WITHOUT its trigger line: so changing only the trigger keeps the run (item 2), and an Edit that changes
 * the steps, a guardrail or the cap does not (am1). A run from before runs kept a job copy has none to compare, so it counts only when its
 * history row's signature is the job's current one (a job signed since then is not the job it ran).
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
  const key = (/** @type {string} */ prose, /** @type {string} */ decl) => `${stripTrigger(prose).trimEnd()}\n\u0000${decl}`;
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
 * The ONE writer of "this trigger was set": the starting point (am2 item 2). Idempotent. A file kind records what is already there first
 * (never runs), then the armed row, so a failure between the two leaves it unarmed and the next call finishes it. Throws, naming why, when
 * the target is not usable now.
 * @param {string} flowDir @param {string} flowHash @param {Trigger} trigger @param {number} now epoch ms
 * @returns {{armed: boolean, already: boolean}}
 */
export function armFor(flowDir, flowHash, trigger, now) {
  const dir = triggerLedgerDir(flowDir, flowHash);
  const clock = join(dir, 'clock.jsonl');
  if (readRows(clock).some((r) => r.kind === 'armed')) return { armed: true, already: true };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (trigger.kind === 'file-updated') createFileTrigger({ mode: 'updated', target: trigger.path, ledger: join(dir, 'seen.jsonl') }).arm();
  else if (trigger.kind === 'new-file') createFileTrigger({ mode: 'new', target: trigger.folder, ledger: join(dir, 'seen.jsonl') }).arm();
  armTrigger(clock, now);
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
  try { return { ok: true, trigger: validateSchedule(t) }; } catch (e) { return { ok: false, say: `${/** @type {Error} */ (e).message}. Nothing was changed.` }; }
}

/**
 * @param {{ root: string, flowsDoor: ReturnType<typeof import('./authorflows.js').createFlowsDoor>, starter: ReturnType<typeof import('./authorstart.js').createStarter>, loadEnv: () => any, monthlyClaim: (usd: number) => any, now?: () => number }} opts
 */
export function createTriggerDoor(opts) {
  const {
    root, flowsDoor, starter, loadEnv, monthlyClaim, now = Date.now,
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
    const { trigger } = shaped;
    const flowDir = join(realRoot, flow);
    if (!hasGreenRunForJob(flowDir)) return reply(409, { refused: 'no-green-run', say: NO_GREEN_SAY });
    const blocked = flowsDoor.editBlock(flow);   // the same rule Edit uses: a run starting, running or waiting at its ask
    if (blocked !== null) return reply(409, { refused: 'run-live', say: `${blocked}. Nothing was changed.` });
    if (trigger !== null && 'role' in trigger) {
      try {
        checkTarget(trigger.kind === 'new-file' ? 'new' : 'updated', trigger.kind === 'new-file' ? trigger.folder : trigger.path);
      } catch (e) {
        return reply(400, { refused: 'bad-trigger', say: `${/** @type {Error} */ (e).message}. Nothing was changed.` });
      }
      // a file that does not exist yet may arrive (checkTarget allows it), but its folder must be there: a typo is caught now, not never
      if (trigger.kind === 'file-updated') {
        try { realpathSync(dirname(trigger.path)); } catch { return reply(400, { refused: 'bad-trigger', say: `The folder of ${trigger.path} does not exist. Nothing was changed.` }); }
      }
    }
    const proseNow = readFileInside(flowDir, 'prose.txt');
    const declNow = readFileInside(flowDir, 'declaration.json');
    if (!proseNow.ok || !declNow.ok) return reply(400, { refused: 'flow', say: `"${flow}" cannot be read. Nothing was changed.` });
    const proseText = proseWithTrigger(proseNow.text, trigger);
    const parsed = parseSignedText(proseText);
    if (!parsed.ok) return reply(400, { refused: 'bad-trigger', say: `That trigger does not fit the signed text (${parsed.reds[0]}). Nothing was changed.` });
    return {
      ok: /** @type {true} */ (true), flow, read, trigger, flowDir, realRoot, proseText, declaration: JSON.parse(declNow.text),
      hash: triggerHash({ flow, flowSignatureHash: read.signature.flow, trigger }),
    };
  }

  return {
    inspect,
    now,

    /** `POST /api/author/trigger-prepare`: the first click. Checks, signs and writes nothing. @param {any} body */
    prepare(body) {
      const s = inspect(body);
      if (!s.ok) return s.reply;
      return { status: 200, body: { ok: true, flow: s.flow, trigger: s.trigger, hash: s.hash } };
    },

    /**
     * `POST /api/author/trigger`: the second click, carrying the hash it was shown. Re-signs the SAME plan (declaration.json byte for byte,
     * prose.txt with only its trigger line changed) through the M6 replace path, then arms the trigger. $0: no drafter, no run.
     * @param {any} body
     */
    set(body) {
      const s = inspect(body);
      if (!s.ok) return s.reply;
      if (typeof body.hash !== 'string' || body.hash !== s.hash) {
        return { status: 409, body: { ok: false, refused: 'stale-hash', say: 'What you were shown is not what is on the card now (its hash differs). Nothing was signed. Look again, then sign.' } };
      }
      const cat = loadCatalogue();
      if (!cat.ok) return { status: 500, body: { ok: false, refused: 'catalogue', say: 'The catalogue could not be read. Nothing was changed.' } };
      // the setup record of how the job was made is not part of the three signed files: carry it over unchanged
      const setup = readFileInside(s.flowDir, 'setup.jsonl');
      const signedBy = userInfo().username;
      const written = writeFlow({
        root: s.realRoot, name: s.flow, proseText: s.proseText, declaration: s.declaration, signedBy, signedAt: new Date(now()).toISOString(), catalogue: cat.primitives, replaces: { flowHash: s.read.signature.flow },
      });
      if (!written.ok) return { status: 409, body: { ok: false, refused: 'sign-refused', say: 'The trigger was not signed. Nothing was changed.', reds: written.reds.map((r) => scrub(String(r), [])) } };
      if (setup.ok) { try { writeFileSync(join(s.flowDir, 'setup.jsonl'), setup.text, { flag: 'wx', mode: 0o600 }); } catch { /* the record is a courtesy; the job is signed */ } }
      let armed = true; let armSay = null;
      if (s.trigger !== null) {
        try { armFor(s.flowDir, written.signature.flow, s.trigger, now()); } catch (e) { armed = false; armSay = /** @type {Error} */ (e).message; }
      }
      return { status: 200, body: { ok: true, flow: s.flow, trigger: s.trigger, flowHash: written.signature.flow, armed, ...(armSay === null ? {} : { say: `The trigger is signed but not armed yet: ${armSay}.` }) } };
    },

    /** Every signed job that has a trigger, as the scheduler needs it: `{flow, flowDir, read, trigger}`. Reads each job the way the CLI will (signature verified). */
    scan() {
      const realRoot = realRootOrNull();
      if (realRoot === null) return [];
      const jobs = [];
      for (const flow of listFlowNames(realRoot)) {
        const read = readSigned(realRoot, flow);
        if (read.ok && read.arbiter.trigger !== null) jobs.push({ flow, flowDir: join(realRoot, flow), read, trigger: /** @type {Trigger} */ (read.arbiter.trigger) });
      }
      return jobs;
    },

    /** Arm this job's signed trigger if it is not armed yet (a crash between the sign and the arm). Idempotent; throws naming why. @param {{flowDir: string, read: any, trigger: Trigger}} job */
    ensureArmed(job) {
      return armFor(job.flowDir, job.read.signature.flow, job.trigger, now());
    },

    /**
     * One row in `triggers.jsonl` that is not a fire (the trigger could not be watched). @param {{flow: string, flowDir: string, trigger: Trigger}} job @param {string} why
     */
    refuse(job, why) {
      appendOutcome(job.flowDir, {
        at: new Date(now()).toISOString(), flow: job.flow, trigger: describe(job.trigger), outcome: 'refused', why,
      });
    },

    /**
     * M9 item 3-5: one fire, in this order, each outcome ONE row in `triggers.jsonl`: busy -> monthly-exhausted -> refused (an input or the keys
     * are missing) -> started through the ONE start path (kind `trigger`; the reason and the catch-up mark go into the run's own folder first).
     * The fire / ran ledger row was written by the caller BEFORE this, so a crash loses a run and never doubles one.
     * @param {{flow: string, flowDir: string, read: any, trigger: Trigger}} job
     * @param {{kind: 'clock', slot: number, catchUp: boolean, missed: number} | {kind: 'file', path: string, sha: string}} cause
     */
    fire(job, cause) {
      const { flow, flowDir, read, trigger } = job;
      const desc = describe(trigger);
      const base = {
        at: new Date(now()).toISOString(), flow, trigger: desc,
        ...(cause.kind === 'clock' ? { slot: new Date(cause.slot).toISOString(), catchUp: cause.catchUp, missed: cause.missed } : { file: cause.path, sha: cause.sha, catchUp: false }),
      };
      const done = (/** @type {Record<string, any>} */ r) => { const row = { ...base, ...r }; appendOutcome(flowDir, row); return row; };
      const busy = flowsDoor.editBlock(flow);   // one run at a time per job: starting, running, or waiting at its ask
      if (busy !== null) return done({ outcome: 'busy', say: busy });
      const claim = monthlyClaim(read.arbiter.capUsd);   // the same check the Run door decides on
      if (claim && 'problem' in claim) return done({ outcome: 'refused', why: `${claim.problem}. Nothing spent.` });
      if (claim && !claim.ok) return done({ outcome: 'monthly-exhausted', leftUsd: claim.room.leftUsd, needUsd: claim.room.needUsd, atLeast: claim.room.atLeast === true });
      const roles = (read.arbiter.sources ?? []).map((x) => x.role);
      const last = flowsDoor.lastSourcesOf(flow, roles).sources;
      const sources = [];
      for (const role of roles) {
        const p = 'role' in trigger && trigger.role === role && cause.kind === 'file' ? cause.path : last[role];
        if (!p) return done({ outcome: 'refused', why: `There is no earlier run of this job to take the input "${role}" from. Run it by hand once with that input. Nothing started.` });
        try { sources.push({ role, path: realpathSync(p) }); } catch { return done({ outcome: 'refused', why: `The input "${role}" is not there (${p}). Nothing started.` }); }
      }
      const loaded = loadEnv();
      if (!loaded.ok) return done({ outcome: 'refused', why: String(loaded.refusal) });
      const catchUp = base.catchUp === true;
      const record = {
        kind: cause.kind, trigger: desc, reason: `Started by the trigger: ${desc}${catchUp ? ' (catch-up)' : ''}`, catchUp, ...(cause.kind === 'clock' ? { slot: new Date(cause.slot).toISOString(), missed: cause.missed } : { file: cause.path, sha: cause.sha }),
      };
      const started = starter.start({
        kind: 'trigger', flow, runId: '', sources, trigger: record,
      }, loaded);
      if (started.status !== 202) return done({ outcome: 'refused', why: String(started.body.say ?? 'The run did not start.') });
      return done({ outcome: 'started', runId: started.body.runId, startId: started.body.startId });
    },

    /**
     * What a card shows of a job's trigger, as data (no words): the signed trigger, whether it is armed, the next slot (clock kinds), the last
     * fire outcome. `null` when the job is not a readable signed job.
     * @param {string} flow
     */
    read(flow) {
      const realRoot = realRootOrNull();
      if (realRoot === null || !checkFlowName(flow).ok) return null;
      const r = readSigned(realRoot, flow);
      if (!r.ok) return null;
      const flowDir = join(realRoot, flow);
      const { trigger } = r.arbiter;
      const clock = readRows(join(triggerLedgerDir(flowDir, r.signature.flow), 'clock.jsonl'));
      const armed = clock.find((x) => x.kind === 'armed');
      const outcomes = readOutcomes(flowDir);
      const clockKind = trigger !== null && (trigger.kind === 'daily' || trigger.kind === 'weekdays' || trigger.kind === 'weekly');
      return {
        flow, trigger, flowHash: r.signature.flow, armed: armed !== undefined, armedAt: armed ? armed.at : null,
        nextSlotMs: clockKind && armed ? nextSlot(/** @type {any} */ (trigger), now()) : null,
        lastOutcome: outcomes.length > 0 ? outcomes[outcomes.length - 1] : null,
        hasGreenRun: hasGreenRunForJob(flowDir),
      };
    },
  };
}

