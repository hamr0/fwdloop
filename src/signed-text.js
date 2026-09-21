// derived-from: poc/m0/validator.mjs@288cb8a parseLines/parseArbiterGuardrails
// — rewritten, never imported. src must not import from poc (CLAUDE.md:
// "borrow, never import" — complete separation between poc/ and src/).
//
// M1 piece 1 (docs/wiki/the-module-ladder.md, "M1 — scope, exit, negative —
// SIGNED"): the human's signed text is numbered job lines, an optional
// `guardrail:` directly under a line (strict 1-for-1), then an
// "Arbiter guardrails" heading followed by `guardrail: <field>` lines in a
// fixed, typed grammar. This module turns that text into
// `{ lines, arbiter }` or a list of reds — it does not run anything, author
// a step, or touch declaration.json (that is the drafter's, later piece).
//
// ReDoS / "patterns are literal or typed, never user regex" (M1 signed scope
// item 6): every regex below is a fixed literal, anchored, with no nested
// quantifiers (no `(x+)+` shape), compiled once at module load. Signed text
// is only ever matched against these fixed patterns — never used to build a
// pattern. This file never constructs a RegExp dynamically at runtime.

/** @typedef {import('./types.js').SignedTextResult} SignedTextResult */

/** The arbiter fields this grammar defines — kept in sync with the parser
 *  below so a mutation suite can assert it tested every one of them. */
export const ARBITER_FIELDS = Object.freeze([
  'capUsd',
  'asks',
  'redoCap',
  'sends',
  'skills',
  'sources',
  'roundBudgetMs',
]);

const HEADING_RE = /^arbiter guardrails\b/i;
const NUMBERED_RE = /^(\d+)\.\s?(.*)$/;
const GUARDRAIL_RE = /^guardrail:\s?(.*)$/i;

const CAP_RE = /^cap \$([^\s]+) per run$/i;
const ASK_PREFIX_RE = /^ask at\b/i;
const ASK_RE = /^ask at line (\d+)(?: ttl (\d+)(s|m|h))?$/i;
const REDO_RE = /^redo cap (\S+)$/i;
const SEND_PREFIX_RE = /^send at\b/i;
const SEND_RE = /^send at line (\d+) to (\S+)$/i;
const SKILLS_RE = /^skills (.+)$/i;
const SKILL_NAME_RE = /^[a-z][a-z0-9_-]*$/;
const SOURCE_RE = /^([a-z][a-z0-9_-]*) = (.+)$/;
const ROUND_RE = /^round budget (\d+)(s|m|h)$/i;

const INT_RE = /^\d+$/;
const DECIMAL_RE = /^\d+(?:\.\d+)?$/;
const UNIT_MS = Object.freeze({ s: 1000, m: 60000, h: 3600000 });
const DEFAULT_ASK_TTL_MS = 30 * 60000;
const DEFAULT_REDO_CAP = 3;
const DEFAULT_SKILLS = Object.freeze(['core']);
const DEFAULT_ROUND_BUDGET_MS = 120000;

/**
 * Parse the human's signed text. Never throws — any input that isn't a
 * usable signed text comes back as `{ ok: false, reds }`, never an
 * exception, and a non-string input is itself a red.
 *
 * @param {unknown} rawText
 * @returns {SignedTextResult}
 */
export function parseSignedText(rawText) {
  if (typeof rawText !== 'string') {
    return deepFreeze({ ok: false, reds: ['signed-text: input must be a string'] });
  }

  const rawLines = rawText.split(/\r?\n/);
  const reds = [];
  const lines = [];
  const arbiterRawLines = [];
  let current = null;
  let inArbiter = false;
  let lastN = 0;

  for (let i = 0; i < rawLines.length; i += 1) {
    const fileLine = i + 1;
    const trimmed = rawLines[i].trim();
    if (trimmed.length === 0) continue;

    if (HEADING_RE.test(trimmed)) {
      inArbiter = true;
      current = null;
      continue;
    }

    if (inArbiter) {
      const gm = GUARDRAIL_RE.exec(trimmed);
      if (gm) {
        arbiterRawLines.push({ fileLine, text: gm[1].trim() });
      } else {
        reds.push(`arbiter: line ${fileLine} "${trimmed}" is not in the grammar`);
      }
      continue;
    }

    const nm = NUMBERED_RE.exec(trimmed);
    if (nm) {
      const n = Number(nm[1]);
      if (n <= lastN) {
        reds.push(`signed-text: line ${fileLine} number ${n} is not increasing after ${lastN}`);
      }
      lastN = Math.max(lastN, n);
      current = { n, text: nm[2].trim(), guardrail: '' };
      lines.push(current);
      continue;
    }

    const gm2 = GUARDRAIL_RE.exec(trimmed);
    if (gm2) {
      if (!current) {
        reds.push(`signed-text: line ${fileLine} "guardrail:" has no numbered line above it`);
        continue;
      }
      if (current.guardrail) {
        reds.push(`signed-text: line ${fileLine} is a second "guardrail:" for line ${current.n}`);
        continue;
      }
      current.guardrail = gm2[1].trim();
      continue;
    }

    reds.push(`signed-text: line ${fileLine} "${trimmed}" is neither a numbered line nor a guardrail`);
  }

  if (!inArbiter) {
    reds.push('arbiter: missing "Arbiter guardrails" heading (field "capUsd" is required)');
  }

  const arbiter = parseArbiter(arbiterRawLines, new Set(lines.map((l) => l.n)), reds);

  if (reds.length > 0) {
    return deepFreeze({ ok: false, reds });
  }

  return deepFreeze({
    ok: true,
    lines: lines.map(({ n, text, guardrail }) => ({ n, text, guardrail })),
    arbiter,
  });
}

