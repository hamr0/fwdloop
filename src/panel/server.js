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
// M4b pieces 1-2 (docs/wiki/the-module-ladder.md, "M4b — inputs" scope 1-3,
// "M4b amendment 1" scope 1-3): every read route is still GET/HEAD and derives
// nothing new. The writes are `POST /api/answer`, a thin client of the
// library's `answerAsk` (the panel is never a second arbiter), and
// `POST /api/resume`, which only re-starts a resume for a run that already has
// a saved, unconsumed answer. Both are refused by name unless the request is
// a real click from the served page — own `Host` and `Origin`, the per-process
// token (embedded only in the served page), a small JSON body. An answer must
// name its `askId`. `Host` is checked on EVERY route, GET included
// (DNS-rebinding read). After an accepted answer the panel starts the resume
// as a separate detached process and checks from the books that it took over
// (`src/panel/resume.js`); the reply never waits for it.
// No endpoint runs a job itself, spends money itself, signs, or reads a
// key/.env: the resume child inherits the server's own env, and this file
// never looks inside it.
//
// PATH SAFETY: a URL may name a flow ONLY (checked with `checkFlowName`) and
// a runId ONLY (resolved with `resolveRunDir`, both `src/flow.js`) — a URL
// segment is never joined into a filesystem path directly. The one exception
// is the fixed, whitelisted `/` route, which always serves this same
// directory's own `index.html`, never a URL-derived filename.

import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../catalogue.js';
import { answerAsk, normalizeDecision } from '../ask.js';
import { checkFlowName, resolveRunDir } from '../flow.js';
import {
  listRuns, getRunDetail, getRunAudit, getRunJob, listStops, inboxOpenCount, getRunAsks, readSavedAnswer,
} from './data.js';
import { createResumer } from './resume.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Cap on the answer body — a decision and a short reason, nothing more. */
const MAX_BODY_BYTES = 8 * 1024;
/** Cookie the panel link sets; `<name>_<port>` so two panels on one host never clobber each other. */
const cookieName = (port) => `fwdloop_panel_${port}`;

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

/** A refusal, by name. `refused` is the stable machine name, `red` the words.
 *  @param {any} res @param {number} code @param {string} name @param {string} [detail] */
function refuse(res, code, name, detail) {
  sendJson(res, code, { ok: false, refused: name, red: detail ? `${name}: ${detail}` : name });
}

/** Constant-time compare: both sides hashed to equal length first, so neither
 *  the content nor the length of the real token leaks through timing.
 *  @param {unknown} a @param {string} b */
function tokenMatches(a, b) {
  if (typeof a !== 'string') return false;
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * M4c-fix item 2: the token's one on-disk home — `<dir>/panel-<port>.token`, dir 0700, file 0600,
 * `dir` = `$XDG_RUNTIME_DIR/fwdloop`, else `~/.cache/fwdloop`. Refuses a dir that is a symlink or
 * not ours. The file is replaced (unlink, then exclusive create at 0600), never rewritten in place,
 * so it never exists with a looser mode. Returns the file's path.
 * @param {{ port: number, token: string, dir?: string, env?: Record<string, string|undefined> }} a
 */
export function writeTokenFile({
  port, token, dir, env = process.env,
}) {
  const d = dir ?? (env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, 'fwdloop') : join(homedir(), '.cache', 'fwdloop'));
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  mkdirSync(d, { recursive: true, mode: 0o700 });
  const st = lstatSync(d);
  if (!st.isDirectory() || (uid !== null && st.uid !== uid)) throw new Error('token dir is not a directory owned by this user');
  chmodSync(d, 0o700);
  const file = join(d, `panel-${port}.token`);
  try { unlinkSync(file); } catch { /* none yet */ }
  const fd = openSync(file, 'wx', 0o600);
  try { writeSync(fd, `${token}\n`); } finally { closeSync(fd); }
  return file;
}

/**
 * `POST /api/answer` — runs after the gates. Wraps `answerAsk` with exactly
 * the arguments `bin/fwdloop`'s `cmdAnswer` passes ({ runDir, askId, decision,
 * reason }); every library refusal is returned verbatim, non-2xx. On accept it
 * starts the detached resume (M4b piece 2) and replies at once that the
 * resume STARTED — never "done"; how it went is read from the run's data.
 * @param {any} res @param {any} body @param {string} root @param {ReturnType<typeof createResumer>} resumer
 */
