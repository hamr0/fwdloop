// Tests for src/signature.js — M1 piece: the hash pinning `prose.txt` +
// `declaration.json` (docs/wiki/the-module-ladder.md, "M1 — scope, exit,
// negative — SIGNED", scope item 4, negative iii). Written red-first against
// a stub src/signature.js that returns `{ ok: false, reds: ['stub: not
// implemented'] }` from every function and `[]` from SIGNATURE_FIELDS — so
// the first run below fails on real assertions (result.ok !== true, or the
// covered-field-set mismatch), never on "Cannot find module".
//
// src/ and test/ must not import from poc/ at runtime (CLAUDE.md: "borrow,
// never import" — complete separation between poc/ and src/). The fixtures
// under test/fixtures/ are copies, not references, of the poc/m0 originals.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { signFlow, verifyFlow, canonicalBytes, SIGNATURE_FIELDS } from '../src/signature.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');

const proseText = fixture('job2.signed.txt');
const declarationText = fixture('job2.declaration.json');

const SIGNED_BY = 'hamr';
const SIGNED_AT = '2026-09-21T12:00:00Z';

function baseSignature() {
  const result = signFlow({ proseText, declarationText, signedBy: SIGNED_BY, signedAt: SIGNED_AT });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result.signature;
}

// ---------------------------------------------------------------------------
// canonicalBytes
// ---------------------------------------------------------------------------

describe('canonicalBytes', () => {
  test('prose.txt: CRLF normalised to LF, nothing else changed', () => {
    const lf = 'line one\nline two\n';
    const crlf = 'line one\r\nline two\r\n';
    const a = canonicalBytes('prose.txt', lf);
    const b = canonicalBytes('prose.txt', crlf);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.deepEqual(a.bytes, b.bytes);
    assert.equal(a.bytes.toString('utf8'), lf);
  });

  test('prose.txt: never trims and never Unicode-normalises', () => {
    const withTrailingSpace = 'line one \n';
    const a = canonicalBytes('prose.txt', 'line one\n');
    const b = canonicalBytes('prose.txt', withTrailingSpace);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.notDeepEqual(a.bytes, b.bytes);
  });

  test('declaration.json: key order and indentation do not change the bytes', () => {
    const a = canonicalBytes('declaration.json', '{"b":1,"a":2}');
    const b = canonicalBytes('declaration.json', '{\n  "a": 2,\n  "b": 1\n}');
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.deepEqual(a.bytes, b.bytes);
  });

  test('declaration.json: array order DOES change the bytes', () => {
    const a = canonicalBytes('declaration.json', '{"steps":[1,2]}');
    const b = canonicalBytes('declaration.json', '{"steps":[2,1]}');
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.notDeepEqual(a.bytes, b.bytes);
  });

  test('declaration.json: unparseable JSON is a red, never a throw', () => {
    assert.doesNotThrow(() => canonicalBytes('declaration.json', '{not json'));
    const result = canonicalBytes('declaration.json', '{not json');
    assert.equal(result.ok, false);
    assert.match(result.red, /declaration\.json/);
  });
});

// ---------------------------------------------------------------------------
// signFlow / verifyFlow round trip on the real fixtures
// ---------------------------------------------------------------------------