/**
 * Parse the arbiter lines into the typed grammar, pushing every red found
 * onto `reds` (in the order the lines appear) and returning the assembled
 * fields. Called even when `reds` already carries earlier failures, so all
 * reds in the document are reported together, in source-line order.
 */
function parseArbiter(arbiterRawLines, lineNumbers, reds) {
  let capUsd;
  let capSeen = 0;
  const asks = [];
  const askLinesSeen = new Set();
  let redoCap;
  let redoSeen = 0;
  const sends = [];
  let skills;
  let skillsSeen = 0;
  const sources = [];
  const sourceRolesSeen = new Set();
  let roundBudgetMs;
  let roundSeen = 0;

  for (const { fileLine, text } of arbiterRawLines) {
    const lower = text.toLowerCase();

    if (lower.startsWith('cap ') || lower === 'cap') {
      capSeen += 1;
      const m = CAP_RE.exec(text);
      if (!m || !DECIMAL_RE.test(m[1])) {
        reds.push(`arbiter: line ${fileLine} field "capUsd" is not "cap $<decimal> per run": "${text}"`);
        continue;
      }
      const value = Number(m[1]);
      if (!(value > 0)) {
        reds.push(`arbiter: line ${fileLine} field "capUsd" must be > 0, got ${m[1]}`);
        continue;
      }
      if (capSeen > 1) {
        reds.push(`arbiter: line ${fileLine} field "capUsd" is duplicated (cap is allowed exactly once)`);
        continue;
      }
      capUsd = value;
      continue;
    }

    if (ASK_PREFIX_RE.test(text)) {
      const m = ASK_RE.exec(text);
      if (!m) {
        reds.push(`arbiter: line ${fileLine} field "asks" is not "ask at line <int>" (optional " ttl <int><s|m|h>"): "${text}"`);
        continue;
      }
      const line = Number(m[1]);
      if (!lineNumbers.has(line)) {
        reds.push(`arbiter: line ${fileLine} field "asks" names line ${line}, which is not one of the numbered lines`);
        continue;
      }
      if (askLinesSeen.has(line)) {
        reds.push(`arbiter: line ${fileLine} field "asks" duplicates "ask at line ${line}"`);
        continue;
      }
      askLinesSeen.add(line);
      const ttlMs = m[2] ? Number(m[2]) * UNIT_MS[m[3].toLowerCase()] : DEFAULT_ASK_TTL_MS;
      asks.push({ line, ttlMs });
      continue;
    }

    if (lower.startsWith('redo cap')) {
      redoSeen += 1;
      const m = REDO_RE.exec(text);
      if (!m || !INT_RE.test(m[1])) {
        reds.push(`arbiter: line ${fileLine} field "redoCap" is not "redo cap <int>": "${text}"`);
        continue;
      }
      const value = Number(m[1]);
      if (value < 1 || value > 3) {
        reds.push(`arbiter: line ${fileLine} field "redoCap" must be 1..3, got ${value}`);
        continue;
      }
      if (redoSeen > 1) {
        reds.push(`arbiter: line ${fileLine} field "redoCap" is duplicated (allowed at most once)`);
        continue;
      }
      redoCap = value;
      continue;
    }

    if (SEND_PREFIX_RE.test(text)) {
      const m = SEND_RE.exec(text);
      if (!m) {
        reds.push(`arbiter: line ${fileLine} field "sends" is not "send at line <int> to <target>": "${text}"`);
        continue;
      }
      const line = Number(m[1]);
      const target = m[2];
      const colon = target.indexOf(':');
      const kind = colon === -1 ? target : target.slice(0, colon);
      const path = colon === -1 ? '' : target.slice(colon + 1);
      if (!lineNumbers.has(line)) {
        reds.push(`arbiter: line ${fileLine} field "sends" names line ${line}, which is not one of the numbered lines`);
        continue;
      }
      if (sends.some((s) => s.line === line)) {
        reds.push(`arbiter: line ${fileLine} field "sends" duplicates a send at line ${line} (at most one send per line)`);
        continue;
      }
      if (kind.toLowerCase() !== 'file') {
        reds.push(`arbiter: line ${fileLine} field "sends" send target kind "${kind}" is not available until M9`);
        continue;
      }
      if (!path) {
        reds.push(`arbiter: line ${fileLine} field "sends" has an empty path`);
        continue;
      }
      sends.push({ line, target: { kind: 'file', path } });
      continue;
    }

    if (lower.startsWith('skills')) {
      skillsSeen += 1;
      const m = SKILLS_RE.exec(text);
      if (!m) {
        reds.push(`arbiter: line ${fileLine} field "skills" is not "skills <name>[, <name>...]": "${text}"`);
        continue;
      }
      const names = m[1].split(',').map((s) => s.trim());
      let anyBad = false;
      for (const name of names) {
        if (!SKILL_NAME_RE.test(name)) {
          reds.push(`arbiter: line ${fileLine} field "skills" name "${name}" is not [a-z][a-z0-9_-]*`);
          anyBad = true;
        }
      }
      if (anyBad) continue;
      if (skillsSeen > 1) {
        reds.push(`arbiter: line ${fileLine} field "skills" is duplicated (allowed at most once)`);
        continue;
      }
      skills = names;
      continue;
    }

    if (lower.startsWith('source ')) {
      if (text.includes(';') || text.includes(',')) {
        reds.push(`arbiter: line ${fileLine} field "sources" carries more than one source (";"/"," joined), one source per line: "${text}"`);
        continue;
      }
      const rest = text.slice('source '.length);
      const m = SOURCE_RE.exec(rest);
      if (!m) {
        reds.push(`arbiter: line ${fileLine} field "sources" is not "source <role> = file:<path>": "${text}"`);
        continue;
      }
      const role = m[1];
      const rhs = m[2];
      if (sourceRolesSeen.has(role)) {
        reds.push(`arbiter: line ${fileLine} field "sources" duplicates role "${role}"`);
        continue;
      }
      const colon = rhs.indexOf(':');
      const kind = colon === -1 ? rhs : rhs.slice(0, colon);
      const path = colon === -1 ? '' : rhs.slice(colon + 1).trim();
      if (kind.toLowerCase() !== 'file') {
        reds.push(`arbiter: line ${fileLine} field "sources" source kind "${kind}" is not available until M9`);
        continue;
      }
      if (!path) {
        reds.push(`arbiter: line ${fileLine} field "sources" has an empty path`);
        continue;
      }
      sourceRolesSeen.add(role);
      sources.push({ role, kind: 'file', path });
      continue;
    }

    if (lower.startsWith('round budget')) {
      roundSeen += 1;
      const m = ROUND_RE.exec(text);
      if (!m) {
        reds.push(`arbiter: line ${fileLine} field "roundBudgetMs" is not "round budget <int><s|m|h>": "${text}"`);
        continue;
      }
      if (roundSeen > 1) {
        reds.push(`arbiter: line ${fileLine} field "roundBudgetMs" is duplicated (allowed at most once)`);
        continue;
      }
      roundBudgetMs = Number(m[1]) * UNIT_MS[m[2].toLowerCase()];
      continue;
    }

    reds.push(`arbiter: line ${fileLine} "${text}" is not in the grammar`);
  }

  if (capUsd === undefined && capSeen === 0) {
    reds.push('arbiter: field "capUsd" is required ("cap $<decimal> per run") and is missing');
  }

  for (const s of sends) {
    if (!asks.some((a) => a.line < s.line)) {
      reds.push(`arbiter: field "sends" send at line ${s.line} has no ask at an earlier line (asks: [${asks.map((a) => a.line).join(', ')}])`);
    }
  }

  return {
    capUsd,
    asks,
    redoCap: redoCap ?? DEFAULT_REDO_CAP,
    sends,
    skills: skills ?? DEFAULT_SKILLS.slice(),
    sources,
    roundBudgetMs: roundBudgetMs ?? DEFAULT_ROUND_BUDGET_MS,
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
