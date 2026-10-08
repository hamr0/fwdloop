// M4e amendment 5 items 2-4 and amendment 4 items 1, 4, 6: the values ONE RUN may be signed with, checked in ONE place for both the
// Run-a-signed-flow door (open: Inputs, Destination, Cap $, each ask's wait) and the Resume door (open: Cap $ only). Pure of the panel:
// no HTTP, no spawn, no writes — it reads the disk only to check a destination (realpath at the click, amendment 1) and asks the caller's
// monthly check. Every refusal is `{ field, say }`, spends $0 and writes nothing.
//
// What a run can change without a new flow is exactly these values; a job line, an ask's words or position, or the steps are not a run
// (the body may not even carry them: an unknown key is refused by name with the new-flow sentence).
import { capFloorText, destinationRefusal } from './authorcard.js';
import { monthlyRefusalText } from '../monthly.js';
import { parseWaitMs, valuesHash, sameValues } from '../runvalues.js';

export const NEW_FLOW_SAY = 'Only the files, the destination, the money cap and an ask\'s wait can change from one run to the next. A change to a job line, an ask\'s words or the steps is a new flow: use New job.';
export const RESUME_ONLY_CAP_SAY = 'A resume changes only the cap. New files or a new destination or ask wait is a new run of this flow (Run a signed flow); a change to a job line or an ask is a new flow (New job).';
const WAIT_SAY = 'The ask wait must be a whole number with s, m or h, such as 30m or 1h.';

/**
 * The smallest cap a Resume accepts: the next whole cent above what is spent, but never under the cap floor. ONE function for the
 * door's refusal and the page's note, so the "at least $X" it names is itself accepted.
 * @param {number} spentUsd @param {number} floorUsd
 */
export function leastResumeCapUsd(spentUsd, floorUsd) {
  const aboveSpent = Math.ceil(spentUsd * 100 + 1e-6) / 100;
  return Math.max(aboveSpent, Math.ceil(floorUsd * 100 - 1e-6) / 100);
}

/** @param {unknown} v */
const typed = (v) => (typeof v === 'string' ? v.trim() : v);

/**
 * @param {object} a
 * @param {string[]} a.allowedKeys the body keys this door takes; any other key is refused by name
 * @param {any} a.body
 * @param {{capUsd: number, destination: string|null, askWaits: Record<string,string>}} a.base the values in force now (the flow's own, or the run's newest signed version)
 * @param {string} a.realRoot the flows root (real path)
 * @param {boolean} a.capOnly Resume: destination and waits are never read from the body
 * @param {number} a.floorUsd the smallest cap that funds one round of a step (amendment 4 item 2); 0 = none
 * @param {number} [a.spentUsd] what the run has already spent (Resume): the cap must be above it
 * @param {boolean} [a.always] Resume: the floor and the monthly check always apply. A Run applies them only when its cap differs from the
 *   flow's own (a plain Run keeps the CLI's own gate, as it always did), so an old flow signed below today's floor still runs plain.
 * @param {(remainingUsd: number) => null | { problem: string } | { ok: boolean, room: any }} a.monthlyClaim the one monthly check
 * @returns {{ ok: true, values: {capUsd: number, destination: string|null, askWaits: Record<string,string>}, differs: boolean, remainingUsd: number } | { ok: false, status: number, refusals: {field: string, say: string}[], refused?: string, say?: string }}
 */
export function checkValues({
  allowedKeys, body, base, realRoot, capOnly, floorUsd, spentUsd = 0, monthlyClaim, always = false,
}) {
  /** @type {{field: string, say: string}[]} */
  const refusals = [];
  const no = (field, say) => refusals.push({ field, say });
  const b = body && typeof body === 'object' ? body : {};
  const extra = Object.keys(b).filter((k) => !allowedKeys.includes(k));
  if (extra.length > 0) {
    return {
      ok: false, status: 400, refused: capOnly ? 'not-a-resume' : 'not-a-run', say: capOnly ? RESUME_ONLY_CAP_SAY : NEW_FLOW_SAY, refusals: [{ field: extra[0], say: capOnly ? RESUME_ONLY_CAP_SAY : NEW_FLOW_SAY }],
    };
  }

  let { capUsd } = base;
  const capIn = typed(b.capUsd);
  if (capIn !== undefined && capIn !== '' && capIn !== null) {
    const n = Number(capIn);
    if (!(Number.isFinite(n) && n > 0)) no('capUsd', 'The cap must be a number above 0 (dollars per run).');
    else capUsd = n;
  }
  if (refusals.length === 0) {
    if (spentUsd > 0 && capUsd <= spentUsd + 1e-9) {
      no('capUsd', `The cap must be above what is already spent (at least $${leastResumeCapUsd(spentUsd, floorUsd).toFixed(2)}).`);
    } else if (capUsd < floorUsd && (always || capUsd !== base.capUsd)) no('capUsd', capFloorText(floorUsd));
  }

  let destination = base.destination;
  const destIn = capOnly ? undefined : typed(b.destination);
  if (destIn !== undefined && destIn !== null && destIn !== '') {
    if (typeof destIn !== 'string') no('destination', 'The destination must be the full path of a folder.');
    else if (base.destination === null) no('destination', 'This flow has no send step, so it has no destination to change. A destination needs a new flow (New job).');
    else {
      const why = destinationRefusal(destIn, realRoot);
      if (why !== null) no('destination', why);
      else destination = destIn;
    }
  }

  const askWaits = { ...base.askWaits };
  if (!capOnly && b.askWaits !== undefined && b.askWaits !== null) {
    if (typeof b.askWaits !== 'object' || Array.isArray(b.askWaits)) no('askWaits', WAIT_SAY);
    else {
      for (const [line, raw] of Object.entries(b.askWaits)) {
        if (!Object.hasOwn(base.askWaits, line)) { no(`askWaits.${line}`, `This flow has no ask on line ${line}.`); continue; }
        const t = typeof raw === 'string' ? raw.trim() : '';
        if (t === '') continue; // blank = the value in force
        if (parseWaitMs(t) === null) no(`askWaits.${line}`, WAIT_SAY);
        else askWaits[line] = t.toLowerCase();
      }
    }
  }

  if (refusals.length === 0 && (always || capUsd !== base.capUsd)) {
    // the one monthly check: what this run can still spend (a fresh run: its cap; a resume: the cap above what it already spent)
    const remainingUsd = capUsd - spentUsd;
    const claim = monthlyClaim(remainingUsd);
    if (claim && 'problem' in claim) return { ok: false, status: 409, refused: 'monthly', say: `${claim.problem} — refusing rather than guess the monthly limit. Nothing spent.`, refusals: [] };
    if (claim && !claim.ok) no('capUsd', monthlyRefusalText(claim.room));
  }
  if (refusals.length > 0) return { ok: false, status: 400, refusals };
  const values = { capUsd, destination, askWaits };
  return {
    ok: true, values, differs: !sameValues(values, base), remainingUsd: capUsd - spentUsd,
  };
}

export { valuesHash };
