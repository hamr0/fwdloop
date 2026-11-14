// borrowed-from: bareloop src/modellist.js@v0.56.0 (3383cce)
// rewritten-from: fwdloop src/panel/settings.js@f9449e8 (`authHeaders`, `getWithKey`, `idsOf`, `listModels`)
// PANEL-BUILD.md P8 — the ONE `<baseUrl>/models` GET. Settings > Providers' Test and Refresh and the
// New job card's model-readiness check (`checkProviderReachable`, src/providers.js) all call it; no
// second copy of the probe exists. It is a GET of a models LIST, never a completion, so it spends
// no token and writes no spend row. The key goes in a header only and is never returned or logged.
// A redirect is NOT followed (`redirect:'manual'`), so the key is never sent on to another host.
// There is no default host: a blank Base URL makes no call.

/** The default deadline for the one GET. */
export const LIST_TIMEOUT_MS = 4000;

/**
 * The key goes only in a header, in the form each shape expects.
 * @param {string} shape an API shape id (src/providershapes.js)
 * @param {string} key
 * @returns {Record<string, string>}
 */
export function authHeaders(shape, key) {
  if (shape === 'anthropic-api') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (shape === 'gemini-api') return { 'x-goog-api-key': key };
  return { Authorization: `Bearer ${key}` };
}

/**
 * The model ids a provider's list answer holds, per API shape (`data[].id` for two shapes;
 * `models[].name` minus its `models/` prefix for the third). Sorted, de-duplicated.
 * @param {string} shape
 * @param {any} body
 * @returns {string[]}
 */
export function idsOf(shape, body) {
  const list = shape === 'gemini-api' ? body?.models : body?.data;
  const key = shape === 'gemini-api' ? 'name' : 'id';
  const ids = (Array.isArray(list) ? list : [])
    .map((/** @type {any} */ m) => (typeof m?.[key] === 'string' ? m[key].replace(/^models\//, '') : ''))
    .filter((id) => id !== '');
  return [...new Set(ids)].sort();
}

/**
 * @typedef {{ ok: true, models: string[], ms: number }
 *   | { ok: false, why: string, status: string, detail?: string }} ListResult
 */

/**
 * One free GET of `<baseUrl>/models` with the key in the header only and a deadline.
 * Failure is data, never a throw: `why` is a plain sentence, `status` a short machine word
 * (`no-base-url`, `redirect`, `HTTP <n>`, `timeout`, `unreachable`) for callers that need it.
 * @param {object} o
 * @param {string} o.shape an API shape id
 * @param {string} o.baseUrl the row's Base URL ('' = no call)
 * @param {string} o.key the key value (header only)
 * @param {typeof fetch} [o.fetchImpl] test seam; defaults to the global `fetch`
 * @param {number} [o.timeoutMs]
 * @returns {Promise<ListResult>}
 */
export async function listModels({ shape, baseUrl, key, fetchImpl = fetch, timeoutMs = LIST_TIMEOUT_MS }) {
  const base = typeof baseUrl === 'string' ? baseUrl.trim().replace(/(?<!\/)\/+$/, '') : '';
  if (base === '') return { ok: false, why: 'Type a Base URL.', status: 'no-base-url' };
  const url = `${base}/models`;
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: authHeaders(shape, key), signal: ctl.signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, why: 'The provider answered with a redirect; the key was not sent on. Check the Base URL.', status: 'redirect' };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, why: 'The provider refused the key.', status: `HTTP ${res.status}` };
    if (!res.ok) return { ok: false, why: 'The provider answered with an error.', status: `HTTP ${res.status}` };
    /** @type {any} */
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { ok: true, models: idsOf(shape, body), ms: Date.now() - started };
  } catch (/** @type {any} */ e) {
    if (e?.name === 'AbortError') return { ok: false, why: 'The provider did not answer in 4 seconds.', status: 'timeout' };
    const cls = e?.code || e?.name || 'network-error';
    // connection refused surfaces as fetch's bare TypeError ("fetch failed")
    const refused = e?.name === 'TypeError' || e?.code === 'ECONNREFUSED' || e?.cause?.code === 'ECONNREFUSED';
    return { ok: false, why: 'Could not reach the provider.', status: String(cls), detail: refused ? `nothing answering at ${url}` : `request failed: ${cls}` };
  } finally {
    clearTimeout(timer);
  }
}
