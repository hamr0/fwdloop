// F48 round 3 (docs/logs/FINDINGS.md): round 2 closed a symlinked run DIRECTORY
// (`resolveRunDir`/`resolveFlowDir` realpath-check `runs/<runId>` and
// `<root>/<flowName>`). A debrief then showed the same class one level
// deeper, live: a real run dir whose book FILE (`audit.jsonl`, `ask.json`,
// etc.) is a symlink pointing outside `--root` was still followed by every
// reader, and `bin/fwdloop`'s `inbox`/`show` built their own run paths
// without going through the checked builders at all (a symlinked `ask.json`'s
// outside content was printed by `fwdloop inbox`, live).
//
// This suite is table-driven across every book file the panel/CLI actually
// reads, plants each one as a symlink to an outside file carrying a unique
// secret marker, and proves (a) the library reader never returns the marker,
// (b) the panel's HTTP route never returns the marker, and (c) the CLI never
// prints the marker. A normal (non-symlinked) run must still read fully —
// covered by the large existing suites (panel.test.js, cli.test.js,
// books.test.js, runner.test.js), kept green by this same change.

import assert from 'node:assert/strict';
import { test, describe, after } from 'node:test';
import http from 'node:http';
import {
  mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { createPanelServer } from '../src/panel/server.js';
import { getRunAudit } from '../src/panel/data.js';
import {
  readAudit, readHistory, readLog, readRunState, readAsk, readSpendRows, listArchivedAsks, writeAskArchive,
} from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const SECRET_MARKER = 'F48-ROUND-3-SECRET-MARKER-DO-NOT-LEAK-4f8a9c2b';

function tmpRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), `fwdloop-f48-${prefix}-`));
}

/** A file outside `root` entirely, carrying the marker — every scenario
 *  below symlinks a run-dir book file at this SAME outside target. */
function writeOutsideSecret(prefix) {
  const dir = tmpRoot(`${prefix}-outside`);
  const target = path.join(dir, 'secret.txt');
  // A JSON-shaped body too, so a reader that JSON.parses it (ask.json,
  // state.json, log.json, spend rows) would surface the marker in a real
  // field, not just fail to parse and drop it silently either way.
  writeFileSync(target, JSON.stringify({ leaked: SECRET_MARKER, askId: SECRET_MARKER, decision: 'accept' }));
  return { dir, target };
}

