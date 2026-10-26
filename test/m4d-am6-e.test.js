// M4d amendment 6, "Done when": a search of src/ (and bin/) finds no provider name, model name, web address or price.
// Providers, models, prices and addresses live in Settings only. What the search lets through is listed below, each with its reason; a hit anywhere
// else fails. The test can fail: it is run against the whole tree, comments included (a comment naming a vendor is a hit too).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// What is searched for. A provider is a company or hosted service; a model is a vendor's name for one; a price is a per-token number; an address is a web URL.
const PROVIDER_NAMES = /deepseek|synthetic\.new|\bsynthetic\b|anthropic|openai|gemini|claude|\bgpt\b|moonshot|kimi|qwen|mistral|groq|openrouter|cohere|together\.ai|perplexity|\bxai\b|llama|\bglm\b|nemotron|mixtral|\bgoogle/i;
const MODEL_NAMES = /deepseek-(flash|v\d|chat|reasoner|pro)|gpt-\d|gpt-oss|claude-\d|claude-(opus|sonnet|haiku)|gemini-\d|llama-?\d|qwen\d?|glm-\d|kimi-k|\bsyn:|\bhf:/i;
const ADDRESSES = /https?:\/\/[^\s'"`)>]+/i;
const PRICES = /\b0\.000\d+\b|\b(?:inPerM|outPerM|cachedInPerM)\s*[:=]\s*[1-9]\d*(?:\.\d+)?\b|RATES_BY_SUFFIX|CEILING_TABLE_USD|defaultModel/;

// The allow-list. A shape is a wire protocol (the three classes bare-agent/providers exports), not a provider's identity; its id and label say which protocol.
const ALLOWED = [
  {
    file: 'src/providershapes.js',
    re: /anthropic-api|openai-api|gemini-api|'Anthropic'|'OpenAI-compatible'|'Gemini'|\bAnthropic\b|\bOpenAI\b|\bGemini\b/gi,
    why: 'the API shapes: ids saved in config.json and labels in the Settings dropdown. A shape names a wire protocol, not a vendor address or a model.',
  },
  {
    file: 'src/provider.js',
    re: /anthropic-api|openai-api|gemini-api|MalformedToolCallTolerantOpenAI|\bOpenAI\b|\bAnthropic\b|\bGemini\b/g,
    why: 'the three client classes bare-agent/providers exports, chosen by shape id, and our wrapper class around the OpenAI-protocol one. Class names, not providers.',
  },
  {
    file: 'src/panel/settings.js',
    re: /anthropic-api|gemini-api|anthropic-version/g,
    why: 'the header each protocol expects the key in (x-api-key + anthropic-version, x-goog-api-key), and how each lists its models. Shape ids and protocol header names only.',
  },
  {
    file: 'src/thinking.js',
    re: /anthropic-api|openai-api|gemini-api|'anthropic'|'openai'|'gemini'/g,
    why: 'the map from our shape id to bareagent\'s own provider kind (the first argument of its thinkingSupport lookup). Vocabulary of the library, not a vendor address or model.',
  },
  {
    file: 'src/panel/index.html',
    re: /https:\/\/fonts\.(googleapis|gstatic)\.com[^\s'"]*|fonts\.(googleapis|gstatic)\.com|\bGoogle Fonts\b|https:\/\/fonts[^\s'"]*/g,
    why: 'the page font stylesheet host (not a model provider; no key or request body ever goes there).',
  },
  {
    file: 'src/panel/server.js',
    re: /http:\/\/(127\.0\.0\.1|localhost)[^\s'"`)]*/g,
    why: 'the panel\'s own loopback address (its Origin check and the line it prints). Not a provider.',
  },
  {
    file: 'src/registry.js',
    re: /https:\/\/registry\.npmjs\.org\/fwdloop\/latest/g,
    why: 'the npm registry address `fwdloop update` reads the latest version from (M4b am8, signed 2026-10-26), only when the human presses update. Not a provider; no key or request body goes there.',
  },
  {
    file: 'bin/fwdloop',
    re: /http:\/\/127\.0\.0\.1:<port>\/?/g,
    why: 'a comment quoting the line `fwdloop panel` prints: the panel\'s own loopback address, with no port. Not a provider.',
  },
  {
    file: 'src/panel/settings.js',
    re: /http:\/\/|https:\/\//g,
    why: 'the hint that a Base URL must start with http:// or https:// (the shape of an address, not an address)',
  },
  {
    file: 'src/config.js',
    re: /http\(s\):\/\/…?|http\(s\) address/g,
    why: 'the same hint in config validation (the shape of an address, not an address)',
  },
];

function hits() {
  const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'bin', 'fwdloop')].filter((f) => /\.(js|mjs|html|json)$/.test(f) || path.basename(f) === 'fwdloop');
  const out = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const allowed = ALLOWED.filter((a) => a.file === rel);
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      let rest = line.replace(/CLAUDE\.md/g, ' '); // the name of this project's instruction file, not a provider
      for (const a of allowed) rest = rest.replace(a.re, ' ');
      for (const [kind, re] of [['provider name', PROVIDER_NAMES], ['model name', MODEL_NAMES], ['web address', ADDRESSES], ['price', PRICES]]) {
        const m = re.exec(rest);
        if (m) out.push(`${rel}:${i + 1} ${kind} "${m[0]}" :: ${line.trim().slice(0, 110)}`);
      }
    });
  }
  return out;
}

test('E1: src/ and bin/ hold no provider name, model name, web address or price - except the listed shape names and the page font host', () => {
  assert.deepEqual(hits(), []);
});

test('E2: the test can fail - a planted provider name, model name, address and price are each found', () => {
  for (const [re, text] of [
    [PROVIDER_NAMES, 'const host = "api.deepseek.example"'], [MODEL_NAMES, "const m = 'gpt-4o'"], [ADDRESSES, "const u = 'https://api.example.com/v1'"], [PRICES, 'const r = { inPerM: 3 }'],
  ]) assert.ok(re.test(text), text);
});

test('E3: every allow-list entry names a file that exists and is used (a stale entry would hide a future hit)', () => {
  for (const a of ALLOWED) {
    const text = readFileSync(path.join(ROOT, a.file), 'utf8');
    assert.ok(new RegExp(a.re.source, a.re.flags).test(text), `${a.file} has nothing the allow-list entry for it lets through: remove the entry`);
    assert.ok(a.why.length > 20);
  }
});
