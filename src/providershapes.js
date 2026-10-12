// borrowed-from: bareloop src/providerrows.js@5a5a811 (`SHAPES` only)
// M4d amendments 1 and 6 (docs/wiki/the-module-ladder.md, "M4d"): the API shapes the Settings
// Providers dropdown offers. Only a shape `makeProvider` (src/provider.js) can really build is listed:
// bare-agent/providers exports OpenAI, Anthropic and Gemini with the same constructor options we pass
// (`apiKey`, `model`, `baseUrl`, `timeoutMs`, `deadlineMs`). Kept in its own file so config.js can
// validate a shape without importing provider.js (which imports config.js).

/**
 * `id` is the value saved in config.json. A shape is a wire protocol, never a place: no web address lives here
 * (M4d amendment 6 item 2) - each row's Base URL is typed in Settings.
 * @type {readonly {id: string, label: string}[]}
 */
export const SHAPES = Object.freeze([
  Object.freeze({ id: 'anthropic-api', label: 'Anthropic' }),
  Object.freeze({ id: 'openai-api', label: 'OpenAI-compatible' }),
  Object.freeze({ id: 'gemini-api', label: 'Gemini' }),
]);

export const SHAPE_IDS = Object.freeze(SHAPES.map((s) => s.id));
