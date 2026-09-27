// borrowed-from: bareloop src/panel/server.js@a30bbef — ADAPTED for fwdloop.
// M4a piece 2 (docs/wiki/the-module-ladder.md, "M4a — read-only panel —
// SIGNED", scope item 1/2): the read-only panel server.
//
// What is kept from bareloop, verbatim in spirit: the `node:http` HTTP
// shell — GET/HEAD only (anything else -> 405), bound to `127.0.0.1` ONLY, a
// taken port fails LOUDLY (prints the port, exits non-zero, never silently
// tries another one).
//
// What is deleted, per ruling A (2026-09-26) and the M4a fit-check: every
// import of a bareloop-only module (`runlist`, `replayio`, `replay`,
// `behaviour`, `ledger`, `job`, `authorflow`) and everything only those fed —
// per-round `parts[]`, tool-call Audit rows, the judge seam,
// scoutPlan/fixLoop, memoryCache, the resolved-spec provenance chain. None of
// these have an fwdloop analog; fwdloop has exactly one flow shape (linear,
// human-authored, signed steps), one book granularity (one `audit.jsonl` row
// per step attempt), and exactly one signed `declaration.json` +
// `signature.json` per flow.
//
// All real data derivation now lives in `src/panel/data.js`, which reads
// fwdloop's own books through the readers `src/` already owns (`readFlow`,
// `readAudit`, `readHistory`, `readAsk`, `readRunState`, `readLog`,
// `readSpendRows`, `readAskEvidence`, `loadCatalogue`) — this file is only
// the HTTP shell + route dispatch, never a second copy of any derivation.
//
// READ-ONLY, BY CONSTRUCTION: GET/HEAD only; no endpoint runs a job, spends
// money, signs, or reads a key/.env. Nothing here imports `src/provider.js`'s
// key-reading path or touches `process.env` for a secret.
//
// PATH SAFETY: a URL may name a flow ONLY (checked with `checkFlowName`) and
// a runId ONLY (resolved with `resolveRunDir`, both `src/flow.js`) — a URL
// segment is never joined into a filesystem path directly. The one exception
// is the fixed, whitelisted `/` route, which always serves this same
// directory's own `index.html`, never a URL-derived filename.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../catalogue.js';
import {
  listRuns, getRunDetail, getRunAudit, getRunJob, listInbox,
} from './data.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Default bind port. Ruling, hamr 2026-09-27: fwdloop's panel default port
 *  is 4800 — bareloop owns 4700, and the two panels must be able to run
 *  side by side. */
export const DEFAULT_PORT = 4800;

/** @param {any} res @param {number} code @param {any} body */
function sendJson(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

/** @param {any} res @param {number} code @param {string} text */
function sendText(res, code, text) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

/**
 * Handle one request against the read-only API + the page. Exported
 * separately from {@link createPanelServer} so tests can drive it without a
 * real listening socket where that is simpler.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ root: string, port: number }} opts
 */
export function handleRequest(req, res, opts) {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendText(res, 405, 'method not allowed — this panel is read-only (GET/HEAD only)');
    return;
  }

  let url;
  try {
    url = new URL(/** @type {string} */ (req.url), 'http://127.0.0.1');
  } catch {
    sendText(res, 400, 'bad request');
    return;
  }
  const { pathname } = url;

  const send = (code, body) => {
    if (method === 'HEAD') {
      const text = JSON.stringify(body);
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
      res.end();
      return;
    }
    sendJson(res, code, body);
  };

  if (pathname === '/' || pathname === '/index.html') {
    const indexPath = join(HERE, 'index.html');
    let html;
    try {
      html = readFileSync(indexPath, 'utf8');
    } catch {
      sendText(res, 500, 'panel page missing on disk');
      return;
    }
    html = html.replace(/__FWDLOOP_PANEL_PORT__/g, String(opts.port));
    if (method === 'HEAD') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }

  const loaded = loadCatalogue();
  if (!loaded.ok) {
    sendText(res, 500, `catalogue failed to load: ${loaded.reds.join('; ')}`);
    return;
  }
  const catalogue = loaded.primitives;

  if (pathname === '/api/runs') {
    send(200, { rows: listRuns({ root: opts.root, catalogue }) });
    return;
  }

  if (pathname === '/api/inbox') {
    send(200, { rows: listInbox({ root: opts.root }) });
    return;
  }

  // /api/runs/:flow/:runId(/audit|/job)?
  const runMatch = /^\/api\/runs\/([^/]+)\/([^/]+)(\/(audit|job))?$/.exec(pathname);
  if (runMatch) {
    let flow;
    let runId;
    try {
      flow = decodeURIComponent(runMatch[1]);
      runId = decodeURIComponent(runMatch[2]);
    } catch {
      sendText(res, 400, 'bad request');
      return;
    }
    const sub = runMatch[4] ?? null;

    if (sub === 'audit') {
      const result = getRunAudit({ root: opts.root, flow, runId });
      if (!result) { sendText(res, 404, 'no such run'); return; }
      send(200, result);
      return;
    }
    if (sub === 'job') {
      const result = getRunJob({
        root: opts.root, flow, runId, catalogue,
      });
      if (!result) { sendText(res, 404, 'no such run'); return; }
      send(200, result);
      return;
    }
    const result = getRunDetail({
      root: opts.root, flow, runId, catalogue,
    });
    if (!result) { sendText(res, 404, 'no such run'); return; }
    send(200, result);
    return;
  }

  sendText(res, 404, 'not found');
}

