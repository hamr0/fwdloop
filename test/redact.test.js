// borrowed-from: bareloop tests/validate.test.js@76168c8 (the after-hyphen tests), adapted to redactSecrets only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../src/redact.js';

// Fixtures built by concatenation (no key-shaped literal in source).
const AFTER_HYPHEN = {
  'ghp_': 'ghp_' + 'A'.repeat(24),
  'github_pat_': 'github_pat_' + 'A'.repeat(24),
  'AKIA': 'AKIA' + 'A'.repeat(16),
  'AIza': 'AIza' + 'A'.repeat(35),
  'xox': 'xoxb-' + '1'.repeat(12),
};

for (const [name, key] of Object.entries(AFTER_HYPHEN)) {
  test(`a bare ${name} key is masked`, () => {
    const scrubbed = redactSecrets(`deploy ${key} done`);
    assert.ok(!scrubbed.includes(key));
    assert.match(scrubbed, /^deploy \[REDACTED:/);
  });

  test(`a ${name} key right after a hyphen is masked`, () => {
    const raw = `deploy step-${key} done`;
    const scrubbed = redactSecrets(raw);
    assert.notEqual(scrubbed, raw);
    assert.ok(!scrubbed.includes(key), 'the key does not survive the redactor');
    assert.match(scrubbed, /^deploy step-\[REDACTED:/, 'the word and hyphen before the key are kept');
  });

  test(`a ${name} key glued onto a word character or an underscore is still not masked`, () => {
    assert.equal(redactSecrets(`x${key}`), `x${key}`);
    assert.equal(redactSecrets(`step_${key}`), `step_${key}`);
  });
}

test('hyphenated ordinary words are never masked', () => {
  const benign = 'pip install flask-sqlalchemy; dump-gh_token; my-AKIA-note; the-xox-club; some-AIza; step-github_pat';
  assert.equal(redactSecrets(benign), benign);
});
