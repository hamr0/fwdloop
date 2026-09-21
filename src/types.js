// Shared @typedefs for the public API. No runtime code — JSDoc only, so
// `tsc` (per LIBRARY_CONVENTIONS §2) generates `types/types.d.ts` from this
// file and every other module imports the shapes from here.

/**
 * @typedef {object} SignedLine
 * @property {number} n - the number the human wrote, used as the join key.
 * @property {string} text - the line's text, trimmed.
 * @property {string} guardrail - the guardrail directly under this line, or
 *   `''` when the human left it blank.
 */

/**
 * @typedef {object} AskSlot
 * @property {number} line - the numbered line this ask binds to.
 * @property {number} ttlMs - the ask's time-to-live in milliseconds.
 */

/**
 * @typedef {object} SendTarget
 * @property {'file'} kind - only `file:` targets are available before M9.
 * @property {string} path - everything after `file:` to end of line, trimmed.
 */

/**
 * @typedef {object} SendSlot
 * @property {number} line - the numbered line this send binds to.
 * @property {SendTarget} target
 */

/**
 * @typedef {object} SourceSlot
 * @property {string} role - `[a-z][a-z0-9_-]*`, unique across sources.
 * @property {'file'} kind - only `file:` sources are available before M9.
 * @property {string} path - everything after `file:` to end of line, trimmed.
 */

/**
 * @typedef {object} Arbiter
 * @property {number} capUsd - `cap $<decimal> per run`. Required, > 0.
 * @property {AskSlot[]} asks - zero or more `ask at line <int>` slots.
 * @property {number} redoCap - `redo cap <int>`, 1..3. Default 3.
 * @property {SendSlot[]} sends - zero or more `send at line <int> to ...`.
 * @property {string[]} skills - `skills <name>[, <name>...]`. Default ['core'].
 * @property {SourceSlot[]} sources - zero or more `source <role> = file:<path>`.
 * @property {number} roundBudgetMs - `round budget <int><s|m|h>`. Default 120000.
 */

/**
 * @typedef {object} SignedTextOk
 * @property {true} ok
 * @property {SignedLine[]} lines
 * @property {Arbiter} arbiter
 */

/**
 * @typedef {object} SignedTextRed
 * @property {false} ok
 * @property {string[]} reds
 */

/** @typedef {SignedTextOk | SignedTextRed} SignedTextResult */

/**
 * @typedef {object} CanonicalBytesOk
 * @property {true} ok
 * @property {Buffer} bytes
 */

/**
 * @typedef {object} CanonicalBytesRed
 * @property {false} ok
 * @property {string} red
 */

/** @typedef {CanonicalBytesOk | CanonicalBytesRed} CanonicalBytesResult */

/**
 * sha256 hex digests of each signed file's canonical bytes.
 * @typedef {{ 'prose.txt': string, 'declaration.json': string }} SignatureFiles
 */

/**
 * @typedef {object} Signature
 * @property {1} version
 * @property {'sha256'} algorithm
 * @property {SignatureFiles} files
 * @property {string} flow - sha256 hex of the two file hashes joined in fixed order.
 * @property {string} signedBy
 * @property {string} signedAt - ISO-8601.
 */

/**
 * @typedef {object} SignFlowOk
 * @property {true} ok
 * @property {Signature} signature
 */

/**
 * @typedef {object} SignFlowRed
 * @property {false} ok
 * @property {string[]} reds
 */

/** @typedef {SignFlowOk | SignFlowRed} SignFlowResult */

/**
 * @typedef {object} VerifyFlowOk
 * @property {true} ok
 */

/**
 * @typedef {object} VerifyFlowRed
 * @property {false} ok
 * @property {string[]} reds
 */

/** @typedef {VerifyFlowOk | VerifyFlowRed} VerifyFlowResult */

/**
 * One catalogue entry — passed in by the caller (M1 piece 3: the catalogue
 * is a parameter here; piece 4 makes it a data file).
 * @typedef {object} CatalogueEntry
 * @property {string} verb
 * @property {string} skill
 * @property {string} class
 */

/**
 * @typedef {object} ValidateDeclarationOk
 * @property {true} ok
 * @property {Record<string, string>} classes - keyed by each step's `emits`
 *   id, value the step's effective guardrail class.
 */

/**
 * @typedef {object} ValidateDeclarationRed
 * @property {false} ok
 * @property {string[]} reds
 */

/** @typedef {ValidateDeclarationOk | ValidateDeclarationRed} ValidateDeclarationResult */

export {};
