// M4e piece 2a, items 1-2 (docs/wiki/the-module-ladder.md, "M4e", scope 2 and 6): the job card -> the prose file
// `fwdloop draft` reads, and the $0 checks that run before any spawn. Pure of the panel: no HTTP, no spawn, no
// writes — it reads the disk only to check the card's paths (realpathSync at the click, as the signed text says).
//
// The card writes EXACTLY the shape `flows/<flow>/prose.txt` has: the job box's lines turned into the job file (`N. text`,
// `   guardrail: text`, `N. ask <wait>: question` — M4e amendment 2), then the "Arbiter guardrails" block built ONLY from the card's
// typed fields — cap, send at the LAST step to the folder, one `source <role> = file:<path>` per input line. The drafter never writes
// any of it (hard line); this file is the only place the block is built.
//
// Every refusal is `{ field, say }`: the box it names and a plain sentence. A refusal spends $0 and creates
// nothing — this module writes nothing at all.
import {
  accessSync, constants as fsConstants, lstatSync, realpathSync, statSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { checkFlowName } from '../flow.js';
import { checkSendDestination, resolveCeilingUsd } from '../runner.js';
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

/** The ask wait the card takes (amendment 2 item 5): a whole number above 0 with `m` or `h`, nothing else. */
const WAIT_RE = /^(\d+)([mh])$/i;
/** @param {string} t @returns {boolean} */
export const isAskWait = (t) => { const m = WAIT_RE.exec(t); return m !== null && Number(m[1]) > 0; };

/** The first 40 characters of a line, for a refusal sentence. @param {string} t */
const snip = (t) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

/**
 * The job box (M4e amendment 2 item 1), a pure function of its text. One non-empty line is one step; a line starting with `~` is a
 * guardrail of the step above; `Ask:` / `Ask 2h:` (case-insensitive) is an ask with the card's wait / its own wait; empty lines are
 * dropped. A refusal is `{ line, say }`, `line` = the 1-based line of the box (blank lines count, so the human can find it).
 * @param {string} text
 * @returns {{ steps: { n: number, text: string, ask: null | { wait: string|null, question: string }, guardrails: string[] }[], refusals: { line: number, say: string }[] }}
 */
export function parseJobBox(text) {
  /** @type {{ n: number, text: string, ask: null | { wait: string|null, question: string }, guardrails: string[] }[]} */
  const steps = [];
  /** @type {{ line: number, say: string }[]} */
  const refusals = [];
  String(text).split('\n').forEach((raw, i) => {
    const t = raw.trim();
    if (t === '') return;
    const at = i + 1;
    const no = (say) => refusals.push({ line: at, say: `Line ${at} ("${snip(t)}") ${say}` });
    if (t.startsWith('~')) {
      const g = t.slice(1).trim();
      if (steps.length === 0) no('starts with ~ but no step is above it. A ~ line belongs to the step above, so put a step first.');
      else if (g === '') no('is only a ~. Write the guardrail after it.');
      else steps[steps.length - 1].guardrails.push(g);
      return;
    }
    const n = steps.length + 1;
    if (/^ask[: ]/i.test(t)) {
      const m = /^ask(?:\s+(\d+)\s*([mh]))?\s*:\s*(.*)$/i.exec(t);
      if (!m) no('is not an ask. Write it as "Ask: question" or "Ask 2h: question" (m for minutes, h for hours).');
      else if (m[1] !== undefined && Number(m[1]) <= 0) no('has an ask wait of 0. The wait must be above 0.');
      else if (m[3] === '') no('is an ask with no question after the colon.');
      else steps.push({ n, text: t, ask: { wait: m[1] === undefined ? null : `${Number(m[1])}${m[2].toLowerCase()}`, question: m[3] }, guardrails: [] });
      return;
    }
    steps.push({ n, text: t, ask: null, guardrails: [] });
  });
  return { steps, refusals };
}

/** The job file lines (`N. text`, `   guardrail: text`, `N. ask <wait>: question`) for parsed steps; the wait is ALWAYS written out. @param {ReturnType<typeof parseJobBox>['steps']} steps @param {string} askWait */
export function jobFileLines(steps, askWait) {
  /** @type {string[]} */
  const out = [];
  for (const s of steps) {
    out.push(s.ask ? `${s.n}. ask ${s.ask.wait ?? askWait.toLowerCase()}: ${s.ask.question}` : `${s.n}. ${s.text}`);
    for (const g of s.guardrails) out.push(`   guardrail: ${g}`);
  }
  return out;
}

/**
 * The inputs box (amendment 2 item 2): one `name: path` per non-empty line, split at the FIRST colon. `line` is the line's own number
 * as the box shows it (empty lines are skipped and not numbered). A line with no colon is flagged `noColon`.
 * @param {string} text
 * @returns {{ line: number, role: string, path: string, noColon?: true }[]}
 */
export function parseInputLines(text) {
  /** @type {{ line: number, role: string, path: string, noColon?: true }[]} */
  const rows = [];
  for (const raw of String(text).split('\n')) {
    const t = raw.trim();
    if (t === '') continue;
    const line = rows.length + 1;
    const c = t.indexOf(':');
    if (c === -1) rows.push({ line, role: t, path: '', noColon: true });
    else rows.push({ line, role: t.slice(0, c).trim(), path: t.slice(c + 1).trim() });
  }
  return rows;
}

/**
 * Normalise what the page sent into the typed card (one reader of the request body's shape). Unknown fields are
 * dropped; nothing here judges a value. `inputs` is the inputs box's TEXT (`name: path` per line); `destination` is the folder.
 * @param {any} body
 */
export function cardFields(body) {
  const b = body && typeof body === 'object' ? body : {};
  return {
    flowName: str(b.flowName).trim(),
    job: str(b.job).replace(/\r\n?/g, '\n'),
    destination: str(b.destination).trim(),
    inputs: str(b.inputs).replace(/\r\n?/g, '\n'),
    capUsd: typeof b.capUsd === 'string' && b.capUsd.trim() !== '' ? Number(b.capUsd) : b.capUsd,
    askWait: str(b.askWait).trim(),
  };
}

/** The Run-a-signed-flow door's rows (a role is fixed by the signed flow): what the page sent, as `{role, path}`. @param {any} v */
export function runInputRows(v) {
  return (Array.isArray(v) ? v : []).map((r) => ({ role: str(r?.role).trim(), path: str(r?.path).trim() }));
}

/**
 * The prose file text for a card whose fields already passed {@link checkCard}. The job lines come first (the job box's steps as the
 * job file); the arbiter block is built only from the card's own fields. The ONE card -> prose function.
 * @param {ReturnType<typeof cardFields>} card
 * @returns {string}
 */
export function cardToProse(card) {
  const { steps } = parseJobBox(card.job);
  const out = [...jobFileLines(steps, card.askWait), '', ARBITER_HEADING];
  out.push(`guardrail: cap $${capText(Number(card.capUsd))} per run`);
  if (card.destination !== '') out.push(`guardrail: send at line ${steps.length} to file:${card.destination}`);
  for (const i of parseInputLines(card.inputs)) out.push(`guardrail: source ${i.role} = file:${i.path}`);
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
 * The $0 check of the input rows, shared by the card (draft door) and the Run-a-signed-flow door: a role and a path on every row,
 * a role shape the signed-text parser accepts and used once, each path a full path to a readable regular file (realpath at the
 * click). Never reads a file's contents. A row from the card's inputs box carries its `line`: its refusal is field `inputs` and its
 * sentence starts "Line N:". A Run-door row has no line: its refusal is field `inputs.<n>`.
 * @param {{role: string, path: string, line?: number, noColon?: true}[]} rows
 * @returns {{field: string, say: string}[]} one refusal per bad row
 */
export function checkInputRows(rows) {
  /** @type {{field: string, say: string}[]} */
  const refusals = [];
  const seen = new Set();
  rows.forEach((row, n) => {
    const no = (say) => refusals.push(row.line === undefined ? { field: `inputs.${n}`, say } : { field: 'inputs', say: `Line ${row.line}: ${say}` });
    if (row.noColon) { no('write it as name: path (for example resume: /home/me/resume.md).'); return; }
    if (row.role === '' && row.path === '') { no('This input row is empty. Fill it in or remove it.'); return; }
    if (row.role === '') { no('This input has a path but no role. Give it a name such as "resume".'); return; }
    if (!ROLE_RE.test(row.role)) { no(`The role "${row.role}" must be lowercase letters, digits, "-" or "_", starting with a letter.`); return; }
    if (seen.has(row.role)) { no(`The role "${row.role}" is used twice. Each input needs its own role.`); return; }
    seen.add(row.role);
    if (row.path === '') { no(`The input "${row.role}" has a role but no path.`); return; }
    if (CONTROL_RE.test(row.path)) { no(`The path for "${row.role}" has a character that cannot be in a path.`); return; }
    if (!isAbsolute(row.path)) { no(`The path for "${row.role}" must be a full path starting with "/".`); return; }
    const why = fileProblem(row.path);
    if (why) no(`The path for "${row.role}" ${why}`);
  });
  return refusals;
}

/**
 * M4e amendment 4 item 2: the smallest per-run cap that funds ONE round of the first model step. The runner halts a step when
 * `spent + ceiling > cap` (`runStepRalph`), and every ordinary (non-ask) step is a model step, so the floor is the runner's own
 * per-round ceiling (`resolveCeilingUsd`) as soon as the job has one such line; a job of only asks spends nothing before its stop.
 * ONE function: the card's Draft check, Sign, and the page's note all read it. Returns 0 when no step needs a round.
 * @param {string} jobText
 */
export function capFloorUsd(jobText) {
  return parseJobBox(jobText).steps.some((s) => s.ask === null) ? resolveCeilingUsd(null) : 0;
}

/** The one sentence for a cap under the floor (red under Cap, and the Draft / sign refusal). @param {number} floorUsd */
export function capFloorText(floorUsd) {
  return `needs at least $${(Math.ceil(floorUsd * 100 - 1e-6) / 100).toFixed(2)} per run`;
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
  if (card.job.trim() === '') no('job', 'The job is empty. Write one step per line.');
  else if (/^\s*arbiter guardrails\b/im.test(card.job)) {
    no('job', 'The job contains an "Arbiter guardrails" heading. The cap, the destination and the inputs go in their own boxes, not in the job text.');
  } else for (const r of parseJobBox(card.job).refusals) no('job', r.say);

  // ask wait: a number with m or h (it is written out on every ask line)
  if (!isAskWait(card.askWait)) no('askWait', 'The ask wait must be a number with m or h, such as 30m or 1h.');

  // cap
  if (typeof card.capUsd === 'string' || typeof card.capUsd === 'number') {
    if (!(Number.isFinite(Number(card.capUsd)) && Number(card.capUsd) > 0)) no('capUsd', 'The cap must be a number above 0 (dollars per run).');
    else if (Number(card.capUsd) < capFloorUsd(card.job)) no('capUsd', capFloorText(capFloorUsd(card.job)));
  } else no('capUsd', 'The cap must be a number above 0 (dollars per run).');

  // destination: one folder, or empty for no send (it is sent at the last step)
  const dest = card.destination;
  if (dest !== '') {
    if (CONTROL_RE.test(dest)) no('destination', 'The destination folder has a character that cannot be in a path.');
    else {
      const d = checkSendDestination(`file:${dest}`, { root });
      if (!d.ok) no('destination', `${d.red.replace(/^destination: /, '')}.`);
    }
  }

  // inputs: one `name: path` per line; a role and a path on every line, no repeated role; each path a readable regular file (realpath)
  refusals.push(...checkInputRows(parseInputLines(card.inputs)));

  // a provider key typed into any box never reaches a file
  /** @type {string[]} */
  const keys = [];
  for (const p of Object.values(PROVIDER_SLOTS)) { const k = env[p.envVar]; if (typeof k === 'string' && k.length >= 8) keys.push(k); }
  if (keys.length > 0) {
    const boxes = [['job', card.job], ['flowName', card.flowName], ['destination', dest], ['inputs', card.inputs]];
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
