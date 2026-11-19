// borrowed-from: bareloop src/validate.js@v0.60.0 (globToPrefix only; the rest of that file is bareloop's job validator and is not wanted here)
// The one canonical spelling of a scope's path prefix. The check block's repo rows (src/checkblock.js `inScope`) read it; fwd has no repo job and never sets the block's `repo` option, so nothing in fwd calls it.

/**
 * @param {string} scope
 * @returns {string}
 */
export function globToPrefix(scope) {
  // One canonical spelling for equivalent paths — leading "./", interior "/./",
  // doubled "//", trailing "/" all collapse — so the legality rule, the fence
  // comparison, and bareguard enforcement agree on what a scope NAMES. Without
  // this, a validateJob-green fence like "src/" would reject every workflow
  // scope inside it (the F9 red-class across two documents).
  //
  // Order is load-bearing: "//" collapses and interior "/./" drops BEFORE the
  // leading "./" strip, so ".//src" → "src" and never "/src". Stripping first
  // would MINT an absolute prefix from a relative scope — a design-law-#1
  // containment escape (resolve(workdir, "/src") ignores workdir entirely).
  //
  // Deliberately NOT path.posix.normalize: it resolves ".." segments
  // (normalize("src/../etc") === "etc"), which must stay VISIBLE so
  // scopeContained can reject them — the whole point of the containment law.
  let p = scope.replace(/\/\*\*?$/, '');
  p = p.replace(/\/{2,}/g, '/').replace(/\/\.(?=\/|$)/g, '').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  return p;
}
