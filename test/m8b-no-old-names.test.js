// M8b signed Negative: after the build no file in src/ or bin/ reads run-model.json, thinking.json, inputs.json, calls.jsonl, tools.jsonl, checks.jsonl, cited-checks.json
// or sheet-checks.json, with no exception (M8b am1: the one-time mover was deleted). $0, reads the source.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = /run-model\.json|thinking\.json|inputs\.json|calls\.jsonl|tools\.jsonl|checks\.jsonl|cited-checks\.json|sheet-checks\.json/;

function files(dir) {
  return readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = path.join(dir, n);
    return statSync(path.join(ROOT, rel)).isDirectory() ? files(rel) : [rel];
  });
}

test('no file in src/ or bin/ names an old run-folder file, no exception', () => {
  const hits = [...files('src'), ...files('bin')].filter((f) => OLD.test(readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(hits, []);
});