function writeTestFlow(root, name) {
  const result = writeFlow({
    root,
    name,
    proseText: fixture('job2-with-sources.signed.txt'),
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: 'hamr',
    signedAt: '2026-09-27T12:00:00Z',
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result.dir;
}

function makeRunDir(flowDir, runId) {
  const runDir = path.join(flowDir, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

// ---------------------------------------------------------------------------
// Library readers: one book file at a time, planted as a symlink to the
// outside secret. Every reader must come back with its own "book file
// missing" shape — never the marker.
// ---------------------------------------------------------------------------

describe('F48 round 3: a symlinked book FILE is refused/treated as missing, never followed', () => {
  const outsides = [];
  after(() => { for (const o of outsides) rmSync(o.dir, { recursive: true, force: true }); });

  test('books.readAudit: a symlinked audit.jsonl reads as [], never the outside content', () => {
    const root = tmpRoot('audit');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outside = writeOutsideSecret('audit');
    outsides.push(outside);
    symlinkSync(outside.target, path.join(runDir, 'audit.jsonl'));

    const rows = readAudit(runDir);
    assert.deepEqual(rows, []);
  });

  test('books.readHistory: a symlinked history.jsonl reads as [], never the outside content', () => {
    const root = tmpRoot('history');
    const flowDir = writeTestFlow(root, 'job2');
    const outside = writeOutsideSecret('history');
    outsides.push(outside);
    symlinkSync(outside.target, path.join(flowDir, 'history.jsonl'));

    const rows = readHistory(flowDir);
    assert.deepEqual(rows, []);
  });

  test('runner.readLog: a symlinked log.json reads as null, never the outside content', () => {
    const root = tmpRoot('log');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outside = writeOutsideSecret('log');
    outsides.push(outside);
    symlinkSync(outside.target, path.join(runDir, 'log.json'));

    assert.equal(readLog(runDir), null);
  });

  test('runner.readRunState: a symlinked state.json reads as null, never the outside content', () => {
    const root = tmpRoot('state');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outside = writeOutsideSecret('state');
    outsides.push(outside);
    symlinkSync(outside.target, path.join(runDir, 'state.json'));

    assert.equal(readRunState(runDir), null);
  });

  test('runner.readAsk: a symlinked ask.json reads as null, never the outside content', () => {
    const root = tmpRoot('ask');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outside = writeOutsideSecret('ask');
    outsides.push(outside);
    symlinkSync(outside.target, path.join(runDir, 'ask.json'));

    assert.equal(readAsk(runDir), null);
  });

  test('provider.readSpendRows: a symlinked spend.jsonl reads as [], never the outside content', () => {
    const root = tmpRoot('spend');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outside = writeOutsideSecret('spend');
    outsides.push(outside);
    symlinkSync(outside.target, path.join(runDir, 'spend.jsonl'));

    const rows = readSpendRows(path.join(runDir, 'spend.jsonl'));
    assert.deepEqual(rows, []);
  });

  test('ask.listArchivedAsks: a symlinked asks/ DIRECTORY reads as archived:false, never listing the outside directory', () => {
    const root = tmpRoot('asksdir');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outsideDir = tmpRoot('asksdir-outside');
    outsides.push({ dir: outsideDir });
    writeFileSync(path.join(outsideDir, 'leaked-ask.json'), JSON.stringify({ askId: SECRET_MARKER }));
    symlinkSync(outsideDir, path.join(runDir, 'asks'));

    const result = listArchivedAsks(runDir);
    assert.equal(result.archived, false);
    assert.ok(!JSON.stringify(result).includes(SECRET_MARKER));
  });

  test('ask.listArchivedAsks: a symlinked entry INSIDE a real asks/ dir is skipped, never followed', () => {
    const root = tmpRoot('askentry');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outside = writeOutsideSecret('askentry');
    outsides.push(outside);

    const okArchive = writeAskArchive({
      runDir, askId: 'real-ask-1', question: 'a real question', askedAt: '2026-09-27T12:00:00Z', expiresAt: '2026-09-27T13:00:00Z', evidence: { text: 'a real draft' },
    });
    assert.equal(okArchive.ok, true, okArchive.ok ? '' : okArchive.red);
    symlinkSync(outside.target, path.join(runDir, 'asks', 'evil-ask.json'));

    const result = listArchivedAsks(runDir);
    assert.equal(result.archived, true);
    assert.equal(result.asks.length, 1, 'the symlinked entry must be skipped, only the real archived ask shown');
    assert.equal(result.asks[0].askId, 'real-ask-1');
    assert.ok(!JSON.stringify(result).includes(SECRET_MARKER));
  });

  test('ask.listArchivedAsks: a symlinked consumed-answer marker is never read as proof of an answer', () => {
    const root = tmpRoot('consumed');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outside = writeOutsideSecret('consumed');
    outsides.push(outside);

    const okArchive = writeAskArchive({
      runDir, askId: 'ask-c1', question: 'a real question', askedAt: '2026-09-27T12:00:00Z', expiresAt: '2099-09-27T13:00:00Z', evidence: { text: 'a real draft' },
    });
    assert.equal(okArchive.ok, true, okArchive.ok ? '' : okArchive.red);
    symlinkSync(outside.target, path.join(runDir, 'answer.ask-c1.consumed.json'));

    const result = listArchivedAsks(runDir);
    assert.equal(result.archived, true);
    assert.notEqual(result.asks[0].answer.status, 'accepted', 'a symlinked consumed marker must never count as a real answer');
    assert.ok(!JSON.stringify(result).includes(SECRET_MARKER));
  });
});

// ---------------------------------------------------------------------------
// Panel HTTP route: the Audit tab's own route, over a real symlinked
// audit.jsonl — the exact live shape the debrief found (HTTP 200 with the
// outside file's bytes).
// ---------------------------------------------------------------------------

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('F48 round 3: panel HTTP route over a symlinked audit.jsonl', () => {
  test('GET /api/runs/:flow/:runId/audit never returns a symlinked audit.jsonl\'s outside content', async () => {
    const root = tmpRoot('panel-audit');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outside = writeOutsideSecret('panel-audit');
    try {
      symlinkSync(outside.target, path.join(runDir, 'audit.jsonl'));

      // Direct data-layer call too (port:0 below covers the HTTP shell).
      const direct = getRunAudit({ root, flow: 'job2', runId: 'run-1' });
      assert.ok(direct, 'run must still resolve (the run DIR itself is real)');
      assert.deepEqual(direct.rows, []);
      assert.ok(!JSON.stringify(direct).includes(SECRET_MARKER));

      const handle = await createPanelServer({ port: 0, root });
      try {
        const r = await get(handle.port, '/api/runs/job2/run-1/audit');
        assert.equal(r.status, 200);
        assert.doesNotMatch(r.body, new RegExp(SECRET_MARKER));
      } finally {
        await handle.close();
      }
    } finally {
      rmSync(outside.dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// CLI: `fwdloop inbox` must never print a symlinked ask.json's outside
// content (the exact live bug the debrief found — round 2 only fixed the
// panel's `resolveFlowDir`/`resolveRunDir`; the CLI built its own paths and
// was never touched).
// ---------------------------------------------------------------------------

function runCli(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 15_000,
  });
}

describe('F48 round 3: CLI over a symlinked ask.json', () => {
  test('fwdloop inbox never prints a symlinked ask.json\'s outside content', () => {
    const root = tmpRoot('cli-inbox');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outside = writeOutsideSecret('cli-inbox');
    try {
      symlinkSync(outside.target, path.join(runDir, 'ask.json'));

      const result = runCli(['inbox', '--root', root]);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, new RegExp(SECRET_MARKER));
      assert.doesNotMatch(result.stderr, new RegExp(SECRET_MARKER));
    } finally {
      rmSync(outside.dir, { recursive: true, force: true });
    }
  });

  test('fwdloop show never prints a symlinked ask.json\'s outside content (and cannot find it by that askId)', () => {
    const root = tmpRoot('cli-show');
    const flowDir = writeTestFlow(root, 'job2');
    const runDir = makeRunDir(flowDir, 'run-1');
    const outside = writeOutsideSecret('cli-show');
    try {
      symlinkSync(outside.target, path.join(runDir, 'ask.json'));

      // findRunDirByAskId walks readAsk() (guarded) — a symlinked ask.json
      // reads as null, so the marker's own "askId" can never even be found.
      const result = runCli(['show', SECRET_MARKER, '--root', root]);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, new RegExp(SECRET_MARKER));
      assert.match(result.stderr, /no open ask found/);
    } finally {
      rmSync(outside.dir, { recursive: true, force: true });
    }
  });
});
