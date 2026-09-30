// poc/m4b/answer-door.mjs — M4b POC (docs/wiki/the-module-ladder.md, "M4b —
// inputs — SIGNED"). THROWAWAY: proves or kills one assumption — a panel HTTP
// answer path can (a) refuse everything that is not a real click from the
// served page, (b) hand the answer to the library's `answerAsk` and nothing
// else, (c) start the resume as a DETACHED process that outlives the request,
// once per answer — with NO change to src/ books or arbiter.
//
// It wraps src/panel/server.js `handleRequest` for GETs (never forks it) and
// adds exactly one route, POST /api/answer. $0: never reads a key itself; the
// resume child gets whatever env the caller hands in.

import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleRequest } from '../../src/panel/server.js';
import { answerAsk } from '../../src/ask.js';
import { readAsk } from '../../src/runner.js';
import { checkFlowName, resolveRunDir } from '../../src/flow.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'fwdloop');
const MAX_BODY = 8 * 1024;

function refuse(res, code, name, detail) {
  const text = JSON.stringify({ ok: false, refused: name, red: detail ? `${name}: ${detail}` : name });
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

/** Constant-time string compare (length leak only, which is fixed here). */
function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** Serve the real panel page, with the token embedded (only place it lives).
 *  Runs the library's own handleRequest against a capturing response. */
function servePage(req, res, opts, token) {
  const chunks = []; let code = 200; let headers = {};
  const cap = {
    writeHead(c, h) { code = c; headers = h ?? {}; },
    end(b) { if (b) chunks.push(Buffer.from(b)); },
  };
  handleRequest(req, cap, opts);
  let body = Buffer.concat(chunks).toString('utf8');
  if (code === 200 && /text\/html/.test(headers['content-type'] ?? '')) {
    body = body.replace('</head>', `<meta name="fwdloop-token" content="${token}"></head>`);
  }
  const h = { ...headers }; h['content-length'] = Buffer.byteLength(body);
  res.writeHead(code, h);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/**
 * @param {{ root: string, env?: Record<string,string|undefined>, logDir: string, bin?: string }} o
 *   env: handed to the resume child unchanged ("the panel server's own env").
 */
export function createAnswerDoor(o) {
  const { root, logDir } = o;
  const childEnv = o.env ?? process.env;
  const token = randomBytes(32).toString('hex');
  const spawned = []; // one entry per resume process started
  let boundPort = 0;

  const hostOk = (h) => typeof h === 'string' && (h === `127.0.0.1:${boundPort}` || h === `localhost:${boundPort}`);
  const originOk = (v) => typeof v === 'string' && (v === `http://127.0.0.1:${boundPort}` || v === `http://localhost:${boundPort}`);

  const server = createServer((req, res) => {
    try {
      // Gate 1 — EVERY route, every method: Host is our own address.
      if (!hostOk(req.headers.host)) return refuse(res, 403, 'host-not-own-address', String(req.headers.host));

      if (req.method === 'GET' || req.method === 'HEAD') {
        return servePage(req, res, { root, port: boundPort }, token);
      }
      if (req.url !== '/api/answer') return refuse(res, 405, 'method-not-allowed');
      if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed');
      if (!originOk(req.headers.origin)) return refuse(res, 403, 'origin-not-own', String(req.headers.origin));
      if (!safeEq(req.headers['x-fwdloop-token'] ?? '', token)) return refuse(res, 403, 'token-missing-or-wrong');

      let size = 0; const parts = [];
      req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) parts.push(c); });
      req.on('end', () => {
        try {
          if (size > MAX_BODY) return refuse(res, 413, 'body-too-large');
          let b;
          try { b = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return refuse(res, 400, 'body-not-json'); }
          return answer(res, b);
        } catch (e) {
          return refuse(res, 500, 'internal', e.message);
        }
      });
    } catch (e) {
      return refuse(res, 500, 'internal', e.message);
    }
    return undefined;
  });

  function answer(res, b) {
    const { flow, runId, verdict, reason, askId: bodyAskId } = b ?? {};
    const fc = checkFlowName(flow);
    if (fc && fc.ok === false) return refuse(res, 400, 'bad-flow', fc.red);
    const rd = resolveRunDir(join(root, String(flow)), String(runId));
    if (!rd.ok) return refuse(res, 400, 'bad-runId', rd.red);
    const ask = readAsk(rd.runDir);
    if (!ask) return json(res, 409, { ok: false, red: `answerAsk: no open ask for run ${rd.runDir}` });
    // Exactly what cmdAnswer passes: { runDir, askId, decision, reason }.
    // askId is the page's if it sent one (stale-click safe), else the current ask's.
    const askId = typeof bodyAskId === 'string' ? bodyAskId : ask.askId;
    const result = answerAsk({ runDir: rd.runDir, askId, decision: verdict, reason });
    if (!result.ok) return json(res, 409, { ok: false, red: result.red }); // library's name, verbatim
    const logPath = join(logDir, `resume-${String(flow)}-${String(runId)}-${spawned.length}.log`);
    const fd = openSync(logPath, 'a');
    const child = spawn(process.execPath, [o.bin ?? BIN, 'resume', String(runId), '--flow', String(flow), '--root', root], {
      detached: true, stdio: ['ignore', fd, fd], env: childEnv,
    });
    child.unref();
    closeSync(fd);
    spawned.push({ pid: child.pid, askId, logPath, at: Date.now() });
    return json(res, 202, { ok: true, askId, resume: 'started' });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      boundPort = server.address().port;
      resolve({
        server, port: boundPort, token, spawned,
        origin: `http://127.0.0.1:${boundPort}`,
        close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }),
      });
    });
  });
}
