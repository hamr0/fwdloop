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
// a saved, unconsumed answer. M4c-fix amendment 1 adds `POST /api/reopen`, the human's one button on an expired ask
// (`reopenAsk`, `src/ask.js`). All three are refused by name unless the request is
// a real click from the served page — own `Host` and `Origin` (no token, no
// cookie: M4e amendment 4 item 8), a small JSON body. An answer must
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
import { readFileSync, realpathSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../catalogue.js';
import { answerAsk, reopenAsk, normalizeDecision } from '../ask.js';
import { readHistory } from '../books.js';
import { resolveRunDir } from '../flow.js';
import { readAsk } from '../runner.js';
import {
  listRuns, getRunDetail, getRunAudit, getRunJob, listStops, inboxOpenCount, getRunAsks, readSavedAnswer, hasConsumedAnswer, resolveFlowDir,
} from './data.js';
import { createResumer } from './resume.js';
import { createAuthor } from './author.js';
import { keysForDoor } from '../keysfile.js';
import { configDoorHome } from '../config.js';
import { createSettings } from './settings.js';
import { removeOldLock } from './lock.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Cap on the answer body — a decision and a short reason, nothing more. */
const MAX_BODY_BYTES = 8 * 1024;
/** Cap on a draft-card body — a few numbered job lines, not a document (M4e). */
const MAX_AUTHOR_BODY_BYTES = 64 * 1024;
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
 * M4c-fix item 5: no absolute path in any error body. A path under `--root` is shown relative to
 * it; any other absolute path (a symlink's far end, a system dir) is shown as `<outside root>`.
 * Throws away: the machine's directory layout above `--root`.
 * @param {string} text @param {string} root
 */
function cleanPaths(text, root) {
  const bases = [path.resolve(root)];
  try { bases.push(realpathSync(root)); } catch { /* root gone: the lexical base still applies */ }
  return String(text).replace(/(?<![\w:/.])\/[^\s\x22\x27\x60()<>,;]+/g, (m) => {
    for (const b of bases) {
      if (m === b) return '.';
      if (m.startsWith(`${b}/`)) return m.slice(b.length + 1);
    }
    return '<outside root>';
  });
}

/** A refusal, by name. `refused` is the stable machine name, `red` the words.
 *  @param {any} res @param {number} code @param {string} name @param {string} [detail] */
function refuse(res, code, name, detail) {
  sendJson(res, code, { ok: false, refused: name, red: detail ? `${name}: ${detail}` : name });
}

/** Send a Settings handler's `{status, body}`; a throw is a plain 500, never a stack. @param {any} res @param {Promise<{status:number, body:any}>} pending @param {boolean} [headOnly] */
function settingsReply(res, pending, headOnly = false) {
  pending.then((r) => {
    if (!headOnly) { sendJson(res, r.status, r.body); return; }
    res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8' });
    res.end();
  }, () => sendJson(res, 500, { ok: false, refused: 'internal', say: 'Something went wrong inside the panel. Nothing was changed.' }));
}

/** @param {any} res */
function refuseBusy(res) {
  refuse(res, 409, 'already-resuming', 'already resuming — this run has a resume in progress; wait for it to end');
}

/**
 * The ONE place a write route turns `{flow, runId}` into a run dir: the flow must really sit inside
 * `--root` (`resolveFlowDir`, realpath at use time — a symlinked flow outside root is refused by
 * name), then the runId resolves inside that flow's runs/. On a refusal it has already replied.
 * @param {any} res @param {string} root @param {unknown} flow @param {unknown} runId
 * @returns {string|null} the run dir, or null (already replied)
 */
function resolveRun(res, root, flow, runId) {
  const fd = resolveFlowDir(root, /** @type {string} */ (flow));
  if (!fd.ok) {
    if (fd.why === 'outside-root') refuse(res, 403, 'flow-outside-root', cleanPaths(fd.red, root));
    else refuse(res, 400, 'bad-flow', cleanPaths(fd.red, root));
    return null;
  }
  const rd = resolveRunDir(fd.flowDir, runId);
  if (!rd.ok) { refuse(res, 400, 'bad-runId', cleanPaths(rd.red, root)); return null; }
  return rd.runDir;
}

/** Is the run already parked on `askId` and waiting on the human: it is the open `ask.json`, no answer is saved
 *  for it and none was consumed? Then a resume child still alive for the run is only closing.
 *  @param {string} runDir @param {string} askId */
function parkedOnYou(runDir, askId) {
  return readAsk(runDir)?.askId === askId && readSavedAnswer(runDir) === null && !hasConsumedAnswer(runDir, askId);
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
  const runDir = resolveRun(res, root, flow, runId);
  if (runDir === null) return;
  // One resume at a time per run (M4c-fix item 1): refused BEFORE the answer is written, so a refused
  // click leaves the books as they were.
  // Only a real concurrent resume is blocked. A previous resume child that is merely closing — the run has already
  // parked on THIS ask, nothing answered or consumed for it — does not block the human's answer (amendment 1 (e)(1)).
  if (resumer.busy(flow, runId) && !parkedOnYou(runDir, askId)) { refuseBusy(res); return; }
  const result = answerAsk({
    runDir, askId, decision, reason,
  });
  if (!result.ok) {
    sendJson(res, 409, { ok: false, refused: 'library', red: cleanPaths(result.red, root) });
    return;
  }
  const attempt = resumer.start({
    flow, runId, runDir, askId,
  });
  sendJson(res, 202, {
    ok: true, answered: true, askId, decision: normalizeDecision(decision), setAside: result.setAside, resume: 'started', tries: attempt.tries, maxTries: attempt.maxTries,
    note: 'answer saved; the resume was started in the background — its state is in the run\'s data (`resume`), not in this reply',
  });
}

/**
 * `POST /api/reopen` — runs after the same gates as the answer (own Host, own Origin). The human's
 * "Reopen for another <wait>" on an expired ask (M4c-fix amendment 1 (b)): `reopenAsk` writes the reopen record
 * (a fresh window of the same signed length, on the same ask) and moves a late answer aside. Nothing else reopens:
 * no runner or agent path calls it. Refused 409 while a resume of the run is alive, and for a run that has ended.
 * @param {any} res @param {any} body @param {string} root @param {ReturnType<typeof createResumer>} resumer
 */
function reopenRoute(res, body, root, resumer) {
  const b = body !== null && typeof body === 'object' ? body : {};
  const { flow, runId, askId } = b;
  if (typeof askId !== 'string' || askId.length === 0) {
    refuse(res, 400, 'askid-required', 'a reopen must name the askId the page was showing');
    return;
  }
  const runDir = resolveRun(res, root, flow, runId);
  if (runDir === null) return;
  if (resumer.busy(flow, runId)) { refuseBusy(res); return; }
  if (readHistory(dirname(dirname(runDir))).some((r) => r && r.runId === runId)) {
    refuse(res, 409, 'run-ended', 'this run has ended — there is nothing to reopen');
    return;
  }
  const result = reopenAsk({ runDir, askId, by: 'human via panel' });
  if (!result.ok) {
    sendJson(res, 409, { ok: false, refused: 'library', red: cleanPaths(result.red, root) });
    return;
  }
  sendJson(res, 200, {
    ok: true, reopened: true, askId, expiresAt: result.expiresAt, n: result.n, setAside: result.setAside,
  });
}

/**
 * `POST /api/remove-lock` — runs after the same gates as the answer (own Host, own Origin). The human's
 * "Remove the old lock" (M4c-fix amendment 2 (h)): only for a run with a saved answer and no resume alive; `removeOldLock`
 * re-checks at this moment that the lock still has no recorded holder, removes it and writes the one audit row; then the
 * run continues exactly like "Continue the run" (the same `resumer.start`). Nothing else calls the remover.
 * @param {any} res @param {any} body @param {string} root @param {ReturnType<typeof createResumer>} resumer
 */
function removeLockRoute(res, body, root, resumer) {
  const b = body !== null && typeof body === 'object' ? body : {};
  const { flow, runId } = b;
  const runDir = resolveRun(res, root, flow, runId);
  if (runDir === null) return;
  const saved = readSavedAnswer(runDir);
  if (!saved) {
    refuse(res, 409, 'no-saved-answer', 'this run has no saved, unconsumed answer — a resume would have nothing to apply');
    return;
  }
  if (resumer.busy(flow, runId)) { refuseBusy(res); return; }
  const removed = removeOldLock({ root, runDir });
  if (!removed.ok) { refuse(res, 409, removed.refused, cleanPaths(removed.red, root)); return; }
  const attempt = resumer.start({
    flow, runId, runDir, askId: saved.askId,
  });
  sendJson(res, 202, {
    ok: true, lockRemoved: true, resume: 'started', askId: saved.askId, tries: attempt.tries, maxTries: attempt.maxTries,
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
  const runDir = resolveRun(res, root, flow, runId);
  if (runDir === null) return;
  const saved = readSavedAnswer(runDir);
  if (!saved) {
    refuse(res, 409, 'no-saved-answer', 'this run has no saved, unconsumed answer — a resume would have nothing to apply');
    return;
  }
  if (resumer.busy(flow, runId)) { refuseBusy(res); return; }
  const attempt = resumer.start({
    flow, runId, runDir, askId: saved.askId,
  });
  sendJson(res, 202, {
    ok: true, resume: 'started', askId: saved.askId, tries: attempt.tries, maxTries: attempt.maxTries,
  });
}

/**
 * `POST /api/author/{draft,run,<id>/sign-prepare,<id>/sign,<id>/revise,<id>/abandon,start/<id>/clear}` — run after the same gates as every other POST.
 * Anything else under `/api/author/` is a 404 by name.
 * @param {any} res @param {string} url @param {any} body @param {ReturnType<typeof createAuthor>} author
 */
function authorPost(res, url, body, author) {
  const send = (r) => sendJson(res, r.status, r.body);
  if (url === '/api/author/draft') { send(author.start(body)); return; }
  if (url === '/api/author/run') { send(author.run(body)); return; }
  const sp = /^\/api\/author\/([^/]+)\/sign-prepare$/.exec(url);
  if (sp) { send(author.signPrepare(sp[1])); return; }
  const sg = /^\/api\/author\/([^/]+)\/sign$/.exec(url);
  if (sg) { send(author.sign(sg[1], body)); return; }
  const rv = /^\/api\/author\/([^/]+)\/revise$/.exec(url);
  if (rv) { send(author.revise(rv[1], body)); return; }
  const sc = /^\/api\/author\/start\/([^/]+)\/clear$/.exec(url);
  if (sc) { send(author.startClear(sc[1])); return; }
  const m = /^\/api\/author\/([^/]+)\/abandon$/.exec(url);
  if (m) { author.abandon(m[1]).then(send, () => sendJson(res, 500, { ok: false, refused: 'internal', red: 'internal error' })); return; }
  refuse(res, 404, 'not-found', url);
}

/**
 * Handle one request against the API + the page. Exported
 * separately from {@link createPanelServer} so tests can drive it without a
 * real listening socket where that is simpler.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ root: string, port: number, resumer: ReturnType<typeof createResumer>, settings: ReturnType<typeof createSettings>, author: ReturnType<typeof createAuthor> }} opts
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

  // No token, no cookie (M4e amendment 4 item 8): the panel is local and trusted. What guards it is Gate 1 above
  // (own Host, so a DNS-rebinding name is refused), the 127.0.0.1-only bind, and the Origin check on every POST below.

  // M4d piece 4: every `/api/settings/...` POST (a known one or not) goes through the same Origin + body-cap gates.
  const isSettingsPost = method === 'POST' && String(req.url).startsWith('/api/settings/');
  // M4e piece 2a: every `/api/author/...` POST goes through the SAME door (own Host, own Origin, body cap) — no second guard.
  const isAuthorPost = method === 'POST' && String(req.url).startsWith('/api/author/');
  if (method === 'POST' && (isSettingsPost || isAuthorPost || req.url === '/api/answer' || req.url === '/api/resume' || req.url === '/api/reopen' || req.url === '/api/remove-lock')) {
    const isResume = req.url === '/api/resume';
    const isReopen = req.url === '/api/reopen';
    const isRemoveLock = req.url === '/api/remove-lock';
    const origin = req.headers.origin;
    if (origin !== `http://127.0.0.1:${opts.port}` && origin !== `http://localhost:${opts.port}`) {
      refuse(res, 403, 'origin-not-own', String(origin));
      return;
    }
    let size = 0;
    const parts = [];
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      size += c.length;
      if (size <= (isAuthorPost ? MAX_AUTHOR_BODY_BYTES : MAX_BODY_BYTES)) { parts.push(c); return; }
      // M4c-fix item 6: over the limit — stop at once. Drop what was collected, refuse (413, then the
      // connection closes), and cut the request off; the rest of the body is never read.
      tooBig = true;
      parts.length = 0;
      res.setHeader('Connection', 'close');
      refuse(res, 413, 'body-too-large');
      res.once('finish', () => req.destroy());
    });
    req.on('end', () => {
      try {
        if (tooBig) return;
        let body;
        try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { refuse(res, 400, 'body-not-json'); return; }
        if (isAuthorPost) { authorPost(res, String(req.url), body, opts.author); return; }
        if (isSettingsPost) { settingsReply(res, opts.settings.handle({ method, pathname: String(req.url), query: new URLSearchParams(), body })); return; }
        if (isResume) resumeRoute(res, body, opts.root, opts.resumer);
        else if (isReopen) reopenRoute(res, body, opts.root, opts.resumer);
        else if (isRemoveLock) removeLockRoute(res, body, opts.root, opts.resumer);
        else answerRoute(res, body, opts.root, opts.resumer);
      } catch (e) {
        sendJson(res, 500, { ok: false, refused: 'internal', red: 'internal error' });
      }
    });
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendText(res, 405, 'method not allowed — GET/HEAD for reads; the only writes are POST /api/answer, POST /api/resume, POST /api/reopen, POST /api/remove-lock, POST /api/settings/... and POST /api/author/...');
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

  if (pathname.startsWith('/api/author/')) {
    const am = /^\/api\/author\/([^/]+)$/.exec(pathname);
    const sm = /^\/api\/author\/start\/([^/]+)$/.exec(pathname);
    let r = { status: 404, body: /** @type {any} */ ({ ok: false, refused: 'not-found' }) };
    if (pathname === '/api/author/live') r = opts.author.live();
    else if (pathname === '/api/author/flows') r = opts.author.flows();
    else if (pathname === '/api/author/monthly-check') r = opts.author.monthlyCheck(url.searchParams.get('cap'));
    else if (sm) r = opts.author.startGet(sm[1]);
    else if (am) r = opts.author.get(am[1]);
    if (method === 'HEAD') { res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8' }); res.end(); return; }
    sendJson(res, r.status, r.body);
    return;
  }

  if (pathname.startsWith('/api/settings/')) {
    settingsReply(res, opts.settings.handle({
      method: 'GET', pathname, query: url.searchParams, body: null,
    }), method === 'HEAD');
    return;
  }

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
    sendText(res, 500, `catalogue failed to load: ${cleanPaths(loaded.reds.join('; '), opts.root)}`);
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

    // A flow symlinked outside --root is refused BY NAME for every read (the data layer alone would
    // only say "no such run"). Anything else about the flow still falls through to the 404.
    const fd = resolveFlowDir(opts.root, flow);
    if (!fd.ok && fd.why === 'outside-root') { refuse(res, 403, 'flow-outside-root', cleanPaths(fd.red, opts.root)); return; }

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
 * @param {{ port?: number, root: string, settings?: { home?: string, env?: Record<string,string|undefined>, fetch?: typeof fetch, now?: () => number }, resume?: { env?: Record<string,string|undefined>, bin?: string, logDir?: string, maxTries?: number, windowMs?: number, slotMs?: number }, author?: { env?: Record<string,string|undefined>, loadEnv?: () => any, bin?: string } }} opts
 *   `resume` and `author` are for tests only (a fake env/bin, a short retry window); the CLI passes none.
 * @returns {Promise<{ server: import('node:http').Server, port: number, close: () => Promise<void> }>}
 */
export function createPanelServer(opts) {
  if (typeof opts?.root !== 'string' || opts.root.length === 0) {
    return Promise.reject(new Error('createPanelServer: "root" is required (the flows directory to serve)'));
  }
  const requestedPort = opts.port ?? DEFAULT_PORT;
  const { root } = opts;
  // One resumer per server: the one owner of every run's resume-attempt record.
  // M4d: the keys file is re-read before EVERY resume spawn (editing it needs no restart); an env injected by a test is the shell side.
  const resumer = createResumer({ root, loadEnv: () => keysForDoor({ env: opts.resume?.env }), ...opts.resume });
  // M4e piece 2a: the draft door. Same keys door as the resumer: the merged env is re-read before every spawn and every log quote.
  // The courtesy "left this month" line reads the SAME home the CLI's monthly check does (injected, else the door's).
  const door = configDoorHome();
  const author = createAuthor({
    root, home: opts.settings?.home ?? door.home, skipMonthly: opts.settings?.home === undefined && door.skip, loadEnv: () => keysForDoor({ env: opts.author?.env }), ...opts.author,
  });
  // Settings reads and writes only under the one config home: an injected one (tests), else the door's — under a test
  // process with no FWDLOOP_CONFIG_HOME, Settings is switched off rather than touch the real ~/.config/fwdloop.
  const settings = createSettings({
    home: opts.settings?.home ?? door.home, skip: opts.settings?.home === undefined && door.skip, env: opts.settings?.env, fetch: opts.settings?.fetch, now: opts.settings?.now,
  });
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
          root, port: boundPort, resumer, settings, author,
        });
      } catch (e) {
        sendText(res, 500, 'internal error');
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
    // M4d: read the keys file at start (creates it when missing). The panel itself needs no key, so a file other users can
    // read is only announced here; every resume re-reads it and refuses by itself.
    const keys = keysForDoor();
    if (!keys.ok) ctx.err(String(keys.refusal));
    ctx.out(`fwdloop panel — (root: ${root}) (Ctrl-C to stop)`);
    ctx.out(`http://127.0.0.1:${boundPort}/`);
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