describe('round trip on real fixtures', () => {
  test('signFlow succeeds and shapes the signature', () => {
    const result = signFlow({ proseText, declarationText, signedBy: SIGNED_BY, signedAt: SIGNED_AT });
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
    assert.equal(result.signature.version, 1);
    assert.equal(result.signature.algorithm, 'sha256');
    assert.match(result.signature.files['prose.txt'], /^[0-9a-f]{64}$/);
    assert.match(result.signature.files['declaration.json'], /^[0-9a-f]{64}$/);
    assert.match(result.signature.flow, /^[0-9a-f]{64}$/);
    assert.equal(result.signature.signedBy, SIGNED_BY);
    assert.equal(result.signature.signedAt, SIGNED_AT);
  });

  test('verifyFlow against its own fresh signature is green (PROOF: base case)', () => {
    const signature = baseSignature();
    const result = verifyFlow({ proseText, declarationText, signature });
    assert.deepEqual(result, { ok: true });
  });

  test('signature and its contents are deep-frozen', () => {
    const signature = baseSignature();
    assert.throws(() => { signature.version = 99; }, TypeError);
    assert.throws(() => { signature.files['prose.txt'] = 'x'; }, TypeError);
  });

  test('signFlow reds on missing signedBy', () => {
    const result = signFlow({ proseText, declarationText, signedBy: '', signedAt: SIGNED_AT });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('field "signedBy"')));
  });

  test('signFlow reds on non-ISO-8601 signedAt', () => {
    const result = signFlow({ proseText, declarationText, signedBy: SIGNED_BY, signedAt: 'yesterday' });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('field "signedAt"')));
  });

  test('signFlow reds (never throws) on unparseable declarationText', () => {
    assert.doesNotThrow(() => signFlow({ proseText, declarationText: '{bad', signedBy: SIGNED_BY, signedAt: SIGNED_AT }));
    const result = signFlow({ proseText, declarationText: '{bad', signedBy: SIGNED_BY, signedAt: SIGNED_AT });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /declaration\.json/.test(r)));
  });

  test('signFlow is pure: same inputs produce the same signature, called twice', () => {
    const a = signFlow({ proseText, declarationText, signedBy: SIGNED_BY, signedAt: SIGNED_AT });
    const b = signFlow({ proseText, declarationText, signedBy: SIGNED_BY, signedAt: SIGNED_AT });
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// Negative iii — ONE-BYTE EDIT tests
// ---------------------------------------------------------------------------

describe('one-byte edit (negative iii)', () => {
  test('one changed character in prose.txt reds naming prose.txt only', () => {
    const signature = baseSignature();
    const editedProse = `X${proseText.slice(1)}`;
    const result = verifyFlow({ proseText: editedProse, declarationText, signature });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('prose.txt')));
    assert.ok(!result.reds.some((r) => r.includes('declaration.json')));
  });

  test('one changed value in declaration.json reds naming declaration.json only', () => {
    const signature = baseSignature();
    const parsed = JSON.parse(declarationText);
    parsed.skills = ['coreX'];
    const editedDeclaration = JSON.stringify(parsed);
    const result = verifyFlow({ proseText, declarationText: editedDeclaration, signature });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('declaration.json')));
    assert.ok(!result.reds.some((r) => r.includes('prose.txt does not match')));
  });

  test('CRLF prose verifies green against an LF-signed signature', () => {
    const signature = baseSignature();
    const crlfProse = proseText.replace(/\n/g, '\r\n');
    const result = verifyFlow({ proseText: crlfProse, declarationText, signature });
    assert.deepEqual(result, { ok: true });
  });

  test('re-indented / key-reordered declaration verifies green', () => {
    const signature = baseSignature();
    const parsed = JSON.parse(declarationText);
    const reordered = {};
    for (const key of Object.keys(parsed).sort().reverse()) reordered[key] = parsed[key];
    const reformatted = JSON.stringify(reordered, null, 4);
    const result = verifyFlow({ proseText, declarationText: reformatted, signature });
    assert.deepEqual(result, { ok: true });
  });

  test('a reordered steps ARRAY is red (order is meaning)', () => {
    const signature = baseSignature();
    const parsed = JSON.parse(declarationText);
    assert.ok(Array.isArray(parsed.steps) && parsed.steps.length > 1, 'fixture must have a multi-element steps array');
    parsed.steps = [...parsed.steps].reverse();
    const result = verifyFlow({ proseText, declarationText: JSON.stringify(parsed), signature });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('declaration.json')));
  });

  test('a trailing space added to a prose line is red (we do not trim)', () => {
    const signature = baseSignature();
    const lines = proseText.split('\n');
    lines[0] = `${lines[0]} `;
    const result = verifyFlow({ proseText: lines.join('\n'), declarationText, signature });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('prose.txt')));
  });
});

// ---------------------------------------------------------------------------
// Structural reds: non-object signature, unknown version/algorithm,
// missing/extra files entries, malformed hex
// ---------------------------------------------------------------------------

describe('structural reds', () => {
  for (const bad of [null, undefined, 'a string', 42, [], true]) {
    test(`verifyFlow reds on a non-object signature (${JSON.stringify(bad)})`, () => {
      const result = verifyFlow({ proseText, declarationText, signature: bad });
      assert.equal(result.ok, false);
      assert.ok(result.reds.length > 0);
    });
  }

  test('unknown version is a red naming "version"', () => {
    const signature = { ...baseSignature(), version: 2 };
    const result = verifyFlow({ proseText, declarationText, signature });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('field "version"')));
  });

  test('unknown algorithm is a red naming "algorithm"', () => {
    const signature = { ...baseSignature(), algorithm: 'md5' };
    const result = verifyFlow({ proseText, declarationText, signature });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('field "algorithm"')));
  });

  test('a missing files entry is a red naming it', () => {
    const base = baseSignature();
    const files = { 'declaration.json': base.files['declaration.json'] };
    const signature = { ...base, files };
    const result = verifyFlow({ proseText, declarationText, signature });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('files.prose.txt')));
  });

  test('an extra files entry is a red naming the unexpected entry', () => {
    const base = baseSignature();
    const files = { ...base.files, 'extra.txt': '0'.repeat(64) };
    const signature = { ...base, files };
    const result = verifyFlow({ proseText, declarationText, signature });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('extra.txt')));
  });

  test('malformed hex in a files entry is a red naming it', () => {
    const base = baseSignature();
    const files = { ...base.files, 'prose.txt': 'not-hex' };
    const signature = { ...base, files };
    const result = verifyFlow({ proseText, declarationText, signature });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('prose.txt')));
  });

  test('a flow hash that does not match the two file hashes reds (hand-edited signature)', () => {
    const base = baseSignature();
    const signature = { ...base, flow: '1'.repeat(64) };
    const result = verifyFlow({ proseText, declarationText, signature });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('field "flow"')));
  });

  test('all reds are collected in one call, never a throw on any bad shape', () => {
    assert.doesNotThrow(() => verifyFlow({ proseText, declarationText, signature: { version: 'x', algorithm: 1, files: null, flow: 1, signedBy: 1, signedAt: 1 } }));
  });
});

