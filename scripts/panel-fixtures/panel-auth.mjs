// Test helper. The panel has no token and no cookie (M4e amendment 4 item 8). `remember` only records that a test
// started a panel on that port (so a helper can assert it did); `cookieHeader` is empty. Never imported by src/.
export const TOKENS = new Map();
/** @param {{ port: number }} h */
export function remember(h) { TOKENS.set(h.port, true); return h; }
/** @param {number} _port */
export function cookieHeader(_port) { return {}; }
