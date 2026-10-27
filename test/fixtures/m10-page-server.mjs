// M10 item 1 test fixture: a LOCAL http server plus a fake barebrowse `connect` that reads from it. No internet, $0.
// The fake page follows the part of barebrowse's page handle that src/pagefetch.js uses (goto, waitForNetworkIdle, snapshot, close).
import http from 'node:http';

/** a results-page-like snapshot text, long enough to pass the floors */
export const pageText = (tag = 'A') => `url: http://local/p\n- main\n${Array.from({ length: 8 }, (_, i) => `  - StaticText "Flight ${tag}${i} Boston to Chicago $${300 + i}"`).join('\n')}\n`;

/** @param {Record<string, {status?: number, body: string}>} routes @returns {Promise<{base: string, routes: object, close: () => Promise<void>}>} */
export async function startPageServer(routes) {
  const server = http.createServer((req, res) => {
    const r = routes[req.url ?? '/'];
    if (!r) { res.statusCode = 404; res.end(''); return; }
    res.statusCode = r.status ?? 200;
    res.end(r.body);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { base: `http://127.0.0.1:${port}`, routes, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok(undefined)); }) };
}

/**
 * @param {{idle?: 'ok'|'reject'|'hang'}} [o]
 * @returns {{connect: (opts: Record<string, any>) => Promise<any>, calls: {connect: Array<Record<string, any>>, goto: string[], snapshot: number, closed: number}}}
 */
export function fakeConnect({ idle = 'ok' } = {}) {
  const calls = { connect: [], goto: [], snapshot: 0, closed: 0 };
  return {
    calls,
    async connect(opts) {
      calls.connect.push(opts);
      let body = '';
      return {
        async goto(url) { calls.goto.push(url); const res = await fetch(url); body = await res.text(); return { url, status: res.status }; },
        waitForNetworkIdle(o = {}) {
          if (idle === 'ok') return Promise.resolve();
          if (idle === 'hang') return new Promise(() => {});
          return new Promise((_, rej) => setTimeout(() => rej(new Error(`waitForNetworkIdle timed out after ${o.timeout}ms`)), o.timeout ?? 10));
        },
        async snapshot() { calls.snapshot += 1; return body; },
        async close() { calls.closed += 1; },
      };
    },
  };
}
