// M2 piece 2 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED"): the granted tools a step's live model call actually gets. Menu-
// is-inventory (M1's own rule, carried here): a verb the catalogue doesn't
// carry is a red, never a stub.
//
// borrowed-from: fwdloop poc/m0/runner.mjs@76a3607 (the `shellTool` lookup
// over `createShellTools()`, and read/write going through a real baresuite
// primitive rather than a second bespoke fs call) and fwdloop
// poc/m0/csv.mjs@76a3607 / poc/m0/docx.mjs@76a3607 (now ported at
// src/csv.js / src/docx.js — fwdloop's own citation-contract primitives,
// F13). Rewritten for M2's shape: `read`/`write`/`grep` are sandboxed here
// (M0b handed the model no tools directly and had the runner call
// `execute` itself; M2's executor hands granted tools straight to the
// model, so the sandbox check must live INSIDE each tool's own `execute`,
// not in a caller the model never reaches).
//
// Scope note (flagged, not invented quietly): only `read`, `write`, `grep`,
// `readDocx`, `addressCells` are wired here — the catalogue's litectx verbs
// (`recall`, `get`, `recent`, `compress`, `peek`, `stash`, `remember`,
// `forget`) are catalogue-present but NOT resolved by this piece; a step
// granted one of them gets every OTHER granted verb and a `reds` entry
// naming the gap, rather than a hard stop for the whole step — this is a
// signed-scope gap for hamr's ruling (job #2's step 3 declares `compress`,
// which this piece cannot yet honour).

import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createShellTools, resolveToolPath } from 'bare-agent/tools';
import { Gate } from 'bareguard';

import { primitiveFor } from './catalogue.js';
import { readDocxText } from './docx.js';
import { parseCsv } from './csv.js';

// bare-agent >=0.47.0: `noFollowSymlinks: true` makes shell_read/write/edit/
// grep throw `err.code === 'ELOOP'` when the path's FINAL component is a
// symlink (file, dir, or dangling) — verified directly against the
// installed package (a symlinked file/dir/dangling-link all throw ELOOP; a
// real file still reads). This closes the "open what the check approved"
// gap the lexical-only `isPathAllowed` this module used to run could not:
// a symlink planted inside the run dir after the gate check but before the
// real open used to be followed silently.
const { tools: SHELL_TOOLS } = createShellTools({ noFollowSymlinks: true });

function shellTool(name) {
  const found = SHELL_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`primitives: bare-agent/tools does not export a "${name}" tool`);
  return found;
}

/**
 * Resolve a model-given path string against `runDir` and pass it through the
 * step's bareguard `Gate`. A `~`-prefixed or already-absolute path is handed
 * to `resolveToolPath` as-is (it expands `~`/normalizes); anything else is
 * joined onto `runDir` first, THEN resolved — so a relative path always
 * lands inside the run dir before the gate ever sees it, matching
 * bareguard's own "agent paths must be absolute" rule (`fs.invalidPath`
 * otherwise). The SAME resolved string that was checked is what the caller
 * must hand to the real tool's `execute` — never re-derive a second string
 * after the decision (F48's own re-check rule: check and open the same
 * value). Throws naming the verb, the path, and bareguard's own rule name
 * on a deny; returns the resolved path on allow.
 */
/** Typed carrier for a bareguard fs-gate deny: `model-step` catches it by
 *  `instanceof` and records `{verb, path, rule}` on the attempt's audit row —
 *  never parsed back out of the message string. */
export class GateRefusal extends Error {
  constructor(verb, resolved, rule) {
    super(`${verb}: "${resolved}" is outside the sandbox — refused (bareguard rule: ${rule})`);
    this.name = 'GateRefusal';
    this.verb = verb;
    this.path = resolved;
    this.rule = rule;
  }
}

async function resolveAndGate(gate, verb, tool, runDir, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new Error(`${verb}: path must be a non-empty string`);
  }
  const joined = (rawPath.startsWith('~') || path.isAbsolute(rawPath)) ? rawPath : path.join(runDir, rawPath);
  const resolved = resolveToolPath(joined);
  const type = verb === 'write' ? 'write' : 'read';
  const decision = await gate.check({ type, tool, path: resolved });
  if (decision.outcome !== 'allow') {
    throw new GateRefusal(verb, resolved, decision.rule);
  }
  return resolved;
}

