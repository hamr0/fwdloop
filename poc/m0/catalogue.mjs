// The primitive catalogue, as data — the menu-is-inventory grant list M0a's
// drafter picks steps' primitives from. Every entry names an EXISTING
// implementation; nothing here is invented (PRD rule (f), F13) — proven
// mechanically, not by reading: catalogue.resolve.test.mjs dynamically
// imports every entry's `package` and checks its `symbol`/`method`/`tool`
// resolves against the real installed package (F23).
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
  // write — bareloop's tree-mutation component (bare-agent/tools). The
  // package exports a factory (createShellTools); `symbol` names the
  // factory and `tool` names the tool it produces (F23 fix — the old
  // `symbol: 'shell_write'` etc. named tool output, not an export).
  {
    verb: 'write', component: 'write', package: 'bare-agent/tools', symbol: 'createShellTools', tool: 'shell_write', class: 'write', skill: 'core', desc: 'Create or overwrite a file with given contents.',
  },
  {
    verb: 'edit', component: 'write', package: 'bare-agent/tools', symbol: 'createShellTools', tool: 'shell_edit', class: 'write', skill: 'core', desc: 'Change part of an existing file in place.',
  },
  // select — read-only retrieval (bare-agent/tools + litectx)
  {
    verb: 'read', component: 'select', package: 'bare-agent/tools', symbol: 'createShellTools', tool: 'shell_read', class: 'read', skill: 'core', desc: "Read a file's text.",
  },
  {
    verb: 'grep', component: 'select', package: 'bare-agent/tools', symbol: 'createShellTools', tool: 'shell_grep', class: 'read', skill: 'core', desc: 'Find lines matching a pattern across files.',
  },
  // litectx's ten verbs below are methods on its LiteCtx class, not the
  // `ctx_*` names bareloop's tool wrappers give them (F23 — corrected: the
  // bricks are real, only the catalogue's names were bareloop's, not
  // litectx's own exports). `symbol: 'LiteCtx'` + `method` names the
  // instance method fwdloop actually calls.
  {
    verb: 'recall', component: 'select', package: 'litectx', symbol: 'LiteCtx', method: 'recall', class: 'read', skill: 'core', desc: 'Search saved notes by meaning; returns the best matches, not their full text.',
  },
  {
    verb: 'get', component: 'select', package: 'litectx', symbol: 'LiteCtx', method: 'get', class: 'read', skill: 'core', desc: "Fetch the full text of one saved note or parked item by its id.",
  },
  // `impact`/`related` REMOVED (M0b orchestrator ruling): both walk a code
  // graph (callers/callees, import edges) and `impact` needs ripgrep.
  // fwdloop jobs have no code repo (PRD: "closes deterministically with no
  // repo") — a brick with no meaning in any fwdloop job is noise on the
  // drafter's menu, not a primitive to offer.
  {
    // recentActivity() is litectx's "recently edited code chunks" view —
    // not a job verb fwdloop has (no code repo). recentMemory() is the
    // recency sibling over saved notes, which fwdloop jobs do have.
    verb: 'recent', component: 'select', package: 'litectx', symbol: 'LiteCtx', method: 'recentMemory', class: 'read', skill: 'core', desc: 'List the most recently saved notes, newest first.',
  },
  // compress — read-only condensation (litectx). `compress` is a plain
  // module export (a function), not a LiteCtx method.
  {
    verb: 'compress', component: 'compress', package: 'litectx', symbol: 'compress', class: 'read', skill: 'core', desc: 'Shorten a piece of text to fit a small prompt (full, signature-only, or dropped).',
  },
  {
    verb: 'peek', component: 'compress', package: 'litectx', symbol: 'LiteCtx', method: 'peek', class: 'read', skill: 'core', desc: "Preview a parked item's start and end without loading all of it.",
  },
  // isolate — cross-run store (litectx). litectx's own taxonomy files
  // stash/remember/forget under its "Write" primitive; fwdloop's `class`
  // splits that further into `store` (mutates the cross-run store) so a
  // read-only scout's filter removes it same as a tree `write`.
  //
  // `remember`/`forget` carry skill "memory", NOT "core" (M0b orchestrator
  // ruling): the PRD's "Out of scope for v1" says "no learning between
  // flows" — these two write/delete memory that PERSISTS ACROSS RUNS, so a
  // job only gets them once a human signs the `memory` skill. `stash` stays
  // `core`: it parks text within the same run, no cross-run persistence.
  {
    verb: 'stash', component: 'isolate', package: 'litectx', symbol: 'LiteCtx', method: 'stash', class: 'store', skill: 'core', desc: 'Park a large piece of text outside the prompt under an id, to fetch back later.',
  },
  {
    verb: 'remember', component: 'isolate', package: 'litectx', symbol: 'LiteCtx', method: 'remember', class: 'store', skill: 'memory', desc: 'Save a note that persists across runs, under an id.',
  },
  {
    verb: 'forget', component: 'isolate', package: 'litectx', symbol: 'LiteCtx', method: 'forget', class: 'store', skill: 'memory', desc: 'Delete a saved note by id.',
  },
  // io — fwdloop's addition (see header): crosses outside the process.
  // Checkpoint pauses out to a human. Gated `write`-class for the same
  // reason a tree write is: a read-only scout must never be able to reach
  // it. A real email-sending package was catalogued here through M0a as
  // fwdloop's egress primitive; M0b removed those two entries — the package
  // turned an email REPLY into cryptographic proof of a sign-off, not a
  // send-this-email function, so it was a wrong fit, and no fwdloop job used
  // it (job #1's send writes a file behind the allow-list + accept). Real
  // mail egress may return at M9 in a different role (a human's accept
  // proven by email reply), scoped then — see docs/logs/FINDINGS.md for the
  // package this fenced off.
  {
    verb: 'checkpoint', component: 'io', package: 'bare-agent', symbol: 'Checkpoint', class: 'write', skill: 'core', desc: "Pause the run and wait for a human's answer.",
  },
  // fwdloop's own citation contract — NOT a baresuite primitive.
  // F13 RULED 2026-09-09 ("it is ours"): reading bytes is bareloop's
  // shell_read; turning those bytes into addressable {row, col, cell} cells
  // is fwdloop's own domain contract, kept out of the baresuite components
  // above on purpose.
  {
    verb: 'addressCells', component: 'fwdloop', package: 'poc/m0/csv.mjs', symbol: 'parseCsv', class: 'read', skill: 'core', desc: 'Read a spreadsheet as cells, each with an address that can be cited.',
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

// ---- job #1's needs, from F13's table (minus real egress, M0b) ----------
// F13's original table has 8 rows covering 9 needs (one row, "match a
// customer, derive figures", bundles two needs into fwdloop's own
// model-round + close machinery — never a catalogue primitive, `own: true`
// below; the 9th is the addressCells entry above). JOB1_NEEDS here drops
// F13's "real mail egress (M9)" row (7 rows remain): no fwdloop job uses it
// — job #1's send writes a file behind the allow-list + accept — and the
// catalogued egress package was a wrong fit for it anyway (see the removed
// catalogue entries above). resolveJob1Need throws if a listed verb isn't in
// the catalogue, same as primitiveFor.
export const JOB1_NEEDS = Object.freeze([
  { need: 'read the message text', verbs: ['read'] },
  { need: 'read the AR sheet as addressable cells', verbs: ['addressCells'] },
  { need: 'match a customer, derive figures', own: true },
  { need: 'pause for a human', verbs: ['checkpoint'] },
  { need: 'write the reply out (dry-run egress)', verbs: ['write'] },
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

// ---- resolution: prove every entry's package+symbol actually loads --------
// M0b, step 1 (F23): a catalogue entry is data the drafter trusts blind — an
// entry naming a symbol that doesn't exist is a brick nobody ever calls, and
// nothing before this caught it (F23). `resolveEntry` proves one entry by
// dynamically importing its `package` and checking the shape its `symbol`
// (plus `method`/`tool` where present) claims:
//   - a named export:      symbol -> typeof export === 'function'
//   - a class method:      symbol names an exported class, `method` an
//                           instance method on its prototype
//   - a factory-made tool: symbol names an exported factory; calling it
//                           (no args — must be side-effect-free) must yield
//                           a `{ tools }` array containing one named `tool`
//   - fwdloop's own module: `package` ending in `.mjs` resolves relative to
//     this file, same as any other named export
// Throws with a specific reason on failure; never returns false silently —
// same discipline as primitiveFor.
async function loadEntryModule(pkg) {
  if (pkg.endsWith('.mjs')) {
    const fileName = pkg.split('/').pop();
    return import(new URL(`./${fileName}`, import.meta.url));
  }
  return import(pkg);
}

export async function resolveEntry(entry) {
  const mod = await loadEntryModule(entry.package);

  if (entry.method) {
    const Cls = mod[entry.symbol];
    if (typeof Cls !== 'function') {
      throw new Error(`${entry.package}#${entry.symbol} is not an exported class (verb "${entry.verb}")`);
    }
    if (typeof Cls.prototype?.[entry.method] !== 'function') {
      throw new Error(`${entry.package}#${entry.symbol} has no method "${entry.method}" (verb "${entry.verb}")`);
    }
    return true;
  }

  if (entry.tool) {
    const factory = mod[entry.symbol];
    if (typeof factory !== 'function') {
      throw new Error(`${entry.package}#${entry.symbol} is not an exported factory (verb "${entry.verb}")`);
    }
    const { tools } = factory();
    if (!Array.isArray(tools) || !tools.some((t) => t.name === entry.tool)) {
      throw new Error(`${entry.package}#${entry.symbol}() does not produce a tool named "${entry.tool}" (verb "${entry.verb}")`);
    }
    return true;
  }

  if (typeof mod[entry.symbol] !== 'function') {
    throw new Error(`${entry.package} has no exported function "${entry.symbol}" (verb "${entry.verb}")`);
  }
  return true;
}
