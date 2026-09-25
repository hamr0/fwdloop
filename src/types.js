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
 * @property {number} line - the numbered line this ask binds to (the line
 *   carries the `ask:`/`ask <int><s|m|h>:` mark itself, M1 amendment 3).
 * @property {number} ttlMs - the ask's time-to-live in milliseconds.
 * @property {string} question - the words after the mark, trimmed — the
 *   human's own question. Nothing reads this yet outside signed-text.js.
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
 * @property {AskSlot[]} asks - zero or more marked lines (`ask:` /
 *   `ask <int><s|m|h>:` at the start of a numbered job line, M1 amendment 3).
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
 * @property {2} version
 * @property {'sha256'} algorithm
 * @property {SignatureFiles} files
 * @property {string} flow - sha256 hex of
 *   `JSON.stringify([files['prose.txt'], files['declaration.json'], signedBy, signedAt])`,
 *   in that fixed order — pins WHAT was signed (the two file hashes) and
 *   WHO/WHEN (signedBy/signedAt); editing any of the four after signing
 *   changes this hash.
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
 * One catalogue primitive entry. M1 piece 3 only needed `verb`/`skill`/
 * `class` (the catalogue was a caller-supplied parameter); piece 4 makes
 * `src/catalogue.json` the real data file, so this typedef grew the rest
 * of the fields the file actually carries. `method`/`tool` are mutually
 * exclusive and optional.
 * @typedef {object} CatalogueEntry
 * @property {string} verb
 * @property {string} component
 * @property {string} package
 * @property {string} symbol
 * @property {string} [method]
 * @property {string} [tool]
 * @property {string} class
 * @property {string} skill
 * @property {string} desc
 */

/**
 * One catalogue plumbing entry — the runner wires these around every step;
 * the drafter never selects them, so they never appear in `primitives`,
 * `menu()`, or `primitiveFor()`.
 * @typedef {object} PlumbingEntry
 * @property {string} name
 * @property {string} package
 * @property {string} symbol
 */

/**
 * @typedef {object} ParseCatalogueOk
 * @property {true} ok
 * @property {CatalogueEntry[]} primitives
 * @property {PlumbingEntry[]} plumbing
 */

/**
 * @typedef {object} ParseCatalogueRed
 * @property {false} ok
 * @property {string[]} reds
 */

/** @typedef {ParseCatalogueOk | ParseCatalogueRed} ParseCatalogueResult */

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

/**
 * @typedef {object} CheckFlowNameOk
 * @property {true} ok
 */

/**
 * @typedef {object} CheckFlowNameRed
 * @property {false} ok
 * @property {string} red
 */

/** @typedef {CheckFlowNameOk | CheckFlowNameRed} CheckFlowNameResult */

/**
 * @typedef {object} WriteFlowOk
 * @property {true} ok
 * @property {string} dir
 * @property {Signature} signature
 */

/**
 * @typedef {object} WriteFlowRed
 * @property {false} ok
 * @property {string[]} reds
 */

/** @typedef {WriteFlowOk | WriteFlowRed} WriteFlowResult */

/**
 * @typedef {object} ReadFlowOk
 * @property {true} ok
 * @property {string} dir
 * @property {SignedLine[]} lines
 * @property {Arbiter} arbiter
 * @property {Record<string, any>} declaration
 * @property {Signature} signature
 * @property {Record<string, string>} classes
 */

/**
 * @typedef {object} ReadFlowRed
 * @property {false} ok
 * @property {string[]} reds
 */

/** @typedef {ReadFlowOk | ReadFlowRed} ReadFlowResult */

/**
 * M2 piece 1 — a step's fresh executor context: "goal in, gap back". No
 * other field may ever appear here (src/runner.js's construction test
 * proves it) — in particular never the step's close, its shape, the cap, or
 * the strike count.
 * @typedef {object} ExecutorContext
 * @property {string} goal
 * @property {string[]} primitives
 * @property {Record<string, any>} reads
 * @property {string|null} gap
 */

/**
 * A green-class field value: `value` is the number/ISO-date/text claimed;
 * `cite` resolves it (src/closers.js's own grammar).
 * @typedef {object} GreenField
 * @property {string|number} value
 * @property {string} cite
 */

/** @typedef {{ fields: Record<string, GreenField> }} GreenArtifact */
/** @typedef {{ text: string, lines?: string[] }} SoftgreenArtifact */

/**
 * The result of any of src/closers.js's close functions.
 * @typedef {object} CloseVerdict
 * @property {'green'|'red'|'hitl'|'unparseable'|'crash'} verdict
 * @property {string|null} [red]
 * @property {string[]} [reds]
 */

/**
 * One row appended to `runs/<run-id>/audit.jsonl` (M2 scope item 9).
 * @typedef {object} AuditRow
 * @property {string|null} step
 * @property {number} attempt
 * @property {string|null} class
 * @property {string} verdict
 * @property {string|null} gap
 * @property {number|null} usd
 * @property {boolean} spendComplete
 * @property {number} wallMs
 * @property {string|null} model
 * @property {boolean|null} modelMatch
 * @property {boolean} strike
 */

/**
 * One row appended to `flows/<name>/history.jsonl` (M2 scope item 9).
 * @typedef {object} HistoryRow
 * @property {string} runId
 * @property {string} at
 * @property {string} outcome
 * @property {number|null} spentUsd
 * @property {boolean} spendComplete
 * @property {number|null} capUsd
 * @property {number} wallMs
 * @property {string|null} signatureHash
 */

/**
 * @typedef {object} RunFlowResult
 * @property {string} outcome
 * @property {string} [red]
 * @property {string[]} [reds]
 * @property {string} [runDir]
 * @property {Record<string, any>} [artifacts]
 * @property {number} [spentUsd]
 * @property {AuditRow[]} [auditRows]
 */

export {};
