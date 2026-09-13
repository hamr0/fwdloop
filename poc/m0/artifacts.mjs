// The artifact-space schema (PRD §6 M0a doctrine, verbatim): "There is NO
// wiring layer. A step emits ONE typed artifact carrying its citations; the
// next step reads it BY ID." Steps share one artifact space — fwdloop's
// stand-in for bareloop's tree — and plumbing is ADDRESSED, not authored.
//
// This module does not change what mechanical.mjs's gather() or close.mjs's
// citation checks already produce and consume (both already work, both
// already have passing tests) — it wraps their shapes so they are
// addressable by a stable id and rejects a malformed artifact loudly, same
// discipline as provider.mjs/catalogue.mjs: throw, never default, never
// return something partially valid.
//
// Two artifact kinds exist today (mechanical.mjs's `gather`): `csv` and
// `text`. Two more are the missing half of the doctrine above — a step's
// OWN output (close.mjs's `derive`/`compose` shapes) currently has no id a
// later step can declare a read against. `derive`/`compose` here are that
// missing addressable wrapper; they do not re-implement the close, they
// only make its output referenceable.

import { parseCellRef } from './csv.mjs';

/** Source kinds gather() already produces; output kinds a derive/compose step produces. */
const SOURCE_KINDS = Object.freeze(['csv', 'text']);
const OUTPUT_KINDS = Object.freeze(['derive', 'compose']);
export const ARTIFACT_KINDS = Object.freeze([...SOURCE_KINDS, ...OUTPUT_KINDS]);

// Required top-level fields per kind, matching what mechanical.mjs's gather()
// and close.mjs's closeDerive/closeCompose already require of their inputs.
const REQUIRED_FIELDS = Object.freeze({
  csv: ['path', 'sha256', 'header', 'rows'],
  text: ['path', 'sha256', 'lines'],
  derive: ['citations', 'fields'],
  compose: ['citations', 'text'],
});

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/** Artifact ids: a stable, referenceable identifier — letters/digits/_/- only,
 *  starting with a letter. Throws loudly rather than accepting a blank or
 *  punctuation-heavy id that would be unreadable in an audit trail. */
export function assertArtifactId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`artifact id must be a non-empty identifier (letters, digits, _, - — starting with a letter), got ${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * Build and validate one artifact for the shared artifact space. `payload`
 * is whatever gather() or a derive/compose step already produced — this
 * only wraps it with `{id, kind}` and checks the fields that kind requires
 * are actually present. Throws on: an unknown kind, a non-object payload,
 * or any missing required field — never returns a partially-valid artifact.
 */
export function makeArtifact(id, kind, payload) {
  assertArtifactId(id);
  if (!ARTIFACT_KINDS.includes(kind)) {
    throw new Error(`unknown artifact kind "${kind}" — known kinds: ${ARTIFACT_KINDS.join(', ')}`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`artifact "${id}": payload must be an object`);
  }
  for (const field of REQUIRED_FIELDS[kind]) {
    if (payload[field] === undefined || payload[field] === null) {
      throw new Error(`artifact "${id}": missing required field "${field}" for kind "${kind}"`);
    }
  }
  return Object.freeze({
    id, kind, ...payload,
  });
}

/**
 * Resolve a sheet-style ref ("E2") against an already-built `csv` artifact
 * into fwdloop's citation contract, `{row, col, cell}` (e.g.
 * `{row: 2, col: "Amount", cell: "E2"}`) plus the raw cell value. Shaped to
 * fit what poc/m0/csv.mjs actually produces (`rows[i].rowNumber` /
 * `rows[i].cells[col]`) rather than forcing csv.mjs to change. Throws if
 * the ref doesn't parse or the cell doesn't exist — a citation that can't
 * be resolved must never render as a silent null.
 */
export function cellRef(csvArtifact, cell) {
  if (!csvArtifact || csvArtifact.kind !== 'csv') {
    throw new Error(`cellRef: not a csv artifact (got kind "${csvArtifact?.kind}")`);
  }
  const { col, row } = parseCellRef(cell);
  const found = csvArtifact.rows.find((r) => r.rowNumber === row);
  if (!found || found.cells[col] === undefined) {
    throw new Error(`cellRef: cell ${cell} does not exist in artifact "${csvArtifact.id}"`);
  }
  return {
    row, col, cell, value: found.cells[col],
  };
}

/**
 * One flow's artifact space: an ordered, append-only registry keyed by id.
 * "Plumbing is addressed, not authored" — a step never wires an artifact to
 * another step, it only declares which ids (already in the space) it
 * reads; this registry is what makes that declaration checkable.
 */
export class ArtifactSpace {
  constructor() {
    this._byId = new Map();
    this._order = [];
  }

  /** Add a validated artifact (from makeArtifact). Throws on a duplicate id —
   *  one writer per artifact, matching AGENT_RULES' one-writer-per-state rule. */
  declare(artifact) {
    if (!artifact || typeof artifact.id !== 'string') {
      throw new Error('declare: not a valid artifact (missing id) — build it with makeArtifact first');
    }
    if (this._byId.has(artifact.id)) {
      throw new Error(`artifact id "${artifact.id}" already declared — one writer per artifact`);
    }
    this._byId.set(artifact.id, artifact);
    this._order.push(artifact.id);
    return artifact;
  }

  /** Look up a declared artifact by id. Throws — never returns undefined. */
  get(id) {
    const artifact = this._byId.get(id);
    if (!artifact) throw new Error(`unknown artifact id "${id}" — not declared in this artifact space`);
    return artifact;
  }

  /** True if `id` exists in the space at all. */
  has(id) {
    return this._byId.has(id);
  }

  /** True only if `id` was declared strictly before `beforeId` — both must
   *  exist. Since a step emits exactly one artifact, declaration order IS
   *  step order: this is the mechanical check the M0a validator needs for
   *  "every artifact a step reads was declared by an earlier step." */
  declaredBefore(id, beforeId) {
    const i = this._order.indexOf(id);
    const j = this._order.indexOf(beforeId);
    if (i === -1) throw new Error(`unknown artifact id "${id}"`);
    if (j === -1) throw new Error(`unknown artifact id "${beforeId}"`);
    return i < j;
  }
}

/**
 * For the step that emits `stepArtifactId`, which of `readIds` are NOT
 * walkable (declared later, missing entirely, or self-referencing) —
 * empty array means the chain is walkable for this step. Never throws on a
 * bad id; a bad id is exactly what this is meant to catch.
 */
export function unwalkableReads(space, stepArtifactId, readIds) {
  return readIds.filter((readId) => {
    if (readId === stepArtifactId) return true;
    if (!space.has(readId) || !space.has(stepArtifactId)) return true;
    return !space.declaredBefore(readId, stepArtifactId);
  });
}
