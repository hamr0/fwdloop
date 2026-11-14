// borrowed-from: bareloop src/text.js@v0.56.0 (3383cce)
// Shared model-output helpers. extractArtifact is the ONE parser for every
// model-output extraction (interpret's artifact, extract's rules, the
// runner's drafted config) — two parsers that disagree about the same output
// are two instruments (F2/F21, the adaptlearn instrument caveat). It replaced
// N0's stripFences when the fence-robust upgrade landed at N2. priceOf is the
// ONE spelling of the honest-null cost read for the same reason (F6).
// `scrubRaw` is the third: the ONE way a model's raw output becomes a persisted
// record, for the same reason again — a second writer that forgets the scrub is
// a leak on the very trail the scrub exists to protect.

import { createRequire } from 'node:module';
import { redactSecrets } from './validate.js';

const require = createRequire(import.meta.url);
const { HaltError } = require('bare-agent');

// A fence counts as the artifact's WRAPPER only when it opens within this many
// lines of the response — the chatty-preamble shape ("Here's the fix:\n```…").
// A fence buried deeper inside an unfenced reply is the artifact's OWN content
// (a doc generator's example block): extracting it truncated a whole module to
// its 2-line fragment with red:null (review 2026-07-13, confirmed by execution).
// The trade-off is documented and pinned: past the window, prose + fence is
// treated as the artifact verbatim — with the no-fences persona, long-preamble
// replies are the rare shape; truncated artifacts corrupted the close signal.
const FENCE_PREAMBLE_LINES = 5;

/**
 * Fence-robust artifact extraction (F2 port requirements #1/#2):
 * - a fenced block opening within the first {@link FENCE_PREAMBLE_LINES} lines
 *   is the artifact — prose-wrapped and preamble fences extract clean (the F21
 *   instrument caveat: prose written to the target corrupted the close signal);
 * - a fence opening deeper is the artifact's own content — the trimmed whole
 *   text is the artifact (fence-heavy artifacts belong in tool mode, where the
 *   worker writes files directly and nothing is parsed);
 * - no fence → the trimmed whole text, with N0's unclosed-leading-fence strip
 *   as the fallback (reference parity);
 * - nothing extractable → `code: null` plus a named reason: artifact-red
 *   material for the caller's OWN axis, never a silent empty write.
 * Never throws.
 * @param {string|null|undefined} t
 * @returns {{ code: string|null, red: string|null }}
 */
