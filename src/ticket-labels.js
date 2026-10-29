// M12 piece 3 (docs/wiki/the-module-ladder.md, "M12 scope (restart)" items 4 and 9): which ticket a job's signed label filter lets through, decided by CODE.
// The drafter may suggest the labels and a human signs them (`declaration.ticketFilter`); at run start this reads the ticket's typed fields (labels, state)
// and answers run or skip. No model, no regex over free prose: only the `labels` list and the `state` string of the ticket's own JSON are read.
// Three outcomes are kept apart: skip (a definite miss, or closed), run (a match), run-with-`unsure` (an off-scale or unreadable label goes to a human at the
// ask, NEVER skipped). Normaliser borrowed in shape from fwdloop poc/mcp/f96/f96.mjs (the F96 rules, 12 of 12 on real tickets), re-shaped to a pure function.

/** `P0`..`P3`, optionally after `priority`, `priority:`, `priority /` or `priority -`; the digit must end the number (`P12` is no priority) */
const PRIORITY_LABEL = /^(?:priority\s*[:/-]?\s*)?p([0-3])(?![0-9])/;

/**
 * One priority value from a ticket's labels: `P0`..`P3`; `unsure` when two different ones are present, or when a label names a priority on another scale
 * (`priority/important-soon`) and no scale value is present; `none` when no label speaks of priority.
 * @param {string[]} labels @returns {string}
 */
export function priorityOf(labels) {
  const found = new Set();
  let offScale = false;
  for (const raw of labels) {
    const name = String(raw).trim().toLowerCase();
    const m = PRIORITY_LABEL.exec(name);
    if (m) found.add(`P${m[1]}`);
    else if (name.split(/[^a-z0-9]+/).includes('priority')) offScale = true;
  }
  if (found.size > 1) return 'unsure';
  if (found.size === 1) return [...found][0];
  return offScale ? 'unsure' : 'none';
}

/**
 * The typed fields of a ticket read through `issue_read`: its JSON. A missing `labels` key means no labels (GitHub omits it, F98). Text that is not a JSON
 * object is `ok:false`: never read as "no labels".
 * @param {string} text @returns {{ok: true, labels: string[], state: string|null, title: string|null}|{ok: false}}
 */
export function readTicketFields(text) {
  let o;
  try { o = JSON.parse(text); } catch { return { ok: false }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false };
  const labels = (Array.isArray(o.labels) ? o.labels : []).map((l) => (typeof l === 'string' ? l : l?.name)).filter((l) => typeof l === 'string' && l.trim() !== '');
  return { ok: true, labels, state: typeof o.state === 'string' ? o.state.toLowerCase() : null, title: typeof o.title === 'string' ? o.title : null };
}

/**
 * @param {{text: string, filter?: {priority?: string[], labels?: string[]}}} a `filter` = the job's signed `ticketFilter` (or absent)
 * @returns {{outcome: 'run', unsure?: string}|{outcome: 'skip', reason: string}}
 */
export function decideTicket({ text, filter }) {
  const t = readTicketFields(text);
  if (!t.ok) return { outcome: 'run', unsure: 'the ticket text is not readable as fields, so no label could be checked' };
  if (t.state === 'closed') return { outcome: 'skip', reason: 'closed' };
  if (!filter) return { outcome: 'run' };
  /** @type {string|undefined} */
  let unsure;
  if (filter.priority?.length) {
    const want = filter.priority.join(' or ');
    const p = priorityOf(t.labels);
    if (p === 'none') return { outcome: 'skip', reason: `no ${want} label` };
    if (p === 'unsure') unsure = 'a priority label is not on the P0-P3 scale, or two priorities are present';
    else if (!filter.priority.includes(p)) return { outcome: 'skip', reason: `priority ${p}, not ${want}` };
  }
  if (filter.labels?.length) {
    const have = new Set(t.labels.map((l) => l.trim().toLowerCase()));
    if (!filter.labels.some((l) => have.has(l.trim().toLowerCase()))) return { outcome: 'skip', reason: `no ${filter.labels.join(' or ')} label` };
  }
  return unsure === undefined ? { outcome: 'run' } : { outcome: 'run', unsure };
}
