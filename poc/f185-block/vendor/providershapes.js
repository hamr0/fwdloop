// borrowed-from: bareloop src/providershapes.js@v0.56.0 (3383cce)
// rewritten-from: fwdloop src/providershapes.js@f9449e8
// PANEL-BUILD.md P8 — the API shapes the Settings > Providers dropdown offers, ONE owner.
// A shape is a wire protocol, never a place: no web address lives here (each row's Base URL
// is typed in Settings). Only a shape `makeProvider` (src/providers.js) can really build is listed.
// Kept in its own file so config.js can validate a shape without importing providers.js.

/**
 * `id` is the value saved in config.json (and the signed spec's `provider`).
 * @type {readonly {id: string, label: string}[]}
 */
export const SHAPES = Object.freeze([
  Object.freeze({ id: 'anthropic-api', label: 'Anthropic' }),
  Object.freeze({ id: 'openai-api', label: 'OpenAI-compatible' }),
  Object.freeze({ id: 'gemini-api', label: 'Gemini' }),
]);

/** @type {readonly string[]} */
export const SHAPE_IDS = Object.freeze(SHAPES.map((s) => s.id));