export function extractArtifact(t) {
  const text = String(t ?? '');
  // (?=([^\n`]*))\1 reads the info string atomically: giving characters back can never find a closing fence the full read missed (a fence starts with a
  // backtick, which the info string excludes), so an unclosed "```aaaa..." fails once instead of once per giveback (quadratic). The body is group 2.
  const m = text.match(/```(?=([^\n`]*))\1\n?([\s\S]*?)```/);
  if (m) {
    if (text.slice(0, /** @type {number} */ (m.index)).split('\n').length - 1 < FENCE_PREAMBLE_LINES) {
      const code = m[2].trim();
      return code ? { code, red: null } : { code: null, red: 'empty fenced block' };
    }
    // deep fence = the artifact's own content: verbatim, NO fence strips — the
    // N0 fallback below would eat a trailing example fence off a real artifact
    return { code: text.trim(), red: null };
  }
  const bare = text.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  return bare ? { code: bare, red: null } : { code: null, red: 'empty response' };
}

/**
 * The ONE spelling of the F6 honest-null cost read on a bare-agent result.
 * `metrics.costUsd` is the honest null when NOTHING priced — never fall
 * through to `cost` when metrics exist: `cost` sums priced rounds only, so an
 * all-unpriced run reports cost 0 and `?? cost` would launder the explicit
 * unknown into a silent $0 (the F6 class — four shipped launderings were this
 * exact fallback chain hand-spelled). `unpricedRounds` makes a PARTIALLY
 * unpriced run visible (costUsd finite but an under-count).
 * @param {any} r a Loop.run() result (or null)
 * @returns {{ costUsd: number|null, unpricedRounds: number }}
 */
export function priceOf(r) {
  return {
    costUsd: r?.metrics ? r.metrics.costUsd : (r?.cost ?? null),
    unpricedRounds: r?.metrics?.unpricedRounds ?? 0,
  };
}

/**
 * The F6 tally over a list of PRICED CALLS — `priceOf`'s per-call read, summed.
 *
 * `knownUsd` carries the priced half explicitly and `costUsd` is the honest
 * total: null the moment anything went unpriced, never the priced half wearing a
 * complete coat. An EMPTY list is a complete $0 and not an unknown — nothing
 * spent is a number somebody can act on.
 * @param {{costUsd: number|null, unpricedRounds?: number}[]|null|undefined} entries
 * @returns {{costUsd: number|null, knownUsd: number, spendComplete: boolean,
 *   nullCostCalls: number, unpricedRounds: number}}
 */
export function tallyCalls(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const known = list.reduce((a, e) => a + (typeof e.costUsd === 'number' ? e.costUsd : 0), 0);
  const nullCostCalls = list.filter((e) => e.costUsd === null).length;
  const unpricedRounds = list.reduce((a, e) => a + (e.unpricedRounds || 0), 0);
  const spendComplete = nullCostCalls === 0 && unpricedRounds === 0;
  return {
    costUsd: spendComplete ? Number(known.toFixed(6)) : null,
    knownUsd: Number(known.toFixed(6)),
    spendComplete,
    nullCostCalls,
    unpricedRounds,
  };
}

/**
 * THE ONE MONEY-CEILING PREDICATE, for the same reason `priceOf` above is one:
 * the authoring pipeline meters two populations of paid call in two different
 * accumulators (the survey's `calls[]`, the declaration loop's cost book), and
 * two hand-spelled answers to "am I over the ceiling?" is two instruments.
 *
 * It is asked BETWEEN metered calls and never inside one. A cap that binds
 * mid-call kills the row before it can be graded — F45 measured that as 3 of 7
 * launches lost and $5.82 unreadable.
 *
 * Three answers, and the order between the last two is load-bearing:
 *   - NO CEILING → null, always. An absent cap is UNBOUNDED, and unbounded is a
 *     visible operator choice, never a defaulted number nobody set (the
 *     `maxWallMs` precedent). There is nothing to enforce, so unpriced spend
 *     here is merely reported.
 *   - KNOWN SPEND AT OR OVER THE CEILING → `cap-halt`, even when the total is
 *     unknown. The breach is CERTAIN on the priced half alone — whatever the
 *     unpriced remainder turns out to be, it can only be larger — so naming this
 *     `pricing-red` would send the operator to fix a meter when the fact is that
 *     the money is gone. At-or-over rather than over: the next call is the one
 *     that breaches, and it is the one being decided.
 *   - SPEND THAT CANNOT BE KNOWN → `pricing-red`. `?? 0` launders unknown into
 *     $0 (F6) and a ceiling enforced against a laundered floor is not enforced
 *     at all. If the spend cannot be seen the cap cannot govern it, and that is
 *     its own stop rather than a silent pass.
 *
 * A MALFORMED ceiling is the one input it refuses rather than answers: `null` and
 * an absent field mean UNBOUNDED, and they are the ONLY way to get there. Anything
 * else that is not a finite number (`'2.50'`, `NaN`, `Infinity`) reading as
 * unbounded would be F6's laundering in its ceiling form — a caller who set a cap
 * getting a paid pipeline with nothing enforcing it, which is the exact collapse
 * the ceiling exists to prevent, wearing the caller's own typo (PRD v1.62). The
 * CLI's `parseCeiling` guards the FLAG; this guards the LIBRARY, and `authorClose`
 * / `runAuthorScout` / `authorCloseForJob` are documented adopter seams. It THROWS
 * rather than clamping, unlike the attempt caps beside it, because those axes have
 * a safe direction to clamp toward and this one does not: every candidate default
 * is either a number nobody set or the unbounded run the caller just declined.
 * @param {{ceilingUsd: number|null|undefined, knownUsd: number, spendComplete: boolean}} o
 * @returns {'cap-halt'|'pricing-red'|null}
 * @throws {Error} when the ceiling is neither absent nor a finite number
 */
export function capStop({ ceilingUsd, knownUsd, spendComplete }) {
  if (ceilingUsd === null || ceilingUsd === undefined) return null;
  if (typeof ceilingUsd !== 'number' || !Number.isFinite(ceilingUsd)) {
    throw new Error(`capStop: a money ceiling must be a finite number of dollars or null — got ${typeof ceilingUsd} `
      + `${String(ceilingUsd)}. A malformed ceiling is an ERROR, never a silent fall back to UNBOUNDED: omit it, or `
      + 'pass an explicit null, to run unbounded — that is a stated operator choice and never a typo arrived at');
  }
  if (knownUsd >= ceilingUsd) return 'cap-halt';
  if (!spendComplete) return 'pricing-red';
  return null;
}

/**
 * THE ONE SPELLING of "was this throw a call casualty, or something else" —
 * F179/F180's seam. `authorscout.js`'s `settled` narrows a rejected
 * `loop.run()` to this one class: swallowing every throw would launder a
 * budget `HaltError`, a programming bug, or any other named terminal into
 * "the call failed" — the exact class of dishonesty this repo refuses (an
 * unknown reported as a known).
 *
 * bare-agent 0.42.0's `OpenAIProvider.generate` used to throw a raw
 * `SyntaxError` from an unguarded `JSON.parse(tc.function.arguments)` after
 * a billed HTTP round (F179/BA-27) — this predicate used to admit that class
 * too. bare-agent 0.43.0 fixed it upstream (`parseToolCalls`, shared by
 * OpenAIProvider and Ollama): a malformed tool-call arguments string now
 * returns a priced round with `toolCalls: []` plus its own `malformedToolCall`
 * marker instead of throwing. Verified against 0.43.0's installed source that
 * no provider bareloop constructs (`AnthropicProvider`, `OpenAIProvider`,
 * `GeminiProvider` — `src/providers.js`) can still throw a JSON `SyntaxError`
 * out of `generate()` after a billed round: Anthropic and Gemini read tool-call
 * arguments as already-parsed objects off their own response shape (nothing to
 * `JSON.parse`), and every provider's raw-HTTP-body parse is already
 * try/catch-wrapped inside `_request`, converted to a plain `Error` before it
 * can reach here. bareloop never streams a provider response. So the
 * SyntaxError branch this predicate used to carry is dead code and was
 * removed in the same change that bumped to bare-agent 0.43.0 — re-add it (or
 * a narrower successor) only if a real provider is found to reintroduce the
 * class.
 *
 * A `HaltError` is deliberately excluded — it is bare-agent's own governance
 * exit (a budget/turn cap), never a transport casualty, and this predicate
 * must never launder one into a mere "the call failed".
 * @param {any} err
 * @returns {string|null} a short reason when `err` is an admitted casualty class,
 *   `null` for everything else (including `HaltError`) — the caller re-throws on `null`.
 */
export function callCasualty(err) {
  if (err instanceof HaltError) return null;
  const e = /** @type {any} */ (err);
  if (e?.code === 'ETIMEDOUT' || e?.name === 'TimeoutError') return String(e?.message ?? e);
  // F217 — a DROPPED CONNECTION is the same class as an idle timeout: a call that produced nothing usable. Two REAL
  // shapes reach this seam out of bare-agent 0.49.0's OpenAIProvider (read in node_modules/bare-agent/src/provider-
  // openai.js `_request` + provider-http.js), both thrown straight through `Loop.run` (loop.js rethrows non-Halt errors):
  //   1. `req.on('error', reject)` passes node's RAW socket error unwrapped: `Error{code:'ECONNRESET', message:'socket
  //      hang up'}` (the server closed before any response).
  //   2. `guardResponseSettles` (BA-25), the connection cut after the headers: `ProviderError{code:'PROVIDER_ERROR',
  //      retryable:true, context:{bound:'transport'}}`, message "response stream aborted/error/close before the body
  //      completed". An HTTP-status ProviderError never carries `bound:'transport'`, so it is not admitted here.
  // Other raw codes (ECONNREFUSED, ENOTFOUND, EPIPE...) reach the same raw path but name a wrong URL / no network, not a
  // connection that DROPPED; they are deliberately not admitted (they re-raise loudly, as before).
  if (e?.code === 'ECONNRESET' || e?.context?.bound === 'transport') {
    return `the connection to the provider dropped (${String(e?.message ?? e)})`;
  }
  return null;
}

