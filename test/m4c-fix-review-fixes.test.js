// M4c-fix branch-review fixes (2026-10-04): the resume lock a failed holder write leaves behind.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, 'fixtures', 'resume-efbig-child.mjs');

test('takeResumeLock: a holder write that fails (real EFBIG) leaves no resume.lock behind', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-efbig-'));
  try {
    mkdirSync(path.join(root, 'f', 'runs', 'run-1'), { recursive: true });
    const r = spawnSync('sh', ['-c', `ulimit -f 0 && exec "${process.execPath}" "${CHILD}" "${root}"`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.result.outcome, 'refused');
    assert.match(out.result.red, /could not record the lock holder/);
    assert.equal(out.lockLeft, false, 'the empty lock this call just created must be removed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- amendment 2 (b): a failed load is a plain sentence, never an HTTP code, a path or a status number ----
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
function fnSrc(name) {
  const start = PAGE.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in the page`);
  return PAGE.slice(start, PAGE.indexOf('\n  }', start) + 4);
}
// the page's real getJSON and its one failure-to-words function, over a fake fetch
const load = new Function('fetch', `${fnSrc('getJSON')}\n${fnSrc('loadFailureText')}\nreturn { getJSON, loadFailureText };`);
const failureOf = async (fakeFetch) => {
  const { getJSON, loadFailureText } = load(fakeFetch);
  try { await getJSON('/api/runs/job2/run-1'); } catch (e) { return loadFailureText(e); }
  return assert.fail('getJSON should have rejected');
};
const resp = (status) => () => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) });

test('a failed load reads as a plain sentence for 403, 404, 500 and a network failure', async () => {
  const texts = {
    403: await failureOf(resp(403)),
    404: await failureOf(resp(404)),
    500: await failureOf(resp(500)),
    network: await failureOf(() => Promise.reject(new TypeError('fetch failed'))),
  };
  assert.match(texts[403], /Open the link the terminal printed/);
  assert.equal(texts[404], 'This run is no longer there.');
  assert.equal(texts[500], 'Could not load this; reload the page.');
  assert.equal(texts.network, 'Could not load this; reload the page.');
  for (const t of Object.values(texts)) {
    assert.doesNotMatch(t, /HTTP|\/api\/|\d{3}/, `no code or path in "${t}"`);
  }
});

test('every load-failure paint in the page goes through loadFailureText, never the error message', () => {
  assert.doesNotMatch(PAGE, /\be\.message\b/, 'no catch site paints the thrown message');
  assert.doesNotMatch(PAGE, /failed to load/, 'no "failed to load: <detail>" paint is left');
  const sites = PAGE.match(/(?<!function )loadFailureText\(e\)/g) || [];
  assert.equal(sites.length, 6, 'run, asks x2, workflows, history, inbox');
});
