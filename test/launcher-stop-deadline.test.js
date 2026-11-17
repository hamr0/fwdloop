// borrowed-from: bareloop tests/launcher-stop-deadline.test.js@v0.47.1 (704d598)
// Adapted: fwdloop name/app. Flake fix (fix-ledger): the clock is virtual, not real, so machine load cannot decide the result.
// M4b am5 item 2: stop's wait-until-gone deadline is real clock time: a panel that is still answering, but slowly (close to the probe timeout), makes
// each poll take that long, so counting 100 ms per loop would let `fwdloop stop` wait many times the deadline. (A probe that
// times out reads as "gone", so the slow case that matters is a slow ANSWER, not a hang.)
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { stopCmd } from '../src/launcher.js';

// A virtual clock: src/launcher.js reads `performance.now()` for its deadline, and the injected fetch and sleep are the only things that move it.
// A slow ANSWER costs 350 virtual ms (probe timeout 400), a poll sleep 100. No real waiting, so a loaded machine cannot change the count.
test('stop gives up at the deadline in real time even when every probe answers just under its timeout', async () => {
  let clock = 0;
  const now = mock.method(performance, 'now', () => clock);
  try {
    let probes = 0;
    const fetchImpl = /** @type {typeof fetch} */ (async () => {
      probes++;
      if (probes > 1) clock += 350; // the first whoami answers at once (stop finds the panel); every later one takes 350 ms
      return new Response(JSON.stringify({ app: 'fwdloop', version: '1.0.0', pid: 4242, port: 1, drafts: 0, schedules: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const lines = [];
    const io = { out: (x) => lines.push(x), err: (x) => lines.push(`ERR ${x}`) };
    const rc = await stopCmd(['--yes'], io, {
      home: '/nonexistent-fwdloop-home', root: '/nonexistent-fwdloop-root', ports: [1], timeoutMs: 400, deadlineMs: 500, nodeVersion: '22.1.0', version: '1.0.0',
      fetchImpl,
      sleep: async (ms) => { clock += ms; },
      kill: (_pid, sig) => { if (sig === 0) { const e = new Error('no such process'); /** @type {any} */ (e).code = 'ESRCH'; throw e; } }, // the pid goes at once; the port keeps answering slowly
    });
    assert.equal(rc, 1, lines.join(' / '));
    assert.match(lines.join('\n'), /still answers/);
    // deadline 500: probe (350) + sleep (100) = 450 <= 500, one more probe -> 900 > 500, stop. Plus the first find: 3 probes, 900 virtual ms.
    // The old loop counted 100 ms a turn and would run ~5-6 probes (~2 s virtual).
    assert.ok(clock < 1000, `stop took ${clock} virtual ms; expected about 500 + one probe`);
    assert.ok(probes <= 3, `stop probed ${probes} times; expected 3`);
  } finally {
    now.mock.restore();
  }
});
