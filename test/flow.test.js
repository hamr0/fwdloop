// Tests for src/flow.js — M1 piece 5 (docs/wiki/the-module-ladder.md,
// "M1 — scope, exit, negative — SIGNED", item 7 and item 4): the on-disk
// flow directory. src/flow.js is the ONLY reader and ONLY writer of a flow
// directory; these tests drive it through writeFlow/readFlow only, never
// touching the filesystem shape directly except to corrupt a byte for the
// negative cases.
//
// Every temp directory is created under `fs.mkdtempSync(path.join(os.tmpdir(),
// ...))` and removed in a `finally` / after-each, per the brief — never a
// `flows/` directory inside the repo.

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import {
  readFileSync, writeFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync, readdirSync, statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  checkFlowName, writeFlow, readFlow, FLOW_FILES,
} from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const SIGNED_BY = 'hamr';
const SIGNED_AT = '2026-09-21T12:00:00Z';

function tmpRoot() {
  return mkdtempSync(path.join(tmpdir(), 'fwdloop-flow-test-'));
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hashDir(dir) {
  const out = {};
  for (const f of FLOW_FILES) {
    out[f] = sha256(readFileSync(path.join(dir, f), 'utf8'));
  }
  return out;
}

const JOBS = [
  {
    label: 'job #1 (AR aging)',
    prose: fixture('job1.m1.signed.txt'),
    declaration: JSON.parse(fixture('job1.m1.declaration.json')),
  },
  {
    label: 'job #2 (resume vs JD)',
    prose: fixture('job2-with-sources.signed.txt'),
    declaration: JSON.parse(fixture('job2.m1.declaration.json')),
  },
];

// ---------------------------------------------------------------------------
// checkFlowName
// ---------------------------------------------------------------------------

describe('checkFlowName', () => {
  test('accepts a normal name', () => {
    assert.equal(checkFlowName('ar-aging_v1').ok, true);
  });

  test('accepts a name starting with a digit', () => {
    assert.equal(checkFlowName('1job').ok, true);
  });

  const badNames = [
    ['..', 'parent-directory traversal'],
    ['a/b', 'forward slash'],
    ['a\\b', 'backslash'],
    ['.hidden', 'leading dot'],
    ['', 'empty string'],
    ['/abs', 'absolute path'],
    ['a'.repeat(65), '65-character name'],
    ['Upper', 'uppercase letter'],
  ];

  for (const [name, why] of badNames) {
    test(`rejects ${JSON.stringify(name)} (${why})`, () => {
      const result = checkFlowName(name);
      assert.equal(result.ok, false);
      assert.equal(typeof result.red, 'string');
      assert.ok(result.red.length > 0);
    });
  }
});

// ---------------------------------------------------------------------------
// Round trip, both real jobs
// ---------------------------------------------------------------------------

describe('writeFlow -> readFlow round trip, both real jobs', () => {
  for (const job of JOBS) {
    test(`${job.label}: write then read green`, () => {
      const root = tmpRoot();
      try {
        const written = writeFlow({
          root,
          name: 'flow-a',
          proseText: job.prose,
          declaration: job.declaration,
          signedBy: SIGNED_BY,
          signedAt: SIGNED_AT,
          catalogue: CATALOGUE,
        });
        assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));

        for (const f of FLOW_FILES) {
          const p = path.join(written.dir, f);
          const stat = statSync(p);
          assert.ok(stat.isFile(), `${f} should be a regular file`);
          assert.ok(stat.size > 0, `${f} should be non-empty`);
        }

        const runsDir = path.join(written.dir, 'runs');
        const runsStat = statSync(runsDir);
        assert.ok(runsStat.isDirectory());
        assert.deepEqual(readdirSync(runsDir), []);

        const read = readFlow({ root, name: 'flow-a', catalogue: CATALOGUE });
        assert.equal(read.ok, true, read.ok ? '' : read.reds.join('\n'));
        assert.equal(read.dir, written.dir);
        assert.deepEqual(read.signature, written.signature);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Negative (iii): one byte changed on disk -> readFlow red names the file
// ---------------------------------------------------------------------------

describe('negative (iii): a changed byte on disk is caught, naming the file', () => {
  function writeJob1(root, name = 'flow-a') {
    const written = writeFlow({
      root,
      name,
      proseText: JOBS[0].prose,
      declaration: JOBS[0].declaration,
      signedBy: SIGNED_BY,
      signedAt: SIGNED_AT,
      catalogue: CATALOGUE,
    });
    assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));
    return written;
  }

  test('one byte flipped in prose.txt -> red names prose.txt', () => {
    const root = tmpRoot();
    try {
      const written = writeJob1(root);
      const p = path.join(written.dir, 'prose.txt');
      const text = readFileSync(p, 'utf8');
      writeFileSync(p, `X${text.slice(1)}`, 'utf8');

      const read = readFlow({ root, name: 'flow-a', catalogue: CATALOGUE });
      assert.equal(read.ok, false);
      assert.ok(read.reds.some((r) => r.includes('prose.txt')), read.reds.join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('one byte flipped in declaration.json -> red names declaration.json', () => {
    // Flip one character INSIDE a string value, not the trailing brace/
    // newline, so the file stays valid JSON — this exercises verifyFlow's
    // hash mismatch, not JSON.parse's own syntax check.
    const root = tmpRoot();
    try {
      const written = writeJob1(root);
      const p = path.join(written.dir, 'declaration.json');
      const text = readFileSync(p, 'utf8');
      const marker = 'Customer';
      const idx = text.indexOf(marker);
      assert.ok(idx !== -1, 'fixture no longer contains the expected marker string');
      const flipped = `${text.slice(0, idx)}Xustomer${text.slice(idx + marker.length)}`;
      assert.doesNotThrow(() => JSON.parse(flipped), 'the flip must keep the file syntactically valid JSON');
      writeFileSync(p, flipped, 'utf8');

      const read = readFlow({ root, name: 'flow-a', catalogue: CATALOGUE });
      assert.equal(read.ok, false);
      assert.ok(read.reds.some((r) => r.includes('declaration.json')), read.reds.join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('re-indenting declaration.json stays GREEN (canonical bytes ignore cosmetics)', () => {
    const root = tmpRoot();
    try {
      const written = writeJob1(root);
      const p = path.join(written.dir, 'declaration.json');
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      // Re-serialise with different (but still valid) indentation/order —
      // cosmetic only, no value change.
      writeFileSync(p, JSON.stringify(parsed, null, 4), 'utf8');

      const read = readFlow({ root, name: 'flow-a', catalogue: CATALOGUE });
      assert.equal(read.ok, true, read.ok ? '' : read.reds.join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('converting prose.txt to CRLF stays GREEN (canonical bytes normalise CRLF)', () => {
    const root = tmpRoot();
    try {
      const written = writeJob1(root);
      const p = path.join(written.dir, 'prose.txt');
      const text = readFileSync(p, 'utf8');
      writeFileSync(p, text.replace(/\n/g, '\r\n'), 'utf8');

      const read = readFlow({ root, name: 'flow-a', catalogue: CATALOGUE });
      assert.equal(read.ok, true, read.ok ? '' : read.reds.join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('editing signature.json\'s signedBy after signing -> red naming signature.json', () => {
    const root = tmpRoot();
    try {
      const written = writeJob1(root);
      const p = path.join(written.dir, 'signature.json');
      const sig = JSON.parse(readFileSync(p, 'utf8'));
      sig.signedBy = 'someone-else';
      writeFileSync(p, `${JSON.stringify(sig, null, 2)}\n`, 'utf8');

      const read = readFlow({ root, name: 'flow-a', catalogue: CATALOGUE });
      // signedBy is now one of the four values hashed into `flow`
      // (JSON.stringify([proseHash, declHash, signedBy, signedAt])), so
      // hand-editing it after signing is caught, naming signature.json.
      assert.equal(read.ok, false);
      assert.ok(read.reds.some((r) => r.includes('signature.json')), read.reds.join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Refuse to overwrite an existing signed flow
// ---------------------------------------------------------------------------

describe('writeFlow refuses to overwrite an existing signed flow', () => {
  test('second write to the same name is refused, naming the existing file; originals byte-identical', () => {
    const root = tmpRoot();
    try {
      const first = writeFlow({
        root,
        name: 'flow-a',
        proseText: JOBS[0].prose,
        declaration: JOBS[0].declaration,
        signedBy: SIGNED_BY,
        signedAt: SIGNED_AT,
        catalogue: CATALOGUE,
      });
      assert.equal(first.ok, true, first.ok ? '' : first.reds.join('\n'));
      const before = hashDir(first.dir);

      const second = writeFlow({
        root,
        name: 'flow-a',
        proseText: JOBS[1].prose,
        declaration: JOBS[1].declaration,
        signedBy: SIGNED_BY,
        signedAt: SIGNED_AT,
        catalogue: CATALOGUE,
      });
      assert.equal(second.ok, false);
      assert.ok(second.reds.some((r) => r.includes('already exists')), second.reds.join('\n'));
      assert.ok(FLOW_FILES.some((f) => second.reds.some((r) => r.includes(f))), second.reds.join('\n'));

      const after = hashDir(first.dir);
      assert.deepEqual(after, before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// A failing write writes NOTHING — the directory does not exist afterwards
// ---------------------------------------------------------------------------

describe('a refused write leaves no trace', () => {
  test('a declaration that fails validation writes nothing', () => {
    const root = tmpRoot();
    try {
      const badDeclaration = { ...JOBS[0].declaration, steps: [] };
      const result = writeFlow({
        root,
        name: 'flow-a',
        proseText: JOBS[0].prose,
        declaration: badDeclaration,
        signedBy: SIGNED_BY,
        signedAt: SIGNED_AT,
        catalogue: CATALOGUE,
      });
      assert.equal(result.ok, false);
      assert.equal(existsAsDir(path.join(root, 'flow-a')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a prose that fails parsing writes nothing', () => {
    const root = tmpRoot();
    try {
      const result = writeFlow({
        root,
        name: 'flow-a',
        proseText: 'not signed text at all, no arbiter heading',
        declaration: JOBS[0].declaration,
        signedBy: SIGNED_BY,
        signedAt: SIGNED_AT,
        catalogue: CATALOGUE,
      });
      assert.equal(result.ok, false);
      assert.equal(existsAsDir(path.join(root, 'flow-a')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a missing signedBy writes nothing', () => {
    const root = tmpRoot();
    try {
      const result = writeFlow({
        root,
        name: 'flow-a',
        proseText: JOBS[0].prose,
        declaration: JOBS[0].declaration,
        signedBy: undefined,
        signedAt: SIGNED_AT,
        catalogue: CATALOGUE,
      });
      assert.equal(result.ok, false);
      assert.ok(result.reds.some((r) => r.includes('signedBy')), result.reds.join('\n'));
      assert.equal(existsAsDir(path.join(root, 'flow-a')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function existsAsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Each file missing / empty / invalid JSON -> red naming it
// ---------------------------------------------------------------------------

describe('readFlow: each file missing, empty, or invalid JSON is a red naming it', () => {
  function freshFlow(root) {
    const written = writeFlow({
      root,
      name: 'flow-a',
      proseText: JOBS[0].prose,
      declaration: JOBS[0].declaration,
      signedBy: SIGNED_BY,
      signedAt: SIGNED_AT,
      catalogue: CATALOGUE,
    });
    assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));
    return written;
  }

  for (const f of FLOW_FILES) {
    test(`${f} missing -> red naming it`, () => {
      const root = tmpRoot();
      try {
        const written = freshFlow(root);
        rmSync(path.join(written.dir, f));
        const read = readFlow({ root, name: 'flow-a', catalogue: CATALOGUE });
        assert.equal(read.ok, false);
        assert.ok(read.reds.some((r) => r.includes(f)), read.reds.join('\n'));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test(`${f} empty -> red naming it`, () => {
      const root = tmpRoot();
      try {
        const written = freshFlow(root);
        writeFileSync(path.join(written.dir, f), '', 'utf8');
        const read = readFlow({ root, name: 'flow-a', catalogue: CATALOGUE });
        assert.equal(read.ok, false);
        assert.ok(read.reds.some((r) => r.includes(f)), read.reds.join('\n'));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  for (const f of ['declaration.json', 'signature.json']) {
    test(`invalid JSON in ${f} -> red naming it`, () => {
      const root = tmpRoot();
      try {
        const written = freshFlow(root);
        writeFileSync(path.join(written.dir, f), '{not json', 'utf8');
        const read = readFlow({ root, name: 'flow-a', catalogue: CATALOGUE });
        assert.equal(read.ok, false);
        assert.ok(read.reds.some((r) => r.includes(f)), read.reds.join('\n'));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Symlinks are refused
// ---------------------------------------------------------------------------

describe('symlinks are refused', () => {
  test('a symlinked file inside the flow directory is a red', () => {
    const root = tmpRoot();
    try {
      const written = writeFlow({
        root,
        name: 'flow-a',
        proseText: JOBS[0].prose,
        declaration: JOBS[0].declaration,
        signedBy: SIGNED_BY,
        signedAt: SIGNED_AT,
        catalogue: CATALOGUE,
      });
      assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));

      const realProse = path.join(written.dir, 'prose.txt');
      const elsewhere = path.join(root, 'elsewhere-prose.txt');
      writeFileSync(elsewhere, readFileSync(realProse, 'utf8'), 'utf8');
      rmSync(realProse);
      symlinkSync(elsewhere, realProse);

      const read = readFlow({ root, name: 'flow-a', catalogue: CATALOGUE });
      assert.equal(read.ok, false);
      assert.ok(read.reds.some((r) => r.includes('prose.txt') && r.includes('symlink')), read.reds.join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a symlinked flow directory itself is a red', () => {
    const root = tmpRoot();
    try {
      const written = writeFlow({
        root,
        name: 'flow-a',
        proseText: JOBS[0].prose,
        declaration: JOBS[0].declaration,
        signedBy: SIGNED_BY,
        signedAt: SIGNED_AT,
        catalogue: CATALOGUE,
      });
      assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));

      const linkedRoot = mkdtempSync(path.join(tmpdir(), 'fwdloop-flow-test-linkroot-'));
      const linkPath = path.join(linkedRoot, 'flow-a');
      symlinkSync(written.dir, linkPath);

      const read = readFlow({ root: linkedRoot, name: 'flow-a', catalogue: CATALOGUE });
      assert.equal(read.ok, false);
      assert.ok(read.reds.some((r) => r.includes('symlink')), read.reds.join('\n'));
      rmSync(linkedRoot, { recursive: true, force: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
