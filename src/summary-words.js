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
 * ENDED / NEXT of a finished run. Every outcome the history row can hold has a fixed sentence; an unknown one gets an honest fixed fallback
 * that names the code and guesses nothing. `null` when there is no ending (still running, waiting, or no history row and not died).
 * @param {{outcome: string|null, died?: boolean, line: number|null, destination: string|null, canResume: boolean, home?: string}} f
 * @returns {{reason: string, next: string}|null}
 */
export function endedWords(f) {
  const {
    outcome, died = false, line, destination, canResume, home,
  } = f;
  const resumeOrAgain = canResume ? 'Resume from the Chat card.' : RERUN_NEXT;
  if (died) return { reason: 'It stopped with no ending recorded.', next: 'See the Audit / logs tab for the last thing it did.' };
  if (outcome === null || outcome === undefined) return null;
  switch (outcome) {
    case 'complete':
      return { reason: 'Goal met.', next: destination ? `The result is in ${tilde(destination, home)}.` : 'The result is in the step cards below.' };
    case 'stopped':
      return { reason: 'Stopped by you.', next: resumeOrAgain };
    case 'cap-halt':
      return { reason: stoppedAt(line, 'the next try could not fit under the money cap.'), next: canResume ? 'Raise the cap and Resume from the Chat card.' : RERUN_NEXT };
    case 'redo-halt':
      return { reason: stoppedAt(line, 'you rejected it.'), next: RERUN_NEXT };
    case 'ask-expired':
    case 'ask-timeout':
      return { reason: stoppedAt(line, 'nobody answered in time.'), next: 'Reopen it from the Ask tab, or run it again from the Chat card.' };
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
      return { reason: 'It did not start: the job could not pass its pre-run checks. Nothing was spent.', next: 'Fix what the Audit / logs tab names, then run it again from the Chat card.' };
    case 'refused':
      return { reason: 'It did not start: the run was refused. Nothing was spent.', next: 'The Audit / logs tab says why. Fix that, then run it again from the Chat card.' };
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

/**
 * The Audit's first row of a run a schedule started: `started by the schedule · every day at 08:15 · slot 08:15 · from run-7` (+ ` · catch-up`).
 * A file trigger names the file where a clock names the slot. `null` for a hand run. @param {any} rec @param {string} [home]
 */
export function auditStartedWords(rec, home) {
  const kind = startedKind(rec);
  if (kind === null) return null;
  const parts = ['started by the schedule', rec.words ?? String(rec.trigger ?? '')];
  if (kind === 'clock' && Number.isFinite(Date.parse(rec.slot))) {
    const d = new Date(Date.parse(rec.slot));
    parts.push(`slot ${two(d.getHours())}:${two(d.getMinutes())}`);
  } else if (kind === 'file' && typeof rec.file === 'string') parts.push(`file ${basename(rec.file)}`);
  if (typeof rec.fromRun === 'string' && rec.fromRun !== '') parts.push(`from ${rec.fromRun}`);
  if (rec.catchUp === true) parts.push('catch-up');
  void home;
  return parts.join(' · ');
}

/** One fire that started nothing, in plain words, for the Audit's folded schedule group: `10/14 08:15 · busy · <why>`. @param {any} row a triggers.jsonl row */
export function fireRowWords(row) {
  const when = shortStamp(row.at);
  if (row.outcome === 'busy') return `${when} · busy · ${String(row.say ?? 'a run of this job was already going').replace(/\.$/, '')}.`;
  if (row.outcome === 'monthly-exhausted') {
    const left = typeof row.leftUsd === 'number' ? `${row.atLeast === true ? 'at most ' : ''}${money(row.leftUsd)} left` : 'not enough left';
    const need = typeof row.needUsd === 'number' ? `, a run needs up to ${money(row.needUsd)}` : '';
    return `${when} · month used up · ${left} this month${need}.`;
  }
  return `${when} · refused · ${String(row.why ?? 'it was refused').trim()}`;
}

/** The plain reason of a fire that started nothing, without the time (the SCHEDULE block's line 2). @param {any} row */
export function fireReasonWords(row) {
  return fireRowWords(row).replace(/^\S+ \S+ · (busy|month used up|refused) · /, '').trim();
}

/**
 * The Run tab's SCHEDULE block (am7 item 3-4): `{line1, line2, red}`. Line 1 = the schedule words or `By hand`. Line 2 (only with a schedule):
 * `last <stamp> · <run-N> · <outcome>[ · catch-up] · next <day stamp>`, or `... next: waiting for a new file` for a file schedule. A last fire that
 * started nothing is a problem: red, and line 2 says its reason, then `next: fix it in Cancel / modify schedule`.
 * @param {{trigger: Trigger|null, home?: string, last: {at: string, runId: string, outcome: string, catchUp: boolean}|null, nextSlotMs: number|null, armed: boolean, problem: any}} f
 * @returns {{line1: string, line2: string|null, red: boolean}}
 */
export function scheduleBlockWords(f) {
  const head = scheduleHead(f.trigger, f.home);
  const tr = f.trigger;
  if (head === null || tr === null) return { line1: 'By hand', line2: null, red: false };
  if (f.problem) return { line1: head, line2: `${fireReasonWords(f.problem)} · next: fix it in Cancel / modify schedule`, red: true };
  const last = f.last
    ? `last ${shortStamp(f.last.at)} · ${f.last.runId} · ${f.last.outcome}${f.last.catchUp ? ' · catch-up' : ''}`
    : 'no run yet';
  const file = tr.kind === 'new-file' || tr.kind === 'file-updated';
  const next = file ? 'next: waiting for a new file' : (f.nextSlotMs !== null && f.armed ? `next ${dayStamp(f.nextSlotMs)}` : 'next: not armed yet');
  return { line1: head, line2: `${last} · ${next}`, red: false };
}

/** ENDED (am7 item 1): `10/14 08:16 · passed · Goal met.`. The stamp is the run's local end time; the word is the run's outcome word (none for a run ended on purpose). @param {string|null} at ISO @param {string|null} word @param {string} reason */
export function endedLineWords(at, word, reason) {
  const stamp = at ? shortStamp(at) : '';
  return [stamp || null, word || null, reason].filter((x) => x !== null).join(' · ');
}
