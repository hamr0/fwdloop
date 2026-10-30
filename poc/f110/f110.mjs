// F110: run in a child process per case. argv: <case A|B> <tmpdir>. Names only, never values.
import { launcherMain } from '../../src/launcher.js';
import { Readable } from 'node:stream';
const [, , which, tmp] = process.argv;
const out = (s) => process.stdout.write(s + '\n');
const stdin = Readable.from(['y\n']); stdin.isTTY = true;
import { PassThrough } from 'node:stream';
const sink = new PassThrough(); sink.resume();
const code = await launcherMain('update', [], {
  stdin, stdout: sink, stderr: sink, home: tmp,
  launcher: { registryFetch: async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }), version: '0.0.1', fetchImpl: async () => { throw new Error('offline'); } },
});
out(`case ${which}: update exit ${code}`);
// panel child env as startCmd would hand it (recording spawnFn, nothing started)
import { startCmd } from '../../src/launcher.js';
let panelNames = null;
await startCmd({ out() {}, err() {} }, {
  home: tmp, root: tmp + '/root', isTTY: false, deadlineMs: 300, timeoutMs: 100, silentWaitMs: 100, open: () => {}, sleep: async () => {},
  fetchImpl: async () => { throw new Error('offline'); },
  spawnFn: ({ env }) => { panelNames = Object.keys(env); return { once() {}, unref() {} }; },
});
out(`panel spawn env had FAKE_PROVIDER_API_KEY: ${panelNames?.includes('FAKE_PROVIDER_API_KEY')}; FAKE2_PROVIDER_API_KEY: ${panelNames?.includes('FAKE2_PROVIDER_API_KEY')}`);
