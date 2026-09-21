// Tests for src/catalogue.js — M1 piece 4 (docs/wiki/the-module-ladder.md,
// "M1 — scope, exit, negative — SIGNED", scope item 5): "the primitive
// catalogue is a data file the validator reads, not code the drafter can
// reach."

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  parseCatalogue, loadCatalogue, menu, primitiveFor, resolveEntry, CATALOGUE_FIELDS,
} from '../src/catalogue.js';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// ---------------------------------------------------------------------------
// The real file
// ---------------------------------------------------------------------------

describe('the real catalogue.json', () => {
  const loaded = loadCatalogue();

  test('loads green', () => {
    assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.reds.join('\n'));
  });

  test('"checkpoint" is NOT among primitives and IS among plumbing', () => {
    assert.ok(!loaded.primitives.some((e) => e.verb === 'checkpoint'));
    assert.ok(loaded.plumbing.some((e) => e.name === 'checkpoint'));
  });

  test('menu with classes:["read"] contains no write/store entry', () => {
    const m = menu(loaded.primitives, { classes: ['read'] });
    assert.ok(m.length > 0);
    assert.ok(m.every((e) => e.class === 'read'));
  });

  test('menu with skills:["core"] omits remember/forget', () => {
    const m = menu(loaded.primitives, { skills: ['core'] });
    assert.ok(!m.some((e) => e.verb === 'remember'));
    assert.ok(!m.some((e) => e.verb === 'forget'));
  });

  test('primitiveFor returns the entry for a known verb, null for an unknown one', () => {
    assert.equal(primitiveFor(loaded.primitives, 'read')?.verb, 'read');
    assert.equal(primitiveFor(loaded.primitives, 'checkpoint'), null);
    assert.equal(primitiveFor(loaded.primitives, 'not-a-real-verb'), null);
  });
});

// ---------------------------------------------------------------------------
// never throws
// ---------------------------------------------------------------------------

test('parseCatalogue never throws on garbage input', () => {
  for (const bad of [undefined, null, 42, 'x', [], true, {}, '{not json']) {
    assert.doesNotThrow(() => parseCatalogue(bad));
  }
});

test('menu/primitiveFor never throw on garbage input', () => {
  assert.doesNotThrow(() => menu(null));
  assert.doesNotThrow(() => menu(undefined, { classes: ['read'] }));
  assert.doesNotThrow(() => primitiveFor(null, 'read'));
  assert.doesNotThrow(() => primitiveFor(undefined, 'read'));
});

// ---------------------------------------------------------------------------
// THE MUTATION SUITE — every CATALOGUE_FIELDS entry, every corruption
// ---------------------------------------------------------------------------

function baseCatalogue() {
  return {
    version: 1,
    primitives: [
      {
        verb: 'read', component: 'select', package: 'bare-agent/tools', symbol: 'createShellTools', tool: 'shell_read', class: 'read', skill: 'core', desc: "Read a file's text.",
      },
      {
        verb: 'write', component: 'write', package: 'bare-agent/tools', symbol: 'createShellTools', tool: 'shell_write', class: 'write', skill: 'core', desc: 'Create or overwrite a file.',
      },
      {
        verb: 'recall', component: 'select', package: 'litectx', symbol: 'LiteCtx', method: 'recall', class: 'read', skill: 'core', desc: 'Search saved notes.',
      },
    ],
    plumbing: [
      { name: 'fence', package: 'bareguard', symbol: 'Gate' },
      { name: 'checkpoint', package: 'bare-agent', symbol: 'Checkpoint' },
    ],
  };
}

function run(cat) {
  return parseCatalogue(JSON.stringify(cat));
}

test('PROOF — the unmutated base catalogue parses green', () => {
  const result = run(baseCatalogue());
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
});

const covered = new Set();

function assertRed(result, needle, label) {
  assert.equal(result.ok, false, `expected a red for ${label}, got green`);
  assert.ok(
    result.reds.some((r) => r.includes(needle)),
    `expected a red containing ${JSON.stringify(needle)} for ${label}, got:\n${result.reds.join('\n')}`,
  );
}