function answerRoute(res, body, root, resumer) {
  const b = body !== null && typeof body === 'object' ? body : {};
  const {
    flow, runId, askId, decision, reason,
  } = b;
  if (typeof askId !== 'string' || askId.length === 0) {
    refuse(res, 400, 'askid-required', 'an answer must name the askId the page was showing');
    return;
  }
  const fc = checkFlowName(flow);
  if (!fc.ok) { refuse(res, 400, 'bad-flow', fc.red); return; }
  const rd = resolveRunDir(join(root, flow), runId);
  if (!rd.ok) { refuse(res, 400, 'bad-runId', rd.red); return; }
  const result = answerAsk({
    runDir: rd.runDir, askId, decision, reason,
  });
  if (!result.ok) {
    sendJson(res, 409, { ok: false, refused: 'library', red: result.red });
    return;
  }
  const attempt = resumer.start({
    flow, runId, runDir: rd.runDir, askId,
  });
  sendJson(res, 202, {
    ok: true, answered: true, askId, decision: normalizeDecision(decision), resume: 'started', tries: attempt.tries, maxTries: attempt.maxTries,
    note: 'answer saved; the resume was started in the background — its state is in the run\'s data (`resume`), not in this reply',
  });
}

/**
 * `POST /api/resume` — runs after the same gates as the answer. Starts a
 * resume ONLY for a run that has a saved, unconsumed answer; it takes no
 * decision or reason and can answer nothing. Same start path as the answer.
 * @param {any} res @param {any} body @param {string} root @param {ReturnType<typeof createResumer>} resumer
 */
function resumeRoute(res, body, root, resumer) {
  const b = body !== null && typeof body === 'object' ? body : {};
  const { flow, runId } = b;
  const fc = checkFlowName(flow);
  if (!fc.ok) { refuse(res, 400, 'bad-flow', fc.red); return; }
  const rd = resolveRunDir(join(root, flow), runId);
  if (!rd.ok) { refuse(res, 400, 'bad-runId', rd.red); return; }
  const saved = readSavedAnswer(rd.runDir);
  if (!saved) {
    refuse(res, 409, 'no-saved-answer', 'this run has no saved, unconsumed answer — a resume would have nothing to apply');
    return;
  }
  const current = resumer.get(flow, runId);
  if (current && current.state === 'in-flight') {
    refuse(res, 409, 'resume-in-flight', `a resume for this run is already being started (try ${current.tries} of ${current.maxTries})`);
    return;
  }
  const attempt = resumer.start({
    flow, runId, runDir: rd.runDir, askId: saved.askId,
  });
  sendJson(res, 202, {
    ok: true, resume: 'started', askId: saved.askId, tries: attempt.tries, maxTries: attempt.maxTries,
  });
}

/**
 * Handle one request against the API + the page. Exported
 * separately from {@link createPanelServer} so tests can drive it without a
 * real listening socket where that is simpler.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ root: string, port: number, token: string, resumer: ReturnType<typeof createResumer> }} opts
 */
