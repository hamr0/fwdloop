// borrowed-from: bareloop src/stagewords.js@v0.61.0 (fc56e1f3)
// The ONE owner of a stage's plain question ("did it change any file?", "no failing tests?"). Moved out of
// src/panel/server.js (verbatim) so the Audit/step map AND the learnings cards read the same sentence from the same
// code — a second spelling is how two screens come to disagree about one check. Pure; no file IO, no model.

/** the genre-owned noun for the count a TYPES-genre typecheck stage measures (see {@link stageQuestionText}) */
export const GENRE_WHAT = Object.freeze({ TYPES: 'type errors' });

/** `cmd`+`args`, as a comparable key — the one signal (besides `kind`
 * itself) that two stages measure the SAME command's output, used to tell a
 * genuine typecheck stage apart from the TYPES genre's other `lower-is-
 * better`/`baseline: 0` stage (the failing-test-count half of `suite-green`'s
 * "two assertions"), which shares that stage's own shape but not its
 * population. `null` for a stage whose `cmd` isn't a non-empty string —
 * never matches anything, so it never falsely suppresses a real typecheck
 * question.
 * @param {any} params @returns {string|null} */
export function cmdKey(params) {
  if (!params || typeof params.cmd !== 'string' || params.cmd.length === 0) return null;
  const args = Array.isArray(params.args) ? params.args : [];
  return JSON.stringify([params.cmd, args]);
}

/**
 * THE PLAIN-QUESTION OWNER (plain-checks build, 2026-09-28, hamr's ruling:
 * the "checks N/M" headline is WITHDRAWN — "confusing, reads like 6 failed
 * when 5 never ran"). ONE pure function mapping a declared stage's own
 * signed `kind`+`params` (plus the close's own `genre`, also a signed field)
 * to a short plain-English question a person can read without knowing the
 * catalogue — never a second spelling on the client, and never anything the
 * model authored (the catalogue's kinds/params are the whole vocabulary this
 * reads).
 *
 * Every branch is traced straight off `src/kinds.js`'s runner semantics and
 * the TYPES genre template (`src/authoring.js` `TYPES_GENRE_TEMPLATE`,
 * `classGuards`'s `MECHANICAL_GUARDS`) — never guessed:
 *   - `files-changed` is always the `changed-from-seed` guard: "did it
 *     change any file?"
 *   - `pattern-absent-in-diff` is always the `no-suppressions` guard: "no
 *     casts or silencers added?"
 *   - `rubric-step` (Part 1a) is one job line's output file: "line N — does its output pass the line's checks?"
 *   - `command-exit` quotes its OWN signed command verbatim:
 *     `does "<cmd> <args joined by space>" exit clean?` (e.g. `does "npm test"
 *     exit clean?`, `does "npx tsc --noEmit --strict" exit clean?`). It used
 *     to read "does the test suite pass?" for every command, so F256's run
 *     mvtatlxw showed two different commands (the real suite and a whole-repo
 *     `tsc --strict`) reading the same question. A missing or non-string
 *     `cmd` returns `null` (the caller falls back to the stage name).
 *   - `count-not-worse` splits three ways on its own declared
 *     `direction`/`baseline` (never the runtime number — see
 *     {@link stageKindMetaFromSpec}'s own doc for why the baseline KIND must
 *     travel separately from the measured figure):
 *       - `higher-is-better` + `baseline: 'seed'` is the genre's `tests-kept`
 *         floor: "did all the old tests still exist?"
 *       - `lower-is-better` + `baseline: 0` is the genre's in-scope
 *         `typecheck` stage — UNLESS its own `cmd`+`args` is the SAME
 *         command a `command-exit` stage in the same close already runs
 *         (`suiteCmdKeys`, below): the TYPES template's `suite-green` is "the
 *         suite exits clean AND reports zero failing tests — TWO assertions"
 *         over ONE population (the same `npm test`/`pytest` invocation), so a
 *         `count-not-worse` stage sharing that exact command is the failing-
 *         test-count half of that pair, never a typecheck stage: "no failing
 *         tests?" — derived from the same cmd+args correlation (the stage
 *         counts the suite's own failing tests), never from the stage's own
 *         name string. The live check that found this (run mul5fofw's own
 *         `suite-zero-failing-tests`, cmd `npm test`, same as its sibling
 *         `suite-green` command-exit stage) would otherwise have read "test/
 *         has 0 type errors?", which is false: its parser counts FAILING
 *         TESTS (`^# fail (\d+)$`), not type-checker output. hamr's ruling:
 *         name this half honestly rather than reusing "type errors" for a
 *         population it was never about, or falling back to the stage's raw
 *         name. When the command differs from every sibling `command-exit`
 *         stage, the declared `scope.includePrefixes` naming exactly ONE path
 *         is quoted verbatim (a signed param, never invented): "<path> has 0
 *         type errors?" — otherwise the generic "type errors is 0?", never a
 *         guessed filename.
 *       - `lower-is-better` + `baseline: 'seed'` with a non-empty
 *         `scope.excludePrefixes` is the genre's `typecheck-outside` ceiling:
 *         "other files didn't get more type errors?"
 * The "type errors" wording is genre-owned (`GENRE_WHAT`), because TYPES is
 * the only genre this catalogue admits today (doc-genre kinds are not yet
 * built) — an unrecognised genre, or a `count-not-worse` shape none of the
 * three above matches, returns `null` rather than invent a fourth shape.
 *
 * `null` means "no honest plain question" — the caller (buildAttemptsList,
 * partLine1Text's `attemptChecksLine`) falls back to the stage's OWN name,
 * exactly as it already does for a stage with no resolvable kind at all.
 * @param {{kind: string|null, params: any, genre: string|null, suiteCmdKeys: Set<string>}} o
 * @returns {string|null}
 */