// ── THE RAW MODEL OUTPUT, AS A PERSISTED RECORD ─────────────────────────────
//
// Run mslhn707 died on a survey that broke JSON at position 1339 and left NO
// copy of what the model actually said: the red named the position, the process
// exited, and the only artifact that could have decided whether the malformation
// is recurring (and therefore whether the scout must move to a structure-forced
// tool call) went with it. A raw that is not written down is a diagnosis nobody
// can make twice.
//
// Everything a persisted raw needs is HERE rather than at each writer, and the
// reason is the `scrubRed` reason one layer up: the scrub, the bound and the
// announcement are properties of PERSISTING A RAW, not of any one caller
// remembering them. A future writer that reaches for a raw reaches for this.

/**
 * The ceiling on ONE persisted raw. Sized to the survey's own prompt-ingredient
 * cap (`AUTHOR_SCOUT_BLOB_MAX`, 8000) rather than picked: the largest raw this
 * repository produces is a survey, the archive's real surveys ran 5991-8056
 * bytes, and a record that cannot hold one whole specimen cannot answer the
 * question it exists for. The two constants are deliberately independent
 * numbers — one bounds a PROMPT, this one bounds a RECORD.
 */
export const RAW_PERSIST_MAX = 8000;

/**
 * The announced-trim marker for a persisted raw. A NEW spelling rather than a
 * reuse of `GAP_TRIM_MARKER` ('gap trimmed:'), and that is a decision, not
 * decoration: `src/root.js` READS `GAP_TRIM_MARKER` to mean *this gap was cut,
 * so Layer R must not compare it*, so a second producer of those bytes in a
 * different population is exactly the F90 hazard — a reader must know every
 * producer of its marker. Nothing reads this one yet; it exists so the trim
 * announces itself (F28) and so a future reader has an unambiguous key.
 */