export function handleRequest(req, res, opts) {
  const method = req.method ?? 'GET';

  // M4c-fix item 3: EVERY response — refusals, redirects, errors, the page — says it must not be
  // framed or cached. Set first, before any branch can write; `writeHead` merges these in.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');

  // Gate 1 — EVERY route, every method: `Host` must be this server's own
  // address. A foreign Host (DNS rebinding) is refused by name, never 200.
  const host = req.headers.host;
  if (host !== `127.0.0.1:${opts.port}` && host !== `localhost:${opts.port}`) {
    refuse(res, 403, 'host-not-own-address', String(host));
    return;
  }

  // Gate 2 — EVERY route, every method (the page included): the panel's own cookie, set by opening
  // the printed `/?t=<token>` link. Without it: 403 by name, and nothing in the body is a token.
  const cookies = Object.fromEntries(String(req.headers.cookie ?? '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  if (!tokenMatches(cookies[cookieName(opts.port)], opts.token)) {
    const link = method === 'GET' || method === 'HEAD' ? new URL(String(req.url), 'http://127.0.0.1') : null;
    if (link && link.pathname === '/' && tokenMatches(link.searchParams.get('t'), opts.token)) {
      res.writeHead(302, {
        'set-cookie': `${cookieName(opts.port)}=${opts.token}; HttpOnly; SameSite=Strict; Path=/`, location: '/', 'content-length': 0,
      });
      res.end();
      return;
    }
    refuse(res, 403, 'cookie-missing-or-wrong', 'open the link `fwdloop panel` printed');
    return;
  }

  if (method === 'POST' && (req.url === '/api/answer' || req.url === '/api/resume')) {
    const isResume = req.url === '/api/resume';
    const origin = req.headers.origin;
    if (origin !== `http://127.0.0.1:${opts.port}` && origin !== `http://localhost:${opts.port}`) {
      refuse(res, 403, 'origin-not-own', String(origin));
      return;
    }
    let size = 0;
    const parts = [];
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY_BYTES) parts.push(c); });
    req.on('end', () => {
      try {
        if (size > MAX_BODY_BYTES) { refuse(res, 413, 'body-too-large'); return; }
        let body;
        try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { refuse(res, 400, 'body-not-json'); return; }
        if (isResume) resumeRoute(res, body, opts.root, opts.resumer);
        else answerRoute(res, body, opts.root, opts.resumer);
      } catch (e) {
        refuse(res, 500, 'internal', /** @type {Error} */ (e).message);
      }
    });
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendText(res, 405, 'method not allowed — GET/HEAD for reads; the only writes are POST /api/answer and POST /api/resume');
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
  const resumeAttempt = (f, r) => opts.resumer.get(f, r);

  if (pathname === '/api/runs') {
    send(200, { rows: listRuns({ root: opts.root, catalogue, resumeAttempt }) });
    return;
  }

  if (pathname === '/api/inbox') {
    const rows = listStops({ root: opts.root, resumeAttempt });
    send(200, { rows, openCount: inboxOpenCount(rows) });
    return;
  }

  // /api/runs/:flow/:runId(/audit|/job|/asks)?
  const runMatch = /^\/api\/runs\/([^/]+)\/([^/]+)(\/(audit|job|asks))?$/.exec(pathname);
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
    if (sub === 'asks') {
      const result = getRunAsks({
        root: opts.root, flow, runId, catalogue, resumeAttempt,
      });
      if (!result) { sendText(res, 404, 'no such run'); return; }
      send(200, result);
      return;
    }
    const result = getRunDetail({
      root: opts.root, flow, runId, catalogue, resumeAttempt,
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
 * @param {{ port?: number, root: string, resume?: { env?: Record<string,string|undefined>, bin?: string, logDir?: string, maxTries?: number, windowMs?: number, slotMs?: number } }} opts
 *   `resume` is for tests only (a fake env/bin, a short retry window); the CLI passes none.
 * @returns {Promise<{ server: import('node:http').Server, port: number, token: string, close: () => Promise<void> }>}
 */
export function createPanelServer(opts) {
  if (typeof opts?.root !== 'string' || opts.root.length === 0) {
    return Promise.reject(new Error('createPanelServer: "root" is required (the flows directory to serve)'));
  }
  const requestedPort = opts.port ?? DEFAULT_PORT;
  const { root } = opts;
  // One resumer per server: the one owner of every run's resume-attempt record.
  const resumer = createResumer({ root, ...opts.resume });
  // One token per server process, made once, held only here and in the served
  // page — never logged, never in any /api response.
  const token = randomBytes(32).toString('hex');
  return new Promise((resolve, reject) => {
    // Bound port is resolved from the live socket (`server.address().port`)
    // once listening starts, not the requested value — this is what makes
    // `port: 0` (OS-assigned ephemeral port) work for callers such as the
    // test suite, while `--port N` / DEFAULT_PORT callers still get back
    // exactly the port they asked for.
    let boundPort = requestedPort;
    const server = createServer((req, res) => {
      try {
        handleRequest(req, res, {
          root, port: boundPort, token, resumer,
        });
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
        token,
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
    const { port: boundPort, token } = await createPanelServer({ port, root });
    writeTokenFile({ port: boundPort, token });
    ctx.out(`fwdloop panel — (root: ${root}) (Ctrl-C to stop)`);
    ctx.out(`open this link (it sets the panel's cookie): http://127.0.0.1:${boundPort}/?t=${token}`);
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