/** field -> { level: 'top'|'primitive'|'plumbing', required, needle, retype(), invalid() } */
const FIELD_META = {
  version: {
    level: 'top', required: true, needle: '"version"', retype: () => '1', invalid: () => 2,
  },
  primitives: {
    level: 'top', required: true, needle: '"primitives"', invalidNeedle: 'primitives', retype: () => ({}), invalid: () => [{}],
  },
  plumbing: {
    level: 'top', required: true, needle: '"plumbing"', invalidNeedle: 'plumbing', retype: () => ({}), invalid: () => [{}],
  },
  verb: {
    level: 'primitive', required: true, needle: 'verb', retype: () => 42, invalid: () => '',
  },
  component: {
    level: 'primitive', required: true, needle: 'component', retype: () => 42, invalid: () => '',
  },
  package: {
    level: 'primitive', required: true, needle: 'package', retype: () => 42, invalid: () => '',
  },
  symbol: {
    level: 'primitive', required: true, needle: 'symbol', retype: () => 42, invalid: () => '',
  },
  method: {
    level: 'primitive', required: false, entryIndex: 2, needle: 'method', retype: () => 42, invalid: () => '',
  },
  tool: {
    level: 'primitive', required: false, entryIndex: 0, needle: 'tool', retype: () => 42, invalid: () => '',
  },
  class: {
    level: 'primitive', required: true, needle: 'class', retype: () => 42, invalid: () => 'bogus-class',
  },
  skill: {
    level: 'primitive', required: true, needle: 'skill', retype: () => 42, invalid: () => '',
  },
  desc: {
    level: 'primitive', required: true, needle: 'desc', retype: () => 42, invalid: () => '',
  },
  name: {
    level: 'plumbing', required: true, needle: 'name', retype: () => 42, invalid: () => '',
  },
};

function applyAt(cat, level, field, value, { remove, entryIndex = 0 } = {}) {
  if (level === 'top') {
    if (remove) delete cat[field];
    else cat[field] = value;
  } else if (level === 'primitive') {
    if (remove) delete cat.primitives[entryIndex][field];
    else cat.primitives[entryIndex][field] = value;
  } else if (level === 'plumbing') {
    if (remove) delete cat.plumbing[entryIndex][field];
    else cat.plumbing[entryIndex][field] = value;
  }
}

describe('mutation suite', () => {
  for (const [field, meta] of Object.entries(FIELD_META)) {
    covered.add(field);

    const entryIndex = meta.entryIndex ?? 0;

    if (meta.required) {
      test(`mutation: ${field} — removed`, () => {
        const cat = baseCatalogue();
        applyAt(cat, meta.level, field, undefined, { remove: true, entryIndex });
        assertRed(run(cat), meta.needle, `${field}/removed`);
      });
    }

    test(`mutation: ${field} — retyped`, () => {
      const cat = baseCatalogue();
      applyAt(cat, meta.level, field, meta.retype(), { entryIndex });
      assertRed(run(cat), meta.needle, `${field}/retyped`);
    });

    test(`mutation: ${field} — invalid value`, () => {
      const cat = baseCatalogue();
      applyAt(cat, meta.level, field, meta.invalid(), { entryIndex });
      assertRed(run(cat), meta.invalidNeedle ?? meta.needle, `${field}/invalid`);
    });

    test(`mutation: ${field} — unknown key added beside it`, () => {
      const cat = baseCatalogue();
      const bogus = `__bogus_beside_${field}__`;
      if (meta.level === 'top') cat[bogus] = true;
      else if (meta.level === 'primitive') cat.primitives[entryIndex][bogus] = true;
      else if (meta.level === 'plumbing') cat.plumbing[entryIndex][bogus] = true;
      assertRed(run(cat), bogus, `${field}/beside`);
    });

    test(`mutation: ${field} — moved to another depth`, () => {
      const cat = baseCatalogue();
      if (field === 'primitives' || field === 'plumbing') {
        const v = cat[field];
        delete cat[field];
        cat[`wrapped_${field}`] = v;
        assertRed(run(cat), `"${field}"`, `${field}/moved`);
        return;
      }
      if (meta.level === 'top') {
        const v = cat[field];
        delete cat[field];
        cat.primitives[0][field] = v;
        assertRed(run(cat), field, `${field}/moved`);
      } else if (meta.level === 'primitive') {
        const v = cat.primitives[entryIndex][field];
        delete cat.primitives[entryIndex][field];
        cat[field] = v;
        assertRed(run(cat), field, `${field}/moved`);
      } else if (meta.level === 'plumbing') {
        const v = cat.plumbing[entryIndex][field];
        delete cat.plumbing[entryIndex][field];
        cat[field] = v;
        assertRed(run(cat), field, `${field}/moved`);
      }
    });
  }

  test('the suite mutates every field the schema defines (CATALOGUE_FIELDS)', () => {
    assert.deepEqual([...covered].sort(), [...CATALOGUE_FIELDS].sort());
  });
});

