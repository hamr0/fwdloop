// The primitive catalogue, as data — the menu-is-inventory grant list M0a's
// drafter picks steps' primitives from. Every entry names an EXISTING
// implementation; nothing here is invented (PRD rule (f), F13).
//
// borrowed-from (shape only, never imported):
//   bareloop src/tools.js ~line 93 — TOOL_BY_VERB: 14 verbs in four
//   components (write/select/compress/isolate), every verb mapped to an
//   existing implementation.
//   litectx src/contextgraph.js ~line 38 — PRIMITIVES/VERBS_BY_PRIMITIVE/
//   PRIMITIVE (flat lookup) + SUBSTRATE ("recorded, but not a CE primitive").
//   fwdloop draws the same primitive-vs-plumbing line below (see FENCE).
//
// fwdloop's catalogue is those two shapes plus one component neither has:
// `io` — crossing OUTSIDE the process (mail egress, a human checkpoint) —
// because bareloop's steps never send anything and litectx's never leave
// the store. Plus fwdloop's own citation-contract entry: F13 RULED
// 2026-09-09 ("it is ours") that turning a file into addressable cells is
// NOT a baresuite primitive — a suite that parses every file format stops
// being a primitive set. `addressCells` is documented here as fwdloop's own
// contract, backed by poc/m0/csv.mjs, not filed as a gap.

/** Read-only vs mutating vs cross-run-store. Load-bearing for the M0a scout:
 *  its menu is filtered to `class: 'read'` so a write/store primitive is
 *  ABSENT from the menu, never merely refused (negative scenario v). */
export const CLASSES = Object.freeze(['read', 'write', 'store']);

export const CATALOGUE = Object.freeze([
  // write — bareloop's tree-mutation component (bare-agent/tools)
  {
    verb: 'write', component: 'write', package: 'bare-agent/tools', symbol: 'shell_write', class: 'write', skill: 'core',
  },
  {
    verb: 'edit', component: 'write', package: 'bare-agent/tools', symbol: 'shell_edit', class: 'write', skill: 'core',
  },
  // select — read-only retrieval (bare-agent/tools + litectx)
  {
    verb: 'read', component: 'select', package: 'bare-agent/tools', symbol: 'shell_read', class: 'read', skill: 'core',
  },
  {
    verb: 'grep', component: 'select', package: 'bare-agent/tools', symbol: 'shell_grep', class: 'read', skill: 'core',
  },
  {
    verb: 'recall', component: 'select', package: 'litectx', symbol: 'ctx_recall', class: 'read', skill: 'core',
  },
  {
    verb: 'get', component: 'select', package: 'litectx', symbol: 'ctx_get', class: 'read', skill: 'core',
  },
  {
    verb: 'impact', component: 'select', package: 'litectx', symbol: 'ctx_impact', class: 'read', skill: 'core',
  },
  {
    verb: 'related', component: 'select', package: 'litectx', symbol: 'ctx_related', class: 'read', skill: 'core',
  },
  {
    verb: 'recent', component: 'select', package: 'litectx', symbol: 'ctx_recent', class: 'read', skill: 'core',
  },
  // compress — read-only condensation (litectx)
  {
    verb: 'compress', component: 'compress', package: 'litectx', symbol: 'ctx_compress', class: 'read', skill: 'core',
  },
  {
    verb: 'peek', component: 'compress', package: 'litectx', symbol: 'ctx_peek', class: 'read', skill: 'core',
  },
  // isolate — cross-run store (litectx). litectx's own taxonomy files
  // stash/remember/forget under its "Write" primitive; fwdloop's `class`
  // splits that further into `store` (mutates the cross-run store) so a
  // read-only scout's filter removes it same as a tree `write`.
  {
    verb: 'stash', component: 'isolate', package: 'litectx', symbol: 'ctx_stash', class: 'store', skill: 'core',
  },
  {
    verb: 'remember', component: 'isolate', package: 'litectx', symbol: 'ctx_remember', class: 'store', skill: 'core',
  },
  {
    verb: 'forget', component: 'isolate', package: 'litectx', symbol: 'ctx_forget', class: 'store', skill: 'core',
  },
  // io — fwdloop's addition (see header): crosses outside the process.
  // Checkpoint pauses out to a human; mailproof sends out to the world.
  // Both are gated `write`-class for the same reason a tree write is: a
  // read-only scout must never be able to reach either.
  {
    verb: 'checkpoint', component: 'io', package: 'bare-agent', symbol: 'Checkpoint', class: 'write', skill: 'core',
  },
  // Real mail egress is explicitly gated behind its own signed allow-list
  // (PRD §6 M9: "behind the signed allow-list and a prior ask accept in the
  // same run") — a separate skill from the core drafting primitives above,
  // not the default M0a job #1 skillset.
  {
    verb: 'draftMail', component: 'io', package: 'mailproof', symbol: 'create', class: 'write', skill: 'mail-egress',
  },
  {
    verb: 'sendMail', component: 'io', package: 'mailproof', symbol: 'sendmail', class: 'write', skill: 'mail-egress',
  },
  // fwdloop's own citation contract — NOT a baresuite primitive.
  // F13 RULED 2026-09-09 ("it is ours"): reading bytes is bareloop's
  // shell_read; turning those bytes into addressable {row, col, cell} cells
  // is fwdloop's own domain contract, kept out of the baresuite components
  // above on purpose.
  {
    verb: 'addressCells', component: 'fwdloop', package: 'poc/m0/csv.mjs', symbol: 'parseCsv', class: 'read', skill: 'core',
  },
]);

