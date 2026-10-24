// M8b signed Negative: after the build no file in src/ or bin/ reads run-model.json, thinking.json, inputs.json, calls.jsonl, tools.jsonl, checks.jsonl, cited-checks.json
// or sheet-checks.json - the one module that names them is src/tidy.js, which reads them only to move them (`fwdloop tidy`). $0, reads the source.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = /run-model\.json|thinking\.json|inputs\.json|calls\.jsonl|tools\.jsonl|checks\.jsonl|cited-checks\.json|sheet-checks\.json/;
const MOVER = path.join('src', 'tidy.js');

function files(dir) {
  return readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = path.join(dir, n);
    return statSync(path.join(ROOT, rel)).isDirectory() ? files(rel) : [rel];
  });
}

test('no file in src/ or bin/ names an old run-folder file, except the one that moves them', () => {
  const hits = [...files('src'), ...files('bin')].filter((f) => f !== MOVER && OLD.test(readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(hits, []);
  assert.ok(OLD.test(readFileSync(path.join(ROOT, MOVER), 'utf8')), 'the mover does name them (the test can see them)');
});
