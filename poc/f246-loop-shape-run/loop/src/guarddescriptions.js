// borrowed-from: bareloop src/guarddescriptions.js@v0.61.0 (fc56e1f3)
// The plain-English line of each mandatory guard, ONE owner (a leaf module: the confirm turn, the signed card and the one check list's `$` guard rows all read it).

/**
 * PLAIN-ENGLISH lines for the guards `classGuards` can compose, keyed by guard NAME — frozen beside CONFIRM_MENU (`src/authorflow.js`) because both are constants the confirm turn shows a person
 * verbatim. One entry per guard that exists in `MECHANICAL_GUARDS` (`src/authoring.js`); `confirmProtections` throws if a guard `classGuards` hands back has no line here, so a battery that grows a
 * guard fails loudly instead of showing a blank description.
 * @type {Record<string, string>}
 */
export const GUARD_DESCRIPTIONS = Object.freeze({
  'changed-from-seed': 'the run must actually change at least one file in scope — a close that reports done '
    + 'without touching anything is refused',
  'no-suppressions': 'the run may not silence a checker instead of fixing what it flags (things like @ts-ignore, '
    + 'eslint-disable, or # type: ignore) — none of those may appear in the diff',
});