/**
 * Start the panel server. Binds `127.0.0.1` ONLY. A taken port is a LOUD,
 * non-zero-exit failure — this never falls back to another port (see file
 * header). Resolves once actually listening; rejects on a bind error
 * (including `EADDRINUSE`) with a `.port` field on the error for the
 * caller's message.
 * @param {{ port?: number, root: string }} opts
 * @returns {Promise<{ server: import('node:http').Server, port: number, close: () => Promise<void> }>}
 */
export function createPanelServer(opts) {
  if (typeof opts?.root !== 'string' || opts.root.length === 0) {
    return Promise.reject(new Error('createPanelServer: "root" is required (the flows directory to serve)'));
  }
  const requestedPort = opts.port ?? DEFAULT_PORT;
  const { root } = opts;
  return new Promise((resolve, reject) => {
    // Bound port is resolved from the live socket (`server.address().port`)
    // once listening starts, not the requested value — this is what makes
    // `port: 0` (OS-assigned ephemeral port) work for callers such as the
    // test suite, while `--port N` / DEFAULT_PORT callers still get back
    // exactly the port they asked for.
    let boundPort = requestedPort;
    const server = createServer((req, res) => {
      try {
        handleRequest(req, res, { root, port: boundPort });
      } catch (e) {
        sendText(res, 500, `internal error: ${/** @type {Error} */ (e).message}`);
      }
    });
    server.once('error', (e) => {
      const err = /** @type {any} */ (e);
      err.port = requestedPort;
      reject(err);
    });
    server.listen(requestedPort, '127.0.0.1', () => {
      const addr = server.address();
      boundPort = typeof addr === 'object' && addr !== null ? addr.port : requestedPort;
      resolve({
        server,
        port: boundPort,
        close: () => new Promise((res2) => { server.close(() => res2(undefined)); }),
      });
    });
  });
}

/**
 * `fwdloop panel [--port N] [--root <dir>]` — the CLI entry (`bin/fwdloop`
 * dispatch). Never picks a different port on collision (see file header):
 * prints a loud, named error to stderr and returns 1.
 * @param {string[]} argv
 * @param {{ out: (s: string) => void, err: (s: string) => void }} ctx
 * @returns {Promise<number>}
 */
export async function panelMain(argv, ctx) {
  let port = DEFAULT_PORT;
  let root = '.';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') {
      const v = Number(argv[i + 1]);
      if (!Number.isInteger(v) || v <= 0 || v > 65535) { ctx.err(`--port must be a valid TCP port, got ${JSON.stringify(argv[i + 1])}`); return 1; }
      port = v;
      i += 1;
    } else if (argv[i] === '--root') {
      root = argv[i + 1];
      i += 1;
    }
  }
  try {
    const { port: boundPort } = await createPanelServer({ port, root });
    ctx.out(`fwdloop panel — read-only, http://127.0.0.1:${boundPort} (root: ${root}) (Ctrl-C to stop)`);
    // never resolves on its own — the process stays up until killed, same
    // shape any other long-running dev server takes.
    await new Promise(() => {});
    return 0;
  } catch (e) {
    const err = /** @type {any} */ (e);
    if (err && err.code === 'EADDRINUSE') {
      ctx.err(`fwdloop panel: port ${port} is already in use — pass --port to use a different one (never picked automatically)`);
      return 1;
    }
    ctx.err(`fwdloop panel: failed to start — ${err && err.message ? err.message : String(err)}`);
    return 1;
  }
}
