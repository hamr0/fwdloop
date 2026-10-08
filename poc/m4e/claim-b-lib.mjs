import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { childEnv, sleep, readJson } from './common.mjs';
import { HERE } from './common.mjs';

/** Start a mini-panel; resolves {panel, pid} once the child was spawned. Panel env = scratch env + extras. */
export async function startPanel(s, cfg, extraEnv = {}) {
  const panel = spawn(process.execPath, [join(HERE, 'mini-panel.mjs'), JSON.stringify(cfg)], {
    env: childEnv(s, extraEnv), stdio: ['ignore', 'pipe', 'inherit'],
  });
  const pid = await new Promise((res, rej) => {
    panel.stdout.on('data', (b) => { const m = /SPAWNED (\d+)/.exec(String(b)); if (m) res(Number(m[1])); });
    panel.once('exit', (c) => rej(new Error(`panel exited ${c} before spawning`)));
  });
  return { panel, pid };
}
export const kill = (pid, sig) => { try { process.kill(pid, sig); return true; } catch { return false; } };
export function ppidpgid(pid) {
  try {
    const st = readFileSync(`/proc/${pid}/stat`, 'utf8'); const a = st.slice(st.lastIndexOf(')') + 2).split(' ');
    return { state: a[0], ppid: Number(a[1]), pgid: Number(a[2]), sid: Number(a[3]) };
  } catch { return null; }
}
export async function waitFor(fn, ms = 40_000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(step); }
  return null;
}
export { readJson, existsSync, join };
