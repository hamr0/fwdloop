// M9 piece 5 and 6 (docs/wiki/the-module-ladder.md, "M9" item 7, am1, am2): the words of the summary block and of the trigger card.
// ONE WRITER of these strings. Every function is pure: typed facts in, a fixed sentence out. No model text ever reaches a sentence
// (the only slot-fills are numbers, a line number, a file or folder name, the human's own destination, and a code from the books).
//
// ENDED / NEXT shape borrowed from bareloop's ENDED block (P5) — `endedFor` in bareloop src/panel/server.js:
// borrowed-from: bareloop src/panel/server.js@f845ee7 (the reason/next pair per ending, and the honest fixed fallback).
// The table here is fwdloop's own: it is keyed by the outcomes fwdloop's history row can hold.
import { homedir } from 'node:os';
import { basename } from 'node:path';

/** @typedef {import('./trigger-line.js').Trigger} Trigger */

const DAY_PLURAL = { mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' };
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param {number} n */
const two = (n) => String(n).padStart(2, '0');
/** @param {{hour: number, minute: number}} s */
const hhmm = (s) => `${two(s.hour)}:${two(s.minute)}`;
/** @param {number} usd */
const money = (usd) => `$${usd.toFixed(2)}`;

/** A path with the home folder shown as `~`. @param {string} p @param {string} [home] */
function tilde(p, home = homedir()) {
  if (home && (p === home || p.startsWith(`${home}/`))) return `~${p.slice(home.length)}`;
  return p;
}

/**
 * SCHEDULED: what starts the job, in words. `null` (By hand) has no sentence.
 * @param {Trigger|null} t @param {string} [home]
 * @returns {string|null}
 */
export function scheduledWords(t, home) {
  if (t === null) return null;
  if (t.kind === 'daily') return `Every day at ${hhmm(t)}`;
  if (t.kind === 'weekdays') return `Weekdays at ${hhmm(t)}`;
  if (t.kind === 'weekly') return `${DAY_PLURAL[/** @type {keyof typeof DAY_PLURAL} */ (t.day)] ?? t.day} at ${hhmm(t)}`;
  if (t.kind === 'file-updated') return `When ${basename(t.path)} is updated`;
  const folder = tilde(/** @type {{folder: string}} */ (t).folder, home);
  return `When a new file arrives in ${folder.endsWith('/') ? folder : `${folder}/`}`;
}

/** "Mon 13 Oct, 09:00" — local time, fixed English names (never the machine's locale). @param {number} ms */
export function slotWords(ms) {
  const d = new Date(ms);
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * M11 am1 item 3, the Scheduled card's first line: "today 17:00", "tomorrow 09:00", else the date the NEXT line already says ("Tue 20 Oct, 09:05").
 * Local time, by calendar day. @param {number} ms the next run @param {number} now
 */
export function nextTimeWords(ms, now) {
  const d = new Date(ms);
  const day = (/** @type {Date} */ x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const apart = Math.round((day(d) - day(new Date(now))) / 86_400_000);
  if (apart === 0) return `today ${two(d.getHours())}:${two(d.getMinutes())}`;
  if (apart === 1) return `tomorrow ${two(d.getHours())}:${two(d.getMinutes())}`;
  return slotWords(ms);
}

/** M11 am1 item 3, the Scheduled card's second line start: "next in 20m" / "next in 3h" / "next in 3d" (whole units, rounded down, never "0m"). @param {number} ms @param {number} now */
export function nextInWords(ms, now) {
  const mins = Math.max(1, Math.floor((ms - now) / 60_000));
  if (mins < 60) return `next in ${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 48 ? `next in ${hours}h` : `next in ${Math.floor(hours / 24)}d`;
}

/**
 * NEXT of a job with a trigger. One sentence, first match wins:
 *  1. a run of this job is waiting at its ask (the next run waits too);
 *  2. the latest outcome this month is `monthly-exhausted` (the signed sentence, amounts from the row);
 *  3. a clock kind with a next slot; 4. a file kind that is armed; 5. not armed yet.
 * A last outcome of `refused` goes in front of 3-5, so a trigger that cannot start is never silent.
 * `red` is the typed flag for "the human must act": monthly-exhausted and the refused lead. The page paints it; it never guesses from the text.
 * @param {{trigger: Trigger, armed: boolean, nextSlotMs: number|null, lastOutcome: any, waitingLine: number|null, now: number}} f
 * @returns {{text: string, red: boolean}}
 */
export function scheduledNextFor(f) {
  const { trigger, armed, nextSlotMs, lastOutcome, waitingLine, now } = f;
  /** @param {string} text @param {boolean} [red] */
  const say = (text, red = false) => ({ text, red });
  if (waitingLine !== null) return say(`Waiting for your answer at line ${waitingLine}; the next run waits too.`);
  const last = lastOutcome && typeof lastOutcome === 'object' ? lastOutcome : null;
  const sameMonth = last !== null && typeof last.at === 'string' && Number.isFinite(Date.parse(last.at))
    && new Date(Date.parse(last.at)).getFullYear() === new Date(now).getFullYear() && new Date(Date.parse(last.at)).getMonth() === new Date(now).getMonth();
  if (last !== null && last.outcome === 'monthly-exhausted' && sameMonth && typeof last.leftUsd === 'number' && typeof last.needUsd === 'number') {
    const left = last.atLeast === true ? `at most ${money(last.leftUsd)} left` : `${money(last.leftUsd)} left`;
    return say(`Paused: not enough money left this month (${left}, a run needs up to ${money(last.needUsd)}). Raise the monthly limit in Settings, or it starts again on the 1st.`, true);
  }
  const lead = last !== null && last.outcome === 'refused' && typeof last.why === 'string' && last.why !== '' ? `The last try did not start: ${last.why} ` : '';
  const red = lead !== '';
  if (!armed) return say(`${lead}Not armed yet: the panel arms it on its next check.`, red);
  if (trigger.kind === 'file-updated') return say(`${lead}Watching for it. A run starts when its contents change.`, red);
  if (trigger.kind === 'new-file') return say(`${lead}Watching for it. A run starts for each new file.`, red);
  if (nextSlotMs === null) return say(`${lead}Not armed yet: the panel arms it on its next check.`, red);
  return say(`${lead}Next run ${slotWords(nextSlotMs)}.`, red);
}

/** Fixed catch-up sentence (am2 item 1) from a run's `trigger.json`. @param {any} rec */
export function catchUpWords(rec) {
  return rec && typeof rec === 'object' && rec.catchUp === true ? 'This run was a catch-up: it started more than 2 minutes after its set time (the panel was off).' : null;
}

/** @param {number|null} line @param {string} rest "Stopped at line 4: <rest>" or "Stopped: <rest>" */
const stoppedAt = (line, rest) => (line === null ? `Stopped: ${rest}` : `Stopped at line ${line}: ${rest}`);

const RERUN_NEXT = 'Run it again from the Chat card.';

/**
 * M9 am24: a NEXT with more than one instruction is `rows` of [label, instruction], one per line (label muted, instruction in a second column).
 * `next` stays the one string every other reader gets: the rows joined "label instruction", one per line. The only writer of both.
 * @param {Array<[string, string]>} rows
 * @returns {{next: string, rows: Array<[string, string]>}}
 */
const splitNext = (rows) => ({ next: rows.map(([l, t]) => `${l} ${t}`).join('\n'), rows });

/**
 * ENDED / NEXT of a finished run. Every outcome the history row can hold has a fixed sentence; an unknown one gets an honest fixed fallback
 * that names the code and guesses nothing. `null` when there is no ending (still running, waiting, or no history row and not died).
 * @param {{outcome: string|null, died?: boolean, line: number|null, destination: string|null, canResume: boolean, home?: string, skipReason?: string}} f
 * @returns {{reason: string, next: string, rows?: Array<[string, string]>}|null}
 */
export function endedWords(f) {
  const {
    outcome, died = false, line, destination, canResume, home, skipReason,
  } = f;
  const resumeOrAgain = canResume ? 'Resume from the Chat card.' : RERUN_NEXT;
  if (died) return { reason: 'It stopped with no ending recorded.', next: 'See the Audit / logs tab for the last thing it did.' };
  if (outcome === null || outcome === undefined) return null;
  switch (outcome) {
    case 'complete':
      return { reason: 'Goal met.', next: destination ? `The result is in ${tilde(destination, home)}.` : 'The result is in the step cards below.' };
    case 'skipped':
      return { reason: `Skipped: ${typeof skipReason === 'string' && skipReason !== '' ? skipReason : 'the ticket did not match'}. Nothing was spent.`, next: 'Nothing to do. Run it anyway from the ticket list in the Result tab.' };
    case 'stopped':
      return { reason: 'Stopped by you.', next: resumeOrAgain };
    case 'cap-halt':
      return { reason: stoppedAt(line, 'the next try could not fit under the money cap.'), ...(canResume ? splitNext([['raise the cap:', 'Cap $ on the Chat card'], ['then:', 'Resume from the Chat card']]) : { next: RERUN_NEXT }) };
    case 'redo-halt':
      return { reason: stoppedAt(line, 'you rejected it.'), next: RERUN_NEXT };
    case 'ask-expired':
    case 'ask-timeout':
      return { reason: stoppedAt(line, 'nobody answered in time.'), ...splitNext([['reopen it:', 'from the Ask tab'], ['or run it again:', 'from the Chat card']]) };
    case 'not-done':
      return { reason: stoppedAt(line, 'the step said it did not finish.'), next: RERUN_NEXT };
    case 'struck-out':
      return { reason: stoppedAt(line, 'the checks kept failing and it ran out of strikes.'), next: RERUN_NEXT };
    case 'attempt-fallback':
      return { reason: stoppedAt(line, 'it used up its tries without passing the check.'), next: RERUN_NEXT };
    case 'close-casualty':
      return { reason: stoppedAt(line, 'the check itself could not be run.'), next: RERUN_NEXT };
    case 'provider-red':
      return { reason: stoppedAt(line, 'the model provider failed.'), next: RERUN_NEXT };
    case 'pricing-red':
      return { reason: stoppedAt(line, 'the model returned no cost, so the run stopped rather than guess.'), next: RERUN_NEXT };
    case 'red':
      return { reason: stoppedAt(line, 'a step or its check failed.'), next: RERUN_NEXT };
    case 'rerun':
      return { reason: 'You ended this run on purpose; a fresh run was started.', next: 'Look at the newest run of this job.' };
    case 'preflight-red':
      return { reason: 'It did not start: the job could not pass its pre-run checks. Nothing was spent.', ...splitNext([['fix it:', 'what the Audit / logs tab names'], ['then:', 'run it again from the Chat card']]) };
    case 'refused':
      return { reason: 'It did not start: the run was refused. Nothing was spent.', ...splitNext([['see why:', 'the Audit / logs tab'], ['then:', 'fix that and run it again from the Chat card']]) };
    default: {
      // an unknown code: say so, name the code (from the books, capped), guess nothing
      const code = String(outcome).replace(/[^\w-]/g, '').slice(0, 40);
      return { reason: `It ended with "${code}", which this panel has no sentence for.`, next: 'See the Audit / logs tab for what happened.' };
    }
  }
}

// ---------------------------------------------------------------------------
// M9 am6 / am7 (docs/wiki/the-module-ladder.md): the words of "how did this run begin", "what schedule does the workflow have", the Audit's schedule rows and
// the Run tab's SCHEDULE block. ONE owner: the Job tab's Schedule field and the Run tab's SCHEDULE line 1 are built by `scheduleHead`, the run's
// Started line and the Audit's first row by `startedParts`. Pure: typed facts in, a fixed sentence out; no model text reaches any of it.
// ---------------------------------------------------------------------------

/** "MM/DD HH:MM", local time: the same form as the run cards' `rlShortDate`. @param {number|string} when epoch ms or an ISO string */
export function shortStamp(when) {
  const d = new Date(typeof when === 'string' ? Date.parse(when) : when);
  if (Number.isNaN(d.getTime())) return '';
  return `${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "Tue 10/20 09:05": the day name then the short stamp. @param {number} ms */
export function dayStamp(ms) {
  return `${DAY_SHORT[new Date(ms).getDay()]} ${shortStamp(ms)}`;
}

/**
 * The schedule in words, lower-case first ("every day at 08:15"): the SINGLE line-1 of the Run tab's SCHEDULE block and the first part of the Job tab's
 * Schedule field. `null` (no schedule) has no sentence. @param {Trigger|null} t @param {string} [home]
 */
export function scheduleHead(t, home) {
  const w = scheduledWords(t, home);
  return w === null ? null : `${w.charAt(0).toLowerCase()}${w.slice(1)}`;
}

/**
 * The Job tab's "Schedule" field: the workflow's schedule now and what it is bound to, parts joined by " · ", or `none`.
 * @param {{trigger: Trigger|null, from?: string|null, model?: string|null, destination?: string|null, inputs?: string[]|null, home?: string}} f
 */
export function scheduleFieldWords(f) {
  const head = scheduleHead(f.trigger, f.home);
  if (head === null) return 'none';
  return [head, f.from ? `from ${f.from}` : null, f.model || null, f.destination ? tilde(f.destination, f.home) : null, f.inputs && f.inputs.length > 0 ? f.inputs.join(', ') : null]
    .filter((x) => x !== null).join(' · ');
}

/** A run's `trigger.json` record -> the typed pieces of "how it began", or `null` for a hand run. @param {any} rec */
function startedKind(rec) {
  if (!rec || typeof rec !== 'object') return null;
  return rec.kind === 'file' || rec.kind === 'clock' ? rec.kind : null;
}

/**
 * The Job tab's Started line: `By hand · 10/15 13:46`, `By the schedule: every day at 08:15 · catch-up, 10 min late · 10/15 08:16`,
 * `By a new file: aging-oct.csv · …`, `By a file update: aging.csv · …`. The trailing stamp is the run's start (am7 item 5); absent when the books do not hold one.
 * @param {any} rec the run's trigger.json or null @param {number|null} startMs @param {string} [home]
 */
export function startedWords(rec, startMs, home) {
  const stamp = startMs === null || startMs === undefined ? null : shortStamp(startMs);
  const kind = startedKind(rec);
  let head = 'By hand';
  if (kind === 'clock') {
    const late = rec.catchUp === true ? (Number.isFinite(rec.lateMin) ? `catch-up, ${rec.lateMin} min late` : 'catch-up') : null;
    head = `By the schedule: ${rec.words ?? rec.trigger ?? 'a schedule'}${late ? ` · ${late}` : ''}`;
  } else if (kind === 'file') {
    const name = typeof rec.file === 'string' ? basename(rec.file) : '';
    const updated = rec.triggerKind === 'file-updated';
    head = `${updated ? 'By a file update' : 'By a new file'}${name ? `: ${name}` : ''}`;
  }
  return stamp ? `${head} · ${stamp}` : head;
}

/** M9 am8 item 3: the busy sentence, in the busy row of `triggers.jsonl` and in the SCHEDULE block. One owner; the scheduler writes it, the words read it. */
export const SCHEDULE_BUSY_SAY = 'a run of this job was still working';

/** A month-used-up fire in the SCHEDULE block's words (am8 item 5): `month used up: $0.01 left, needs $0.50`. @param {any} row */
function monthUsedUpWords(row) {
  const left = typeof row.leftUsd === 'number' ? `${row.atLeast === true ? 'at most ' : ''}${money(row.leftUsd)} left` : 'not enough left';
  return `month used up: ${left}${typeof row.needUsd === 'number' ? `, needs ${money(row.needUsd)}` : ''}`;
}

/**
 * The Run tab's SCHEDULE block (am7 item 3, am8 items 2-8): `{line1, line2, red}`. Line 1 = the schedule words or `By hand`. Line 2 (only with a schedule):
 * `no run yet` before any fire; else `last <stamp> · ` then the newest fire's words, then `next ...`:
 *  - a start: `<run-N> · <outcome>[ · catch-up]` (a run waiting at its ask: `<run-N> · waiting for your answer (the next run does not wait)`), normal;
 *  - busy: `busy: a run of this job was still working`, normal (it clears by itself);
 *  - month used up: `month used up: $0.01 left, needs $0.50 · next: raise the limit in Settings, or it starts on the 1st`, red only while `nowMs` is still that month;
 *  - refused: `refused: <why> · next: fix it in Cancel / modify schedule`, red until a later good start.
 * `next` otherwise: `next <day stamp>`, `next: waiting for a new file` (file schedule) or `next: not armed yet`.
 * @param {{trigger: Trigger|null, home?: string, last: {at: string, runId: string, outcome: string, catchUp: boolean}|null, nextSlotMs: number|null, armed: boolean, problem: any, nowMs?: number}} f
 *   `problem`: the newest fire when it started nothing (busy, monthly-exhausted, refused), else null.
 * @returns {{line1: string, line2: string|null, red: boolean}}
 */
export function scheduleBlockWords(f) {
  const head = scheduleHead(f.trigger, f.home);
  const tr = f.trigger;
  if (head === null || tr === null) return { line1: 'By hand', line2: null, red: false };
  const file = tr.kind === 'new-file' || tr.kind === 'file-updated';
  const next = file ? 'next: waiting for a new file' : (f.nextSlotMs !== null && f.armed ? `next ${dayStamp(f.nextSlotMs)}` : 'next: not armed yet');
  const p = f.problem;
  if (p) {
    const stamp = `last ${shortStamp(p.at)}`;
    if (p.outcome === 'busy') return { line1: head, line2: `${stamp} · busy: ${SCHEDULE_BUSY_SAY} · ${next}`, red: false };
    if (p.outcome === 'monthly-exhausted') {
      const month = (/** @type {number} */ ms) => { const d = new Date(ms); return d.getFullYear() * 12 + d.getMonth(); };
      const still = month(Date.parse(p.at)) === month(f.nowMs ?? Date.now());
      return { line1: head, line2: `${stamp} · ${monthUsedUpWords(p)} · ${still ? 'next: raise the limit in Settings, or it starts on the 1st' : next}`, red: still };
    }
    return { line1: head, line2: `${stamp} · refused: ${String(p.why ?? 'it was refused').trim()} · next: fix it in Cancel / modify schedule`, red: true };
  }
  if (!f.last) return { line1: head, line2: `no run yet · ${next}`, red: false };
  const outcome = f.last.outcome === 'waiting' ? 'waiting for your answer (the next run does not wait)' : `${f.last.outcome}${f.last.catchUp ? ' · catch-up' : ''}`;
  return { line1: head, line2: `last ${shortStamp(f.last.at)} · ${f.last.runId} · ${outcome} · ${next}`, red: false };
}

/** M9 am9 item 3: a `refused` fire's reason ends `Nothing started.` once, whether the scheduler already said so or not. @param {unknown} why */
function refusedWords(why) {
  const w = String(why ?? 'it was refused').trim().replace(/\s*Nothing started\.?$/, '').replace(/\.$/, '');
  return `refused: ${w || 'it was refused'}. Nothing started.`;
}

/** Fires that started nothing (the three outcomes of am8), the only rows `tries` may hold. @param {any} row */
export const startedNothing = (row) => row && (row.outcome === 'busy' || row.outcome === 'monthly-exhausted' || row.outcome === 'refused');

/** M9 am16/am18: a file that waited when the schedule changed and so will not run; its row carries the signed sentence in `say`. @param {any} row */
const droppedByChange = (row) => !!row && row.outcome === 'schedule-changed' && typeof row.say === 'string';

/** M9 am9 item 3: one `tries` row's words, after its stamp; the am8 owners' sentences. @param {any} row a triggers.jsonl row that started nothing */
function triesRowWords(row) {
  if (droppedByChange(row)) return row.say;
  if (row.outcome === 'busy') return `busy: ${String(row.say ?? SCHEDULE_BUSY_SAY).replace(/\.$/, '')}. Nothing started.`;
  if (row.outcome === 'monthly-exhausted') return `${monthUsedUpWords(row)}. Nothing started.`;
  return refusedWords(row.why);
}

/** M9 am9 item 4: at most this many `tries` show. */
export const SCHEDULE_TRIES_SHOWN = 7;

/**
 * M9 am9 / am11: a run's Audit `schedule` section (one for every run of a job that has a schedule NOW; `null` when it has none). Folded head
 * `<sign> <schedule words> · from run-7 · 2 tries started nothing`; unfolded rows `this run` and `tries` (stamp + words each).
 * The schedule words are the SAME `line1` the Run tab's SCHEDULE block carries; the sign is `[▶]` while a run of the job is running, `[✗]` when that block is red, else `[·]` (am11).
 * @param {{trigger: Trigger|null, runId: string, from: string|null, rec: any, startMs: number|null, block: {line1: string, red: boolean}, running: boolean, fires: any[]}} f
 *   `rec`: this run's trigger.json or null (a hand run); `fires`: every triggers.jsonl row of the job, across every signing.
 * @returns {{sign: string, head: string, rows: Array<{label: string, stamp: string, text: string}>}|null}
 */
export function scheduleAuditWords(f) {
  // M9 am18: the am16 `schedule-changed` rows are listed with the tries, also after the schedule is cancelled (no trigger now, such rows exist)
  if (f.trigger === null && !f.fires.some(droppedByChange)) return null;
  const tries = f.fires.filter(startedNothing).reverse();
  const listed = f.fires.filter((r) => startedNothing(r) || droppedByChange(r)).reverse();
  const sign = f.running ? '[\u25B6]' : (f.block.red ? '[\u2717]' : '[\u00B7]');
  const k = tries.length;
  const head = [f.block.line1, f.from ? `from ${f.from}` : null, k > 0 ? `${k} ${k === 1 ? 'try' : 'tries'} started nothing` : null].filter((x) => x !== null).join(' \u00b7 ');
  const kind = startedKind(f.rec);
  let what = 'by hand.';
  if (kind === 'clock') what = `started by the schedule \u00b7 ${f.rec.words ?? f.rec.trigger ?? 'a schedule'}${f.rec.catchUp === true ? ' \u00b7 catch-up' : ''}`;
  else if (kind === 'file') {
    const name = typeof f.rec.file === 'string' ? basename(f.rec.file) : '';
    what = `started by the schedule \u00b7 ${f.rec.triggerKind === 'file-updated' ? 'file update' : 'new file'}${name ? ` ${name}` : ''}`;
  }
  if (f.from !== null && f.from === f.runId) what += kind === null ? ' The schedule was set from this run.' : '. The schedule was set from this run.';
  /** @type {Array<{label: string, stamp: string, text: string}>} */
  const rows = [{ label: 'this run', stamp: f.startMs === null ? '' : shortStamp(f.startMs), text: what }];
  const shown = listed.slice(0, SCHEDULE_TRIES_SHOWN);
  if (shown.length === 0) rows.push({ label: 'tries', stamp: '', text: 'none' });
  else shown.forEach((r, i) => rows.push({ label: i === 0 ? 'tries' : '', stamp: shortStamp(r.at), text: triesRowWords(r) }));
  return { sign, head, rows };
}

/**
 * M11 am11 items 3-4: the Audit row that says why a card left Needs you: `removed from Needs you by you · 10/15 08:15`, or `removed from Needs you after 7 days`. `null` when it did not.
 * @param {{by: 'you', at: string}|{by: 'age'}|null} left
 */
export function needsLeftWords(left) {
  if (left === null) return null;
  return left.by === 'you' ? `removed from Needs you by you \u00b7 ${shortStamp(left.at)}` : 'removed from Needs you after 7 days';
}

/** ENDED (am7 item 1): `10/14 08:16 · passed · Goal met.`. The stamp is the run's local end time; the word is the run's outcome word (none for a run ended on purpose). @param {string|null} at ISO @param {string|null} word @param {string} reason */
export function endedLineWords(at, word, reason) {
  const stamp = at ? shortStamp(at) : '';
  return [stamp || null, word || null, reason].filter((x) => x !== null).join(' · ');
}

/** M9 am12: what a stopped run with no kept copy of its job says where Resume would be (a run made before runs kept one). The one owner of these words. */
export const NO_COPY_SAY = 'This run started before runs kept their own copy of the job, so it cannot carry on. Start a new run.';
