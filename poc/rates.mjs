// M4d amendment 5: a POC batch harness has no price table either. Its per-round ceiling comes from the rates a test injects, else from
// the model ticked in Settings > Providers with both prices (`resolveUsableModel`); an unusable model refuses by name, at $0.
import { resolveUsableModel, readPriceConfig, MODEL_SLOT } from '../src/provider.js';

/** @param {{ rates?: { in: number, out: number } }|undefined} injected @param {string} [model] */
export function ratesFor(injected, model) {
  if (injected?.rates) return injected.rates;
  const u = resolveUsableModel(MODEL_SLOT, { config: readPriceConfig(), model });
  if (!u.ok) throw new Error(u.say);
  return u.rates;
}
