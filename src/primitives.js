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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createShellTools } from 'bare-agent/tools';

import { primitiveFor } from './catalogue.js';
import { readDocxText } from './docx.js';
import { parseCsv } from './csv.js';

const { tools: SHELL_TOOLS } = createShellTools();

function shellTool(name) {
  const found = SHELL_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`primitives: bare-agent/tools does not export a "${name}" tool`);
  return found;
}

/** True when `candidate` resolves inside one of `allowedRoots` (or IS one of
 *  them) — lexical containment only, matching `src/runner.js`'s own
 *  `checkSendDestination` shape (a symlink escape is out of this check's
 *  scope; the run dir is created fresh by `runFlow`, never attacker-placed). */
function isPathAllowed(candidate, allowedRoots) {
  const resolved = path.resolve(candidate);
  return allowedRoots.some((root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}

function sandboxError(verb, candidatePath) {
  return new Error(`${verb}: "${candidatePath}" is outside the sandbox (the run dir and its frozen inputs) — refused`);
}

function sandboxedReadTool(allowedRoots) {
  const real = shellTool('shell_read');
  return {
    name: 'read',
    description: real.description,
    parameters: real.parameters,
    execute: async (args) => {
      if (!isPathAllowed(args?.path, allowedRoots)) throw sandboxError('read', args?.path);
      return real.execute(args);
    },
  };
}

function sandboxedGrepTool(allowedRoots) {
  const real = shellTool('shell_grep');
  return {
    name: 'grep',
    description: real.description,
    parameters: real.parameters,
    execute: async (args) => {
      if (!isPathAllowed(args?.path, allowedRoots)) throw sandboxError('grep', args?.path);
      return real.execute(args);
    },
  };
}

function sandboxedWriteTool(allowedRoots) {
  const real = shellTool('shell_write');
  return {
    name: 'write',
    description: real.description,
    parameters: real.parameters,
    execute: async (args) => {
      if (!isPathAllowed(args?.path, allowedRoots)) throw sandboxError('write', args?.path);
      return real.execute(args);
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
  const allowedRoots = [runDir, ...inputs.map((entry) => path.dirname(entry.frozen))];
  const inputsByRole = Object.fromEntries(inputs.map((entry) => [entry.id, entry.frozen]));

  const tools = {};
  const reds = [];

  for (const verb of grantedVerbs ?? []) {
    const entry = primitiveFor(catalogue, verb);
    if (!entry) {
      reds.push(`primitives: verb "${verb}" is not in the catalogue`);
      // eslint-disable-next-line no-continue
      continue;
    }
    switch (verb) {
      case 'read':
        tools.read = sandboxedReadTool(allowedRoots);
        break;
      case 'grep':
        tools.grep = sandboxedGrepTool(allowedRoots);
        break;
      case 'write':
        tools.write = sandboxedWriteTool(allowedRoots);
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