/** Which primitive owns a frozen input's text, by extension of its frozen path —
 *  `.md`/`.txt` are read/grep's own text roles, `.docx` belongs to `readDocx`,
 *  `.csv` belongs to `addressCells`, anything else has no text primitive.
 *  Pure and exported so tests can hit the four cases directly (F41 item 3). */
export function rolePrimitiveFor(frozenPath) {
  const ext = path.extname(frozenPath).toLowerCase();
  if (ext === '.md' || ext === '.txt') return 'read';
  if (ext === '.docx') return 'readDocx';
  if (ext === '.csv') return 'addressCells';
  return null;
}

/** `read`/`grep` (unlike `write`) may also be granted a `role` naming one of
 *  the run's frozen inputs — the same `inputsByRole` map `readDocx`/
 *  `addressCells` use. `role` resolves to the frozen path and THEN goes
 *  through the same sandbox check as any path (the frozen path is always
 *  inside the gate's `readScope`, so this can never widen what a path-only call
 *  could already reach) — never a shortcut around the sandbox, just a name
 *  for a path the model was never handed directly. `role` wins when both
 *  `path` and `role` are given. */
function roleDescription(real, roles) {
  return `${real.description} Provide either "path" (sandboxed to the run dir and its frozen `
    + `inputs) or "role" naming a frozen input by role instead of a path — at least one of `
    + `path/role is required, and role wins if both are given. Available roles: ${roles.join(', ') || '(none)'}.`;
}

function roleParameters(real, roles) {
  const properties = { ...real.parameters.properties };
  // An empty enum is invalid JSON Schema — when there are no text roles, omit
  // `role` from the schema entirely rather than advertise a role that can never
  // be picked (F41 item 3: read/grep list only roles they can actually serve).
  if (roles.length > 0) properties.role = { type: 'string', enum: roles };
  return {
    ...real.parameters,
    properties,
    required: (real.parameters.required ?? []).filter((f) => f !== 'path'),
  };
}

/** Resolves `args.role`/`args.path` down to the one path to actually use,
 *  honouring "role wins if both given", then runs it through the SAME
 *  `resolveAndGate` every path-only call goes through (F41's own role
 *  contract: a role is a name for a path the model was never handed
 *  directly, never a shortcut around the sandbox check — a frozen input's
 *  directory is always in the gate's `readScope`, so this can never widen
 *  what a path-only call could already reach). Throws (never silently falls
 *  through) when neither is usable. `roles` is the TEXT-only role list (for
 *  the "no frozen input" message); the role lookup itself goes through the
 *  full `inputsByRole` map so a non-text role (e.g. a .docx) is refused BY
 *  NAME naming the primitive that owns it, even if the model passes a role
 *  the schema's enum never offered it (F41 item 3). */
async function resolveRoleOrPath(gate, verb, tool, runDir, args, inputsByRole, roles) {
  if (args && Object.prototype.hasOwnProperty.call(args, 'role') && args.role !== undefined) {
    // Own-key lookup: "__proto__"/"constructor" must not resolve to Object.prototype members.
    const frozen = Object.hasOwn(inputsByRole, args.role) ? inputsByRole[args.role] : undefined;
    if (!frozen) throw new Error(`${verb}: no frozen input for role "${args.role}" (available: ${roles.join(', ')})`);
    const owner = rolePrimitiveFor(frozen);
    if (owner === 'readDocx') throw new Error(`${verb}: role "${args.role}" is a .docx — use readDocx`);
    if (owner === 'addressCells') throw new Error(`${verb}: role "${args.role}" is a .csv — use addressCells`);
    if (owner !== 'read') {
      const ext = path.extname(frozen) || '(no extension)';
      throw new Error(`${verb}: role "${args.role}" is a ${ext} — no text primitive serves it`);
    }
    return resolveAndGate(gate, verb, tool, runDir, frozen);
  }
  return resolveAndGate(gate, verb, tool, runDir, args?.path);
}