// ---------------------------------------------------------------------------
// MUTATION SUITE for signature.json — every field, named red
// ---------------------------------------------------------------------------

const REMOVE = Symbol('remove');

function mutate(field, value) {
  const sig = structuredClone(baseSignature());
  if (field === 'files.prose.txt') {
    if (value === REMOVE) delete sig.files['prose.txt'];
    else sig.files['prose.txt'] = value;
  } else if (field === 'files.declaration.json') {
    if (value === REMOVE) delete sig.files['declaration.json'];
    else sig.files['declaration.json'] = value;
  } else if (value === REMOVE) {
    delete sig[field];
  } else {
    sig[field] = value;
  }
  return sig;
}

/** The needle a mutation's red must contain to count as "naming the field":
 *  the dotted field name for top-level fields, and the short filename for
 *  the two `files.*` fields (a content-hash-mismatch red says "prose.txt",
 *  not "files.prose.txt" — see the literal message format above). */
function needleFor(field) {
  if (field === 'files.prose.txt') return 'prose.txt';
  if (field === 'files.declaration.json') return 'declaration.json';
  return `field "${field}"`;
}

const covered = new Set();

function mutationCase(field, name, value) {
  covered.add(field);
  test(`mutation: ${field} — ${name}`, () => {
    const signature = mutate(field, value);
    const result = verifyFlow({ proseText, declarationText, signature });
    assert.equal(result.ok, false, `expected a red for ${field}/${name}, got green`);
    const needle = needleFor(field);
    assert.ok(
      result.reds.some((r) => r.includes(needle)),
      `expected a red naming "${needle}", got:\n${result.reds.join('\n')}`,
    );
  });
}

describe('mutation suite', () => {
  mutationCase('version', 'removed', REMOVE);
  mutationCase('version', 'retyped number->string', '1');
  mutationCase('version', 'value swapped', 2);

  mutationCase('algorithm', 'removed', REMOVE);
  mutationCase('algorithm', 'retyped string->number', 256);
  mutationCase('algorithm', 'value swapped', 'md5');

  mutationCase('files.prose.txt', 'removed', REMOVE);
  mutationCase('files.prose.txt', 'retyped string->number', 12345);
  mutationCase('files.prose.txt', 'value swapped (valid hex, wrong hash)', '0'.repeat(64));

  mutationCase('files.declaration.json', 'removed', REMOVE);
  mutationCase('files.declaration.json', 'retyped string->number', 12345);
  mutationCase('files.declaration.json', 'value swapped (valid hex, wrong hash)', '1'.repeat(64));

  mutationCase('flow', 'removed', REMOVE);
  mutationCase('flow', 'retyped string->number', 999);
  mutationCase('flow', 'value swapped (valid hex, wrong hash)', 'a'.repeat(64));

  mutationCase('signedBy', 'removed', REMOVE);
  mutationCase('signedBy', 'retyped string->number', 42);
  mutationCase('signedBy', 'value swapped (empty string)', '');

  mutationCase('signedAt', 'removed', REMOVE);
  mutationCase('signedAt', 'retyped string->number', 42);
  mutationCase('signedAt', 'value swapped (not ISO-8601)', 'not-a-date');

  test('PROOF — the unmutated base signature verifies green', () => {
    const signature = baseSignature();
    assert.deepEqual(verifyFlow({ proseText, declarationText, signature }), { ok: true });
  });

  test('the suite mutates every field the signature carries (SIGNATURE_FIELDS)', () => {
    assert.deepEqual([...covered].sort(), [...SIGNATURE_FIELDS].sort());
  });
});