export const RAW_TRIM_MARKER = 'raw trimmed:';

/**
 * ONE raw model emission, ready to persist.
 *
 * Three things happen here and NONE of them is optional at a call site:
 *   - the text goes through the ONE redactor (`redactSecrets`, over the ONE
 *     `SECRET_PATTERNS` inventory). A raw is the single most likely record in
 *     this system to carry a live credential: it is whatever a model read out
 *     of a repository, verbatim, and it lands in a file that outlives the run;
 *   - it is BOUNDED, and the bound ANNOUNCES itself with the full size (F28 —
 *     a bound eats detail, never evidence). The cut is decoded rather than
 *     sliced so a multi-byte character is never split in half;
 *   - it carries its own address: which call produced it (`label`, the same
 *     spelling the cost book meters under) and which attempt (`attempt`), plus
 *     the typed failure that describes it when there is one.
 *
 * `cause`/`reason` are `null` when the emission was fine — an ABSENT failure is
 * absent, never an empty string that reads like a diagnosis nobody wrote.
 * @param {{label: string, attempt: number, text: unknown, cause?: string|null,
 *   reason?: string|null, cap?: number}} o
 * @returns {{label: string, attempt: number, bytes: number, trimmed: boolean,
 *   text: string, cause: string|null, reason: string|null}}
 */
