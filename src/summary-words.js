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

/** am1, said before a human signs an edit of a job that has a trigger. @param {Trigger|null} t @param {string} [home] */
export function editClearsWords(t, home) {
  const w = scheduledWords(t, home);
  if (w === null) return null;
  return `This job runs by itself (${w}). Signing this edit clears that back to By hand. You can set it again once the new job has had one good run.`;
}

/**
 * NEXT of a job with a trigger. One sentence, first match wins:
 *  1. a run of this job is waiting at its ask (the next run waits too);
 *  2. the latest outcome this month is `monthly-exhausted` (the signed sentence, amounts from the row);
 *  3. a clock kind with a next slot; 4. a file kind that is armed; 5. not armed yet.
 * A last outcome of `refused` goes in front of 3-5, so a trigger that cannot start is never silent.
 * @param {{trigger: Trigger, armed: boolean, nextSlotMs: number|null, lastOutcome: any, waitingLine: number|null, now: number}} f
 */
export function scheduledNext(f) {
  const { trigger, armed, nextSlotMs, lastOutcome, waitingLine, now } = f;
  if (waitingLine !== null) return `Waiting for your answer at line ${waitingLine}; the next run waits too.`;
  const last = lastOutcome && typeof lastOutcome === 'object' ? lastOutcome : null;
  const sameMonth = last !== null && typeof last.at === 'string' && Number.isFinite(Date.parse(last.at))
    && new Date(Date.parse(last.at)).getFullYear() === new Date(now).getFullYear() && new Date(Date.parse(last.at)).getMonth() === new Date(now).getMonth();
  if (last !== null && last.outcome === 'monthly-exhausted' && sameMonth && typeof last.leftUsd === 'number' && typeof last.needUsd === 'number') {
    const left = last.atLeast === true ? `at most ${money(last.leftUsd)} left` : `${money(last.leftUsd)} left`;
    return `Paused: not enough money left this month (${left}, a run needs up to ${money(last.needUsd)}). Raise the monthly limit in Settings, or it starts again on the 1st.`;
  }
  const lead = last !== null && last.outcome === 'refused' && typeof last.why === 'string' && last.why !== '' ? `The last try did not start: ${last.why} ` : '';
  if (!armed) return `${lead}Not armed yet: the panel arms it on its next check.`;
  if (trigger.kind === 'file-updated') return `${lead}Watching for it. A run starts when its contents change.`;
  if (trigger.kind === 'new-file') return `${lead}Watching for it. A run starts for each new file.`;
  if (nextSlotMs === null) return `${lead}Not armed yet: the panel arms it on its next check.`;
  return `${lead}Next run ${slotWords(nextSlotMs)}.`;
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
