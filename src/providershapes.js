// borrowed-from: bareloop src/providerrows.js@5a5a811 (`SHAPES` only)
// M4d amendment 1 (docs/wiki/the-module-ladder.md, "M4d" Amendment 1): the API shapes the Settings
// Providers dropdown offers. Only a shape `makeProvider` (src/provider.js) can really build is listed:
// bare-agent/providers exports OpenAI, Anthropic and Gemini with the same constructor options we pass
// (`apiKey`, `model`, `baseUrl`, `timeoutMs`, `deadlineMs`). Kept in its own file so config.js can
// validate a shape without importing provider.js (which imports config.js).

/**
 * `id` is the value saved in config.json; `defaultUrl` is the host a blank Base URL means for a slot
 * that has no code default of its own on this shape ('' = bare-agent's own default for that vendor).
 * @type {readonly {id: string, label: string, defaultUrl: string}[]}
 */
export const SHAPES = Object.freeze([
  Object.freeze({ id: 'anthropic-api', label: 'Anthropic', defaultUrl: 'https://api.anthropic.com/v1' }),
  Object.freeze({ id: 'openai-api', label: 'OpenAI-compatible', defaultUrl: 'https://api.openai.com/v1' }),
  Object.freeze({ id: 'gemini-api', label: 'Gemini', defaultUrl: '' }),
]);

export const SHAPE_IDS = Object.freeze(SHAPES.map((s) => s.id));
