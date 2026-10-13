// Shared by the M4d am19 tests.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { keysFilePath } from '../src/keysfile.js';
import { job2Fixture } from './drafter-fixture.mjs';
import { until, tickedConfig } from './m4e-world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
export const FAKE_DRAFT = path.join(HERE, 'fixtures', 'cli-fake-draft-provider.mjs');
export const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-am19-${p}-`));
export const spendRow = (usd) => `${JSON.stringify({ kind: 'draft', model: 'fake-ticked', costUsd: usd, rounds: 1, calls: 1, spendComplete: true })}\n`;
export function newHome(limit) {
  const home = path.join(tmp('home'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), 'DEEPSEEK_API_KEY=sk-am19-fake-0000000000000000000000\n', { mode: 0o600 });
  writeFileSync(path.join(home, 'config.json'), JSON.stringify(tickedConfig({ monthlyLimitUsd: limit })));
  return home;
}
export const cli = (args, home) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT } });
export function proseAt(dir) { const f = path.join(dir, 'prose.txt'); writeFileSync(f, job2Fixture().prose); return f; } // cap $0.25
export const finish = async (w, over = {}) => {
  const id = (await w.post('/api/author/draft', w.card(over))).json().draftId;
  const j = await until(async () => { const v = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(v?.phase) ? v : null; });
  const pid = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8'));
  const { isFwdloopAlive } = await import('../src/liveness.js');
  await until(() => isFwdloopAlive(pid.pid, pid.procStart) !== true);
  return { id, j };
};
