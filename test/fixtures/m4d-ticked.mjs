// M4d amendment 5: a model is usable only when ticked in Settings with both prices, so a test that builds a real
// provider needs a config home that says so. `tickedHome()` makes one under a tracked tmp dir and returns its path;
// `withTickedDoor()` also points the process door (FWDLOOP_CONFIG_HOME) at it and returns a restore function.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { configPath } from '../../src/config.js';

export const TICKED_MODEL = 'deepseek-flash';
export const TICKED_LINE = Object.freeze({
  model: TICKED_MODEL, use: true, inPerM: 0.3, outPerM: 1.2, thinkingOff: 'disabled',
});

/** @param {Array<Record<string, any>>} [lines] @param {string} [slot] @param {Record<string, any>} [extra] other config fields */
export const TICKED_SLOT = 'DEEPSEEK_API_KEY';

/** M4d am6: a provider row is a key name, and a row runs only with a Base URL typed (any address; tests repoint the provider at a local server). */
export const TICKED_PROVIDER = Object.freeze({ shape: 'openai-api', baseUrl: 'http://127.0.0.1:9', legacyMaxTokens: true });

export function tickedHome(lines = [TICKED_LINE], slot = TICKED_SLOT, extra = {}) {
  const home = path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-ticked-')), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(configPath(home), JSON.stringify({ models: { [slot]: lines }, providers: { [slot]: TICKED_PROVIDER }, ...extra }));
  return home;
}

/** Point the process door at a ticked home. @returns {() => void} restore */
export function withTickedDoor(lines, slot, extra) {
  const home = tickedHome(lines, slot, extra);
  const saved = process.env.FWDLOOP_CONFIG_HOME;
  process.env.FWDLOOP_CONFIG_HOME = home;
  return () => { if (saved === undefined) delete process.env.FWDLOOP_CONFIG_HOME; else process.env.FWDLOOP_CONFIG_HOME = saved; };
}