const BY_VERB = new Map(CATALOGUE.map((entry) => [entry.verb, entry]));

/** Look up one catalogue entry by verb. THROWS on an unknown verb — never
 *  returns undefined, never defaults (same discipline as provider.mjs's
 *  makeProvider). This is the mechanical form of PRD rule (f): a primitive
 *  not in the catalogue is a red, never invented. */
export function primitiveFor(verb) {
  const entry = BY_VERB.get(verb);
  if (!entry) {
    throw new Error(`unknown primitive verb "${verb}" — not in the catalogue (known verbs: ${[...BY_VERB.keys()].join(', ')})`);
  }
  return entry;
}

/**
 * The drafter/scout's menu: the catalogue filtered by class and/or skill.
 * Absence, not refusal — a filtered-out verb is not present in the returned
 * array at all. `classes`/`skills` are allow-lists; omit either to leave
 * that axis unfiltered.
 */
export function menu({ classes, skills } = {}) {
  return CATALOGUE.filter(
    (entry) => (!classes || classes.includes(entry.class)) && (!skills || skills.includes(entry.skill)),
  );
}

// ---- plumbing, not primitives -----------------------------------------
// The line litectx already draws around index/get/related/getNode as
// SUBSTRATE ("recorded, but not a CE primitive") — fwdloop's equivalent is
// the per-step fence: bareguard's Gate/redact and bare-agent's wireGate.
// The runner wires these around EVERY step regardless of what the step
// does; the drafter never selects them, so they are deliberately absent
// from CATALOGUE, menu(), and primitiveFor() — recorded here only so job
// #1's "fence fs/net/secrets/budget per step" need has somewhere to resolve.
export const FENCE = Object.freeze([
  {
    name: 'fence', package: 'bareguard', symbol: 'Gate',
  },
  {
    name: 'redact', package: 'bareguard', symbol: 'redact',
  },
  {
    name: 'wireGate', package: 'bare-agent', symbol: 'wireGate',
  },
]);

// ---- job #1's needs, verbatim from F13's table --------------------------
// F13's table has 8 rows covering 9 needs (one row, "match a customer,
// derive figures", bundles two needs into fwdloop's own model-round + close
// machinery — never a catalogue primitive, `own: true` below). The 9th is
// the addressCells entry above. resolveJob1Need throws if a listed verb
// isn't in the catalogue, same as primitiveFor.
export const JOB1_NEEDS = Object.freeze([
  { need: 'read the message text', verbs: ['read'] },
  { need: 'read the AR sheet as addressable cells', verbs: ['addressCells'] },
  { need: 'match a customer, derive figures', own: true },
  { need: 'pause for a human', verbs: ['checkpoint'] },
  { need: 'write the reply out (dry-run egress)', verbs: ['write'] },
  { need: 'real mail egress (M9)', verbs: ['draftMail', 'sendMail'] },
  { need: 'fence fs/net/secrets/budget per step', fence: true },
  { need: 'memory across runs', verbs: ['remember', 'recall', 'stash'] },
]);

/**
 * Resolve one JOB1_NEEDS row to what actually covers it: catalogue entries
 * for a `verbs` row, FENCE for the fence row, or `{ own: true }` for the one
 * need that is fwdloop's own model-round + close, never a catalogue
 * primitive. Throws (via primitiveFor) if a listed verb is not real.
 */
export function resolveJob1Need(row) {
  if (row.own) return { own: true };
  if (row.fence) return FENCE;
  return row.verbs.map(primitiveFor);
}