function sandboxedReadTool(gate, runDir, inputsByRole) {
  const real = shellTool('shell_read');
  const textRoles = Object.keys(inputsByRole).filter((r) => rolePrimitiveFor(inputsByRole[r]) === 'read');
  return {
    name: 'read',
    description: roleDescription(real, textRoles),
    parameters: roleParameters(real, textRoles),
    execute: async (args) => {
      const resolvedPath = await resolveRoleOrPath(gate, 'read', 'read', runDir, args, inputsByRole, textRoles);
      return real.execute({ ...args, path: resolvedPath });
    },
  };
}

function sandboxedGrepTool(gate, runDir, inputsByRole) {
  const real = shellTool('shell_grep');
  const textRoles = Object.keys(inputsByRole).filter((r) => rolePrimitiveFor(inputsByRole[r]) === 'read');
  return {
    name: 'grep',
    description: roleDescription(real, textRoles),
    parameters: roleParameters(real, textRoles),
    execute: async (args) => {
      const resolvedPath = await resolveRoleOrPath(gate, 'grep', 'grep', runDir, args, inputsByRole, textRoles);
      return real.execute({ ...args, path: resolvedPath });
    },
  };
}

function sandboxedWriteTool(gate, runDir, outDir) {
  const real = shellTool('shell_write');
  return {
    name: 'write',
    description: `${real.description} Sandboxed: only reaches <runDir>/out — the run dir root, its `
      + 'frozen inputs, state.json, audit.jsonl, spend.jsonl and any other run record are never '
      + 'writable, even though some are readable.',
    parameters: real.parameters,
    execute: async (args) => {
      const resolvedPath = await resolveAndGate(gate, 'write', 'write', runDir, args?.path);
      // Created lazily, on the FIRST actual write (never at tool-resolve
      // time) — `bin/fwdloop` calls `resolvePrimitives` to build a step's
      // tools BEFORE `runFlow` creates the run dir at all (a predicted-path
      // call, deliberately touching nothing on disk yet, per its own
      // comment: "runFlow... owns the ONLY mkdirSync/freezeInputs for this
      // run dir, so a refusal leaves nothing behind"). Creating `out/` any
      // earlier than this would leave a run dir behind even when `runFlow`
      // itself goes on to refuse the run (e.g. F46's unwired-verb
      // preflight) — silently breaking that contract. `resolveAndGate`
      // above already ran the gate check against a not-yet-existing root
      // (bareguard resolves a missing root by walking up to its nearest
      // existing ancestor — see fs.js — so the check needs no directory to
      // exist first); `shell_write` itself also creates parent directories
      // as needed, so this is belt-and-suspenders, not load-bearing.
      mkdirSync(outDir, { recursive: true });
      return real.execute({ ...args, path: resolvedPath });
    },
  };
}

/** `readDocx`/`addressCells` take a `role` naming one of the run's frozen
 *  inputs (never a raw path — the model is never handed a filesystem path
 *  to type back, so there is nothing to sandbox-check on the way in). */
function readDocxPrimitiveTool(inputsByRole) {
  const roles = Object.keys(inputsByRole);
  return {
    name: 'readDocx',
    description: `Read a Word (.docx) file's text, by role. Available roles: ${roles.join(', ') || '(none)'}.`,
    parameters: {
      type: 'object', properties: { role: { type: 'string', enum: roles } }, required: ['role'],
    },
    execute: async ({ role }) => {
      const frozen = inputsByRole[role];
      if (!frozen) throw new Error(`readDocx: no frozen input for role "${role}" (available: ${roles.join(', ')})`);
      const result = readDocxText(frozen);
      if (!result.ok) throw new Error(`readDocx: ${result.red}`);
      return { text: result.text, paragraphs: result.paragraphs };
    },
  };
}

