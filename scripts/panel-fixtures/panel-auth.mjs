// Test helper (M4c-fix item 2): the panel authenticates every request by its own cookie. A test that
// starts a panel on port 0 calls `remember(handle)`; `cookieHeader(port)` is then the header a real
// browser would send after opening the printed link. Never imported by src/.
export const TOKENS = new Map();
export const cookieName = (port) => `fwdloop_panel_${port}`;
/** @param {{ port: number, token: string }} h */
export function remember(h) { TOKENS.set(h.port, h.token); return h; }
/** @param {number} port @param {string} [token] */
export function cookieHeader(port, token = TOKENS.get(port)) {
  return token ? { cookie: `${cookieName(port)}=${token}` } : {};
}
