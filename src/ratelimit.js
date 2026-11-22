// borrowed-from: bareloop src/ratelimit.js@v0.61.0 (fc56e1f3) -- copied unchanged (the 429 wait the shape look uses; fwd had no home for it)
// PRD item 28's parked (a/b) ruling, hamr's verbatim call: "do a/b as a
// fallback, and verify/validate + no regression." A vendor HTTP 429 is a
// response — the provider answered, unlike src/transport.js's no-response
// class — but unlike every other status this repo already declines to retry
// (4xx/5xx generally, F115's own boundary), a 429 carries the ONE piece of
// information that turns "retry blindly" into "retry honestly": the vendor's
// own stated wait. This module is transport.js's SIBLING, not an extension
// of it — `isTransportFailure` must keep returning FALSE for anything
// carrying an HTTP status (429 included), and nothing here widens that.
//
// This is a FALLBACK, not the primary answer. The primary answer (F139,
// measured 2026-09-08) is picking a worker model with adequate rate
// headroom: a 30,000 TPM model (429s deterministically on our workload,
// 2 of 2 runs), a 200,000 TPM model and a 500,000 TPM model do not.
// One bounded retry only softens the failure mode when that primary answer
// was not followed (or headroom was still exceeded); it does not replace it.

/** The fixed retry budget: ONE extra attempt after a 429. Never read from a
 * job spec or CLI flag — raising it is arbiter territory, mirroring
 * transport.js's TRANSPORT_RETRIES exactly (tighten-only doctrine). */
export const RATE_LIMIT_RETRIES = 1;

/** bare-agent's `Retry.call` (if ever used) counts ATTEMPTS, not retries;
 * this module's own hand-rolled ladder (src/planrun.js) does the same for
 * symmetry with TRANSPORT_MAX_ATTEMPTS. */
export const RATE_LIMIT_MAX_ATTEMPTS = RATE_LIMIT_RETRIES + 1;

/** The hard cap on how long we will ever wait for a vendor-stated 429 delay.
 * A vendor asking for longer than this is not honoured — we do not retry at
 * all in that case. Waiting that long is the operator's decision, not ours
 * (arbiter territory: nothing here escalates the wait past what hamr set). */
export const RATE_LIMIT_MAX_WAIT_MS = 60_000;

/** Used only when the vendor's message carries no parseable delay at all. */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 5_000;

/** A parsed delay is the EARLIEST moment the vendor's own window resets, not
 * a safe one to fire on the dot — this margin is added to any PARSED value
 * (never to the default) so the retry lands just after the window, not on
 * its leading edge. Never allowed to push a parsed value over the cap. */
const PARSED_DELAY_MARGIN_MS = 250;

/**
 * Is `err` an HTTP 429 (rate-limited) response? True ONLY for an explicit
 * status of 429 on the error itself. Nothing else qualifies — not message
 * text (a message merely containing "429" is not this), not `retryable`,
 * not any other status. Symmetric with `isTransportFailure`'s own status
 * check (src/transport.js), just reading the opposite branch of it.
 * @param {any} err
 * @returns {boolean}
 */
export function isRateLimited(err) {
  if (err == null) return false;
  const status = err.status ?? err.statusCode;
  return status === 429;
}

/**
 * The vendor's RAW stated wait, in milliseconds, parsed straight from the
 * error message — no default, no margin, no cap. `null` when nothing in the
 * message matches a known shape. Exported separately from `rateLimitWaitMs`
 * so a caller that wants to report the vendor's own number on the spine
 * (`statedMs`) never has to re-derive it from the margin-adjusted figure.
 *
 * bare-agent does not expose the vendor's `retry-after` /
 * `x-ratelimit-reset-*` response headers on the thrown error (BA-26) — the
 * delay exists only in the vendor's English message text, so this parses
 * that text. Verified real shape (a hosted provider, run `8ev2sdkn`, 2026-09-08):
 * "Please try again in 11.996s." This also supports "try again in 1.5
 * seconds", "try again in 20ms", "retry after 30s", and "retry after 30
 * seconds" — case-insensitive.
 * @param {any} err
 * @returns {number|null}
 */
export function statedWaitMs(err) {
  const message = String(err?.message ?? err ?? '');
  const match = message.match(/(?:try again in|retry after)\s*([\d.]+)\s*(ms|milliseconds?|s|seconds?)?/i);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return null;

  const unit = (match[2] ?? 's').toLowerCase();
  const isMs = unit === 'ms' || unit.startsWith('millisecond');
  return isMs ? value : value * 1000;
}

/**
 * How long to wait before retrying a 429, in milliseconds — or `null`
 * meaning "do not retry at all" (either the parsed wait exceeds
 * `RATE_LIMIT_MAX_WAIT_MS`, in which case waiting that long is the
 * operator's decision, not ours).
 *
 * A parsed value gets `PARSED_DELAY_MARGIN_MS` added (the vendor's stated
 * number is the earliest moment its window resets, not a safe one to fire
 * on), capped so the margin itself can never push a parsed value over
 * `RATE_LIMIT_MAX_WAIT_MS`. When nothing parses, `RATE_LIMIT_DEFAULT_WAIT_MS`
 * is returned as-is, with no margin added (there is nothing to add margin
 * to — it is already a conservative guess, not an earliest-moment reading).
 * @param {any} err
 * @returns {number|null}
 */
export function rateLimitWaitMs(err) {
  const parsedMs = statedWaitMs(err);
  if (parsedMs === null) {
    return RATE_LIMIT_DEFAULT_WAIT_MS <= RATE_LIMIT_MAX_WAIT_MS ? RATE_LIMIT_DEFAULT_WAIT_MS : null;
  }

  // The RAW parsed value is what is judged against the cap ("a vendor asking
  // for longer than this is not honoured") — the margin is added only AFTER
  // that gate, and clamped so it can never itself push the result past the
  // cap, but it never turns an already-honoured wait into a refusal.
  if (parsedMs > RATE_LIMIT_MAX_WAIT_MS) return null;
  if (parsedMs === 0) return 0;
  return Math.min(parsedMs + PARSED_DELAY_MARGIN_MS, RATE_LIMIT_MAX_WAIT_MS);
}