function addressCellsPrimitiveTool(inputsByRole) {
  const roles = Object.keys(inputsByRole);
  return {
    name: 'addressCells',
    description: `Read a CSV spreadsheet as addressable cells, by role. Available roles: ${roles.join(', ') || '(none)'}.`,
    parameters: {
      type: 'object', properties: { role: { type: 'string', enum: roles } }, required: ['role'],
    },
    execute: async ({ role }) => {
      const frozen = inputsByRole[role];
      if (!frozen) throw new Error(`addressCells: no frozen input for role "${role}" (available: ${roles.join(', ')})`);
      const text = readFileSync(frozen, 'utf8');
      const { header, rows } = parseCsv(text);
      return { kind: 'cells', header, rows };
    },
  };
}

/** The verbs this piece actually implements (the switch below, as data) —
 *  one writer for "is this verb wired": `resolvePrimitives`'s own reds use
 *  it, and `src/runner.js`'s preflight (F46: a step granted a
 *  catalogue-present-but-unwired verb, e.g. litectx's `compress`, must
 *  refuse before any model call or spend) imports this SAME set rather than
 *  keeping a second copy of the list. */
export const WIRED_VERBS = new Set(['read', 'grep', 'write', 'readDocx', 'addressCells']);

/**
 * Resolve the granted tools for one step's model call. Never throws —
 * a verb absent from the catalogue, or present but unimplemented here, is
 * reported in `reds` and simply absent from `tools` (menu-is-inventory:
 * absence, not a stub).
 *
 * @param {import('./types.js').CatalogueEntry[]} catalogue - `loadCatalogue().primitives` (or an injected test catalogue).
 * @param {string[]} grantedVerbs - `step.primitives`.
 * @param {{ runDir: string, inputs?: Array<{id:string, frozen:string}> }} ctx
 * @returns {{ tools: Record<string, any>, reds: string[] }}
 */
export function resolvePrimitives(catalogue, grantedVerbs, ctx) {
  const { runDir, inputs = [] } = ctx;
  const inputsByRole = Object.fromEntries(inputs.map((entry) => [entry.id, entry.frozen]));
  const outDir = path.join(runDir, 'out');

  // One bareguard Gate per step: read reaches the run dir and every frozen
  // input's own directory (deduped — several inputs can share a dir); write
  // reaches ONLY `<runDir>/out`, never the run dir root (state.json,
  // audit.jsonl, spend.jsonl, answer*.json, ask.json, inputs/ all live at
  // the run dir root — readable, never writable). No tools/rwx/budget block:
  // this gate exists to answer fs questions only, nothing else a step here
  // can do goes through it.
  const readScope = [...new Set([runDir, ...inputs.map((entry) => path.dirname(entry.frozen))])];
  const gate = new Gate({ fs: { readScope, writeScope: [outDir] } });

  const tools = {};
  const reds = [];

  for (const verb of grantedVerbs ?? []) {
    const entry = primitiveFor(catalogue, verb);
    if (!entry) {
      reds.push(`primitives: verb "${verb}" is not in the catalogue`);
      // eslint-disable-next-line no-continue
      continue;
    }
    if (!WIRED_VERBS.has(verb)) {
      reds.push(`primitives: verb "${verb}" is in the catalogue but has no M2 implementation yet`);
      // eslint-disable-next-line no-continue
      continue;
    }
    switch (verb) {
      case 'read':
        tools.read = sandboxedReadTool(gate, runDir, inputsByRole);
        break;
      case 'grep':
        tools.grep = sandboxedGrepTool(gate, runDir, inputsByRole);
        break;
      case 'write':
        // `out/` itself is created lazily, inside the tool's own `execute`
        // on the first actual write — never here. `resolvePrimitives` can
        // be called against a PREDICTED runDir before it exists at all
        // (`bin/fwdloop`'s own "run" command does exactly this, deliberately
        // touching nothing on disk before `runFlow` itself creates the run
        // dir) — creating `out/` eagerly here would leave a run dir behind
        // even for a run `runFlow` goes on to refuse.
        tools.write = sandboxedWriteTool(gate, runDir, outDir);
        break;
      case 'readDocx':
        tools.readDocx = readDocxPrimitiveTool(inputsByRole);
        break;
      case 'addressCells':
        tools.addressCells = addressCellsPrimitiveTool(inputsByRole);
        break;
      default:
        reds.push(`primitives: verb "${verb}" is in the catalogue but has no M2 implementation yet`);
    }
  }

  return { tools, reds };
}
