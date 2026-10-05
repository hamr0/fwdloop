// M4e piece 2a, items 1-2 (docs/wiki/the-module-ladder.md, "M4e", scope 2 and 6): the job card -> the prose file
// `fwdloop draft` reads, and the $0 checks that run before any spawn. Pure of the panel: no HTTP, no spawn, no
// writes — it reads the disk only to check the card's paths (realpathSync at the click, as the signed text says).
//
// The card writes EXACTLY the shape `flows/<flow>/prose.txt` has: the human's job lines (numbered, `guardrail:`
// lines under them, `ask 30m:` marks, as typed), then the "Arbiter guardrails" block built ONLY from the card's
// typed fields — cap, send line + folder, one `source <role> = file:<path>` per input. The drafter never writes
// any of it (hard line); this file is the only place the block is built.
//
// Every refusal is `{ field, say }`: the box it names and a plain sentence. A refusal spends $0 and creates
// nothing — this module writes nothing at all.
import {
  accessSync, constants as fsConstants, lstatSync, realpathSync, statSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { checkFlowName } from '../flow.js';
import { checkSendDestination } from '../runner.js';
import { parseSignedText } from '../signed-text.js';
import { PROVIDER_SLOTS } from '../provider.js';

/** The heading line the prose files use (flows/job2-m6a-3/prose.txt); the parser matches `/^arbiter guardrails\b/i`. */
export const ARBITER_HEADING = 'Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):';

/** The role shape the signed-text parser accepts (src/signed-text.js SOURCE_RE). */
const ROLE_RE = /^[a-z][a-z0-9_-]*$/;
/** A tab is allowed in the job text; every other control character (a newline in a path, NUL) is not. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** A cap as the signed-text grammar spells it: a plain decimal, never an exponent. @param {number} n */
function capText(n) {
  const s = String(n);
  return /^\d+(?:\.\d+)?$/.test(s) ? s : n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Normalise what the page sent into the typed card (one reader of the request body's shape). Unknown fields are
 * dropped; nothing here judges a value.
 * @param {any} body
 */
export function cardFields(body) {
  const b = body && typeof body === 'object' ? body : {};
  const d = b.destination && typeof b.destination === 'object' ? b.destination : {};
  return {
    flowName: str(b.flowName).trim(),
    job: str(b.job).replace(/\r\n?/g, '\n'),
    capUsd: typeof b.capUsd === 'string' && b.capUsd.trim() !== '' ? Number(b.capUsd) : b.capUsd,
    destination: { line: typeof d.line === 'string' ? d.line.trim() : d.line, folder: str(d.folder).trim() },
    inputs: (Array.isArray(b.inputs) ? b.inputs : []).map((r) => ({ role: str(r?.role).trim(), path: str(r?.path).trim() })),
  };
}

/** The send is "empty" (no send) when both of its boxes are blank. */
const noDestination = (dest) => (dest.line === undefined || dest.line === null || dest.line === '') && dest.folder === '';

/**
 * The prose file text for a card whose fields already passed {@link checkCard}. The job lines come first, as typed;
 * the arbiter block is built only from the card's own fields.
 * @param {ReturnType<typeof cardFields>} card
 * @returns {string}
 */
export function cardToProse(card) {
  const out = [card.job.replace(/\s+$/, '').replace(/^\s*\n/, ''), '', ARBITER_HEADING];
  out.push(`guardrail: cap $${capText(Number(card.capUsd))} per run`);
  if (!noDestination(card.destination)) out.push(`guardrail: send at line ${Number(card.destination.line)} to file:${card.destination.folder}`);
  for (const i of card.inputs) out.push(`guardrail: source ${i.role} = file:${i.path}`);
  return `${out.join('\n')}\n`;
}

/** The refusal for a path that does not name a readable regular file (realpath at the click). @param {string} p */
function fileProblem(p) {
  let real;
  try { real = realpathSync(p); } catch (/** @type {any} */ e) {
    return e?.code === 'ENOENT' || e?.code === 'ENOTDIR' || e?.code === 'ELOOP'
      ? 'is not there (no file at that path, or a link that points at nothing).' : `cannot be looked at (${e?.code ?? 'error'}).`;
  }
  let st;
  try { st = statSync(real); } catch (/** @type {any} */ e) { return `cannot be looked at (${e?.code ?? 'error'}).`; }
  if (!st.isFile()) return 'is a folder or something that is not a plain file — type the path of one file.';
  try { accessSync(real, fsConstants.R_OK); } catch { return 'is a file this panel is not allowed to read.'; }
  return null;
}

/**
 * Every $0 check on the card, before any spawn (scope 6). Collects all refusals so the page can name every box.
 * @param {ReturnType<typeof cardFields>} card
 * @param {{ root: string, env?: Record<string, string|undefined> }} ctx `env` = the merged keys env: a key value typed into any box is refused
 * @returns {{ ok: true, prose: string }|{ ok: false, refusals: {field: string, say: string}[] }}
 */
export function checkCard(card, { root, env = {} }) {
  /** @type {{field: string, say: string}[]} */
  const refusals = [];
  const no = (field, say) => refusals.push({ field, say });

  // flow name: the CLI's own check, and not an existing flow
  const name = checkFlowName(card.flowName);
  if (!name.ok) no('flowName', `${name.red}. Use lowercase letters, digits, "-" or "_".`);
  else {
    let there = true;
    try { lstatSync(join(root, card.flowName)); } catch { there = false; }
    if (there) no('flowName', `There is already a flow named "${card.flowName}" here. Pick a name that is not used yet.`);
  }

  // job
  if (card.job.trim() === '') no('job', 'The job is empty. Write the job as numbered lines.');
  else if (/^\s*arbiter guardrails\b/im.test(card.job)) {
    no('job', 'The job contains an "Arbiter guardrails" heading. The cap, the destination and the inputs go in their own boxes, not in the job text.');
  }

  // cap
  if (typeof card.capUsd === 'string' || typeof card.capUsd === 'number') {
    if (!(Number.isFinite(Number(card.capUsd)) && Number(card.capUsd) > 0)) no('capUsd', 'The cap must be a number above 0 (dollars per run).');
  } else no('capUsd', 'The cap must be a number above 0 (dollars per run).');

  // destination: both boxes or neither
  const dest = card.destination;
  if (!noDestination(dest)) {
    const line = Number(dest.line);
    if (!(typeof dest.line === 'number' || (typeof dest.line === 'string' && dest.line !== '')) || !Number.isInteger(line) || line < 1) {
      no('destination', 'The destination line must be a whole number: the job line whose result is sent.');
    } else if (dest.folder === '') no('destination', 'The destination has a line but no folder. Type the folder, or clear the line for no send.');
    else if (CONTROL_RE.test(dest.folder)) no('destination', 'The destination folder has a character that cannot be in a path.');
    else {
      const d = checkSendDestination(`file:${dest.folder}`, { root });
      if (!d.ok) no('destination', `${d.red.replace(/^destination: /, '')}.`);
    }
  }

  // inputs: a role and a path on every row; no repeated role; each path a readable regular file (realpath)
  const seen = new Set();
  card.inputs.forEach((row, n) => {
    const field = `inputs.${n}`;
    if (row.role === '' && row.path === '') { no(field, 'This input row is empty. Fill it in or remove it.'); return; }
    if (row.role === '') { no(field, 'This input has a path but no role. Give it a name such as "resume".'); return; }
    if (!ROLE_RE.test(row.role)) { no(field, `The role "${row.role}" must be lowercase letters, digits, "-" or "_", starting with a letter.`); return; }
    if (seen.has(row.role)) { no(field, `The role "${row.role}" is used twice. Each input needs its own role.`); return; }
    seen.add(row.role);
    if (row.path === '') { no(field, `The input "${row.role}" has a role but no path.`); return; }
    if (CONTROL_RE.test(row.path)) { no(field, `The path for "${row.role}" has a character that cannot be in a path.`); return; }
    if (!isAbsolute(row.path)) { no(field, `The path for "${row.role}" must be a full path starting with "/".`); return; }
    const why = fileProblem(row.path);
    if (why) no(field, `The path for "${row.role}" ${why}`);
  });

  // a provider key typed into any box never reaches a file
  const keys = Object.values(PROVIDER_SLOTS).map((p) => env[p.envVar]).filter((k) => typeof k === 'string' && k.length >= 8);
  if (keys.length > 0) {
    const boxes = [['job', card.job], ['flowName', card.flowName], ['destination', dest.folder], ...card.inputs.map((r, n) => [`inputs.${n}`, `${r.role}\n${r.path}`])];
    for (const [field, text] of boxes) if (keys.some((k) => String(text).includes(k))) no(String(field), 'This box contains an API key. Keys go in Settings only. Nothing was saved.');
  }

  if (refusals.length > 0) return { ok: false, refusals };

  // the parser has the last word on the job lines and the block (a send line that is not a job line, a bad ask mark)
  const prose = cardToProse(card);
  const parsed = parseSignedText(prose);
  if (!parsed.ok) {
    for (const red of parsed.reds) {
      const field = /field "sends"/.test(red) ? 'destination' : /field "capUsd"/.test(red) ? 'capUsd' : /field "sources"/.test(red) ? 'inputs' : 'job';
      no(field, `${red.replace(/^(signed-text|arbiter): /, '')}.`);
    }
    return { ok: false, refusals };
  }
  return { ok: true, prose };
}