export function scrubRaw({ label, attempt, text, cause = null, reason = null, cap = RAW_PERSIST_MAX }) {
  const scrubbed = redactSecrets(String(text ?? ''));
  const buf = Buffer.from(scrubbed, 'utf8');
  const trimmed = buf.length > cap;
  // walk the cut BACK off any continuation byte (0b10xxxxxx): a byte-wise slice
  // through a multi-byte character renders as a replacement char, and a record
  // that garbles the evidence is a worse instrument than one that keeps a byte
  // less of it
  let end = cap;
  while (trimmed && end > 0 && (buf[end] & 0xC0) === 0x80) end -= 1;
  const kept = trimmed ? buf.subarray(0, end).toString('utf8') : scrubbed;
  // the two diagnosis fields are rendered by `stampRaw` below, never here: the
  // writer that stamps them LATER must go through the same one place, or the
  // scrub becomes a property of when you knew the verdict
  return stampRaw({
    label,
    attempt,
    // the FULL size, always — the number a trim is measured against
    bytes: buf.length,
    trimmed,
    // WITHHELD is measured off `end`, not off `cap`: the multi-byte walk-back above
    // can cut up to three bytes short of the cap, and announcing `length - cap` would
    // under-report the withheld bytes by exactly that much. An announced bound that
    // states a number it did not withhold is the announcement failing at its one job.
    text: trimmed
      ? `${kept}\n[${RAW_TRIM_MARKER} ${buf.length - end} of ${buf.length} bytes withheld — the cap is ${cap} per raw]`
      : kept,
    cause: null,
    reason: null,
  }, { cause, reason });
}

/**
 * Stamp a persisted raw with the verdict that DESCRIBES it — through the same
 * boundary the raw's own text rode.
 *
 * It exists because the verdict is not known when the raw is created: a writer
 * records the emission the moment the call returns (so a metered call can never
 * be missing its output), and only classifies it afterwards. The obvious
 * shape — assigning `cause`/`reason` onto the stored object at that later
 * point — writes an UNSCRUBBED string into a record that is already past the
 * one redactor, and `reason` is the worst field to do it to: it quotes the
 * transport's own error prose, which nobody in this repo wrote and nobody
 * bounds. So the stamp is a function, not an assignment, and `scrubRaw` renders
 * its own two fields through it: ONE place decides how a diagnosis becomes
 * persistable, exactly as ONE place decides it for the text.
 *
 * `cause` is enumerated (`SURVEY_CAUSES`) and passes through untouched; a mask
 * over a closed set would only hide a bug in the set.
 * @template {{cause: string|null, reason: string|null}} T
 * @param {T} raw @param {{cause?: string|null, reason?: string|null}} o @returns {T}
 */
export function stampRaw(raw, { cause = null, reason = null }) {
  raw.cause = cause ?? null;
  raw.reason = reason === null || reason === undefined ? null : redactSecrets(reason);
  return raw;
}

/**
 * BA-21 — the WRITE side of the pricing-provenance signal (read side: `rateProvenance` /
 * `spendProvenance` in src/ledger.js). bare-agent >=0.37 rides `rateSource` beside
 * `pricing` on every metering payload; both metering callbacks below forward it onto the
 * spine through THIS one helper, because two sites spelling one rule are two instruments
 * (the ripgrep fix that landed in ci.yml but not publish.yml).
 *
 * Forwarded VERBATIM — the write side reports what upstream said, and src/ledger.js is
 * the one place that decides what counts as a guess. And an ABSENT provenance stays
 * absent: a payload carrying no `rateSource` (bare-agent <0.37, and every round already
 * in the archive) emits no field at all, so a reader sees UNKNOWN rather than a label we
 * invented. Never defaulted to `null` here — `null` is upstream saying "nothing was
 * priced", which is a different fact from "nobody told us".
 * @param {any} arg an `onLlmResult` / `onTurn` payload
 * @returns {{rateSource?: string|null}} the field to spread into the spine record
 */
export function rateSourceFields(arg) {
  return arg && typeof arg === 'object' && 'rateSource' in arg ? { rateSource: arg.rateSource } : {};
}
