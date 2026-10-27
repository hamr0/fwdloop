// M12 amendment 1 (docs/wiki/the-module-ladder.md): a ticket is read with its body (barebrowse `data` snapshot mode); `page:` inputs keep the `act` reader. $0: no model, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { fetchPageText } from '../src/pagefetch.js';
import { freezeInputs } from '../src/runner.js';

const BODY = 'Status: BLOCKED / conditional - no action until the upstream release lands and the tracking checklist is ticked off';
const ACT = `url: https://x.example/o/r/issues/57\n- heading "Ticket title" [ref=1]\n- list\n  - checkbox "a checklist item that is long enough to count as content" [ref=2]\n  - link "another link with enough words to pass the floor" [ref=3]\n- text filler filler filler filler filler filler filler filler\n`;
const DATA = `${ACT}- paragraph "${BODY}"\n`;

/** a fake barebrowse whose `act` snapshot lacks the body and whose `data` snapshot has it; records every snapshot mode asked for */
function fakeBrowser() {
  const modes = [];
  return {
    modes,
    async connect() {
      return {
        async goto(url) { return { url, status: 200 }; },
        async waitForNetworkIdle() {},
        async snapshot(o = {}) { modes.push(o.mode); return o.mode === 'data' ? DATA : ACT; },
        async close() {},
      };
    },
  };
}
const opts = (b) => ({ connect: b.connect, idleMs: 5, idleTimeoutMs: 40, closeWaitMs: 50 });

test('a ticket input is frozen with its body (data mode); a page input is frozen with the act reader and lacks it', async () => {
  const run = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12am1-'));
  const b = fakeBrowser();
  const fetchPage = (u, o) => fetchPageText(u, { ...opts(b), ...o });
  const r = await freezeInputs(run, [{ id: 'ticket', path: 'https://x.example/o/r/issues/57' }, { id: 'page', path: 'https://x.example/p' }], { fetchPage, ticketRoles: ['ticket'] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(readFileSync(path.join(run, 'inputs', 'ticket.txt'), 'utf8').includes(BODY), 'the ticket carries its body');
  assert.ok(!readFileSync(path.join(run, 'inputs', 'page.txt'), 'utf8').includes(BODY), 'a page keeps today\'s reader');
  assert.deepEqual(b.modes, ['data', 'act']);
  assert.ok(r.manifest.every((e) => /^[0-9a-f]{64}$/.test(e.sha256)), 'both still carry a sha256');
});

test('a ticket is still refused on a non-2xx status, nothing frozen', async () => {
  const run = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12am1-'));
  const b = fakeBrowser();
  const conn = async () => { const p = await b.connect(); p.goto = async (url) => ({ url, status: 404 }); return p; };
  const fetchPage = (u, o) => fetchPageText(u, { ...opts(b), connect: conn, ...o });
  const r = await freezeInputs(run, [{ id: 'ticket', path: 'https://x.example/o/r/issues/9' }], { fetchPage, ticketRoles: ['ticket'] });
  assert.equal(r.ok, false);
  assert.match(r.red, /input "ticket".*HTTP 404/);
  assert.equal(existsSync(path.join(run, 'inputs', 'ticket.txt')), false);
});