// ---------------------------------------------------------------------------
// Specific corruptions named in the brief
// ---------------------------------------------------------------------------

describe('specific corruptions', () => {
  test('duplicate verb is a red naming the verb and both indexes', () => {
    const cat = baseCatalogue();
    cat.primitives.push(clone(cat.primitives[0]));
    const result = run(cat);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('verb "read" is duplicated') && r.includes('primitives[0]') && r.includes('primitives[3]')));
  });

  test('both method and tool on one entry is a red', () => {
    const cat = baseCatalogue();
    cat.primitives[0].method = 'someMethod';
    const result = run(cat);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('carries both "method" and "tool"')));
  });

  test('a plumbing name that clashes with a primitive verb is a red', () => {
    const cat = baseCatalogue();
    cat.plumbing.push({ name: 'read', package: 'bare-agent', symbol: 'X' });
    const result = run(cat);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('plumbing name "read" clashes with a primitive verb')));
  });

  test('invalid JSON is a red, never a throw', () => {
    const result = parseCatalogue('{ this is not json');
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('invalid JSON')));
  });

  test('version 2 is a red', () => {
    const cat = baseCatalogue();
    cat.version = 2;
    const result = run(cat);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('"version" must be exactly 1')));
  });
});

// ---------------------------------------------------------------------------
// Resolve test — every entry actually loads
// ---------------------------------------------------------------------------

describe('resolveEntry against the real catalogue', () => {
  const loaded = loadCatalogue();

  test('unresolved verbs are exactly addressCells and readDocx', async () => {
    assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.reds.join('\n'));

    const unresolved = [];
    for (const entry of loaded.primitives) {
      const result = await resolveEntry(entry);
      if (!result.resolved) unresolved.push({ verb: entry.verb, reason: result.reason });
    }
    for (const entry of loaded.plumbing) {
      const result = await resolveEntry(entry);
      if (!result.resolved) unresolved.push({ name: entry.name, reason: result.reason });
    }

    const unresolvedNames = unresolved.map((u) => u.verb ?? u.name).sort();
    assert.deepEqual(
      unresolvedNames,
      ['addressCells', 'readDocx'].sort(),
      `expected only addressCells/readDocx unresolved, got:\n${unresolved.map((u) => `${u.verb ?? u.name}: ${u.reason}`).join('\n')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Integration — real catalogue through validateDeclaration
// ---------------------------------------------------------------------------

describe('integration: the real catalogue through validateDeclaration', () => {
  const loaded = loadCatalogue();

  test('loaded catalogue is green', () => {
    assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.reds.join('\n'));
  });

  test('job #1 validates green against the real catalogue', () => {
    const signed = parseSignedText(fixture('job1.m1.signed.txt'));
    assert.equal(signed.ok, true, signed.ok ? '' : signed.reds.join('\n'));
    const declaration = fixtureJson('job1.m1.declaration.json');
    const result = validateDeclaration(declaration, { arbiter: signed.arbiter, lines: signed.lines, catalogue: loaded.primitives });
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  });

  test('job #2 validates green against the real catalogue', () => {
    const signed = parseSignedText(fixture('job2-with-sources.signed.txt'));
    assert.equal(signed.ok, true, signed.ok ? '' : signed.reds.join('\n'));
    const declaration = fixtureJson('job2.m1.declaration.json');
    const result = validateDeclaration(declaration, { arbiter: signed.arbiter, lines: signed.lines, catalogue: loaded.primitives });
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  });

  test('a step granting "checkpoint" is red against the real catalogue', () => {
    const signed = parseSignedText(fixture('job1.m1.signed.txt'));
    assert.equal(signed.ok, true, signed.ok ? '' : signed.reds.join('\n'));
    const declaration = clone(fixtureJson('job1.m1.declaration.json'));
    // grant "checkpoint" on the first step — checkpoint is absent from the
    // real catalogue's primitives, so it must be unknown-verb red, not a
    // pretend-valid primitive.
    declaration.steps[0].primitives.push('checkpoint');
    const result = validateDeclaration(declaration, { arbiter: signed.arbiter, lines: signed.lines, catalogue: loaded.primitives });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('"checkpoint"') && r.includes('not in the catalogue')));
  });
});

// ---------------------------------------------------------------------------
// No `new RegExp` in this file
// ---------------------------------------------------------------------------

test('no `new RegExp(` in src/catalogue.js', () => {
  const source = readFileSync(path.join(HERE, '..', 'src', 'catalogue.js'), 'utf8');
  assert.ok(!source.includes('new RegExp('));
});