export function stageQuestionText({
  kind, params, genre, suiteCmdKeys,
}) {
  if (kind === 'files-changed') return 'did it change any file?';
  if (kind === 'pattern-absent-in-diff') return 'no casts or silencers added?';
  if (kind === 'command-exit') {
    if (!params || typeof params.cmd !== 'string' || params.cmd.length === 0) return null;
    const args = Array.isArray(params.args) ? params.args.filter((a) => typeof a === 'string') : [];
    return `does "${[params.cmd, ...args].join(' ')}" exit clean?`;
  }
  // Part 1a: one rubric-step stage = one job line's output file
  if (kind === 'rubric-step') return params && Number.isInteger(params.step) ? `line ${params.step} — does its output pass the line's checks?` : null;
  if (kind !== 'count-not-worse' || !params || typeof params !== 'object') return null;
  const what = Object.hasOwn(GENRE_WHAT, String(genre)) ? GENRE_WHAT[String(genre)] : null;
  if (params.direction === 'higher-is-better' && params.baseline === 'seed') {
    return 'did all the old tests still exist?';
  }
  if (!what) return null;
  const scope = params.scope && typeof params.scope === 'object' ? params.scope : null;
  if (params.direction === 'lower-is-better' && params.baseline === 0) {
    const key = cmdKey(params);
    if (key !== null && suiteCmdKeys instanceof Set && suiteCmdKeys.has(key)) return 'no failing tests?';
    const include = scope && Array.isArray(scope.includePrefixes) ? scope.includePrefixes : null;
    if (include && include.length === 1 && typeof include[0] === 'string' && include[0].length > 0) {
      return `${include[0]} has 0 ${what}?`;
    }
    return `${what} is 0?`;
  }
  if (params.direction === 'lower-is-better' && params.baseline === 'seed') {
    const exclude = scope && Array.isArray(scope.excludePrefixes) ? scope.excludePrefixes : null;
    if (exclude && exclude.length > 0) return `other files didn't get more ${what}?`;
    return null;
  }
  return null;
}

/**
 * Stage name to its plain question, off a signed spec's `closeDecl.stages` — the one pass that gathers every
 * `command-exit` stage's cmd+args FIRST (so the failing-test-count half of `suite-green`'s pair can be told from a
 * genuine typecheck stage) and then asks {@link stageQuestionText} per stage. `null` for a stage with no honest
 * question; an empty map for a spec with no declared stages.
 * @param {any} spec
 * @returns {Map<string, string|null>}
 */
export function stageQuestionsByName(spec) {
  /** @type {Map<string, string|null>} */
  const out = new Map();
  if (!spec || typeof spec !== 'object' || !spec.closeDecl || !Array.isArray(spec.closeDecl.stages)) return out;
  const genre = typeof spec.closeDecl.genre === 'string' ? spec.closeDecl.genre : null;
  /** @type {Set<string>} */
  const suiteCmdKeys = new Set();
  for (const s of spec.closeDecl.stages) {
    if (s && s.kind === 'command-exit') {
      const key = cmdKey(s.params);
      if (key !== null) suiteCmdKeys.add(key);
    }
  }
  for (const s of spec.closeDecl.stages) {
    if (!s || typeof s.name !== 'string' || s.name.length === 0) continue;
    const kind = typeof s.kind === 'string' ? s.kind : null;
    const params = s.params && typeof s.params === 'object' ? s.params : null;
    out.set(s.name, stageQuestionText({ kind, params, genre, suiteCmdKeys }));
  }
  return out;
}

/**
 * One signed fence entry in the words a person reads: `src/**` reads `src/`; a glob this cannot read as a folder or file stays as signed. The one owner both the fence question and the `~` kept-by-fence row read.
 * @param {string} e @returns {string}
 */
export function fencePlace(e) {
  const folder = /^(.+?)\/\*\*?$/.exec(e);
  const base = folder ? `${folder[1]}/` : e;
  return /[*?[\]{}]/.test(base) ? e : base;
}

/**
 * The plain question of the `$ [default]` write-fence row, built from the signed fence itself: `src/**` reads `src/`; an entry that is a glob this cannot read as a folder or file is quoted as it was signed.
 * @param {string[]} scope @returns {string}
 */
export function fenceQuestionText(scope) {
  const places = scope.map(fencePlace);
  return `only files in ${places.join(', ')} changed?`;
}

/**
 * The plain question of a job-level `$ [default]` guard row (the one list's guard rows, by guard NAME) — the one owner the plan card, Job tab, Audit, Result and the CLI print read, in place of the guard's raw name and its
 * long frozen sentence (GUARD_DESCRIPTIONS stays the older confirm-turn "protections" line). `null` for a guard with no line here: the caller keeps the old words, never an invented question.
 * @param {string} name @returns {string|null}
 */
export function guardQuestionText(name) {
  if (name === 'changed-from-seed') return 'did the run change a file?';
  if (name === 'no-suppressions') return 'no checker silenced (@ts-ignore, eslint-disable, # type: ignore)?';
  return null;
}
