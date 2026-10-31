// M13 piece 4, commit 1 (signed item 4): `flowType` is a top-level declaration field (plain | mcp | tickets), hashed with the job. Written red-first.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration, DECLARATION_FIELDS, flowTypeOf } from '../src/declaration.js';
import { canonicalBytes } from '../src/signature.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = [
  { verb: 'read', skill: 'core', class: 'read' }, { verb: 'write', skill: 'core', class: 'write' }, { verb: 'addressCells', skill: 'core', class: 'read' },
  { verb: 'readDocx', skill: 'core', class: 'read' }, { verb: 'compress', skill: 'core', class: 'derive' },
];
const declHash = (text) => createHash('sha256').update(/** @type {any} */ (canonicalBytes('declaration.json', text)).bytes).digest('hex');
const signed = parseSignedText(fixture('job2-with-sources.signed.txt'));
const validate = (d) => validateDeclaration(d, { arbiter: signed.arbiter, lines: signed.lines, catalogue: CATALOGUE });
const base = () => JSON.parse(fixture('job2.m1.declaration.json'));
const redsOf = (r) => (r.ok ? [] : r.reds);
const withMcp = (flowType) => {
  const d = base();
  d.mcp = { server: 'github', tools: ['issue_read', 'list_issues'] };
  if (flowType) d.flowType = flowType;
  return d;
};

describe('4: flowType', () => {
  test('DECLARATION_FIELDS names it, and it is in the signed bytes', () => {
    assert.ok(DECLARATION_FIELDS.includes('flowType'));
    const a = base();
    const b = { ...base(), flowType: 'plain' };
    assert.notEqual(declHash(JSON.stringify(a)), declHash(JSON.stringify(b)));
  });
  test('plain with no mcp, mcp with an mcp block, tickets with an mcp block: valid', () => {
    assert.equal(validate({ ...base(), flowType: 'plain' }).ok, true);
    assert.equal(validate(withMcp('mcp')).ok, true, redsOf(validate(withMcp('mcp'))).join('\n'));
    assert.equal(validate(withMcp('tickets')).ok, true, redsOf(validate(withMcp('tickets'))).join('\n'));
  });
  test('an unknown or non-string flowType is refused by name', () => {
    for (const v of ['chat', '', 7, null]) {
      const r = validate({ ...base(), flowType: v });
      assert.equal(r.ok, false);
      assert.match(redsOf(r).join('\n'), /flowType must be plain, mcp or tickets/);
    }
  });
  test('plain with an mcp block is refused; mcp or tickets without one is refused', () => {
    assert.match(redsOf(validate(withMcp('plain'))).join('\n'), /flowType "plain" takes no "mcp"/);
    for (const t of ['mcp', 'tickets']) assert.match(redsOf(validate({ ...base(), flowType: t })).join('\n'), new RegExp(`flowType "${t}" needs an "mcp" server`));
  });
  test('ticketFilter and ticketWatch belong to tickets only', () => {
    const f = { priority: ['P1'] };
    assert.match(redsOf(validate({ ...withMcp('mcp'), ticketFilter: f })).join('\n'), /"ticketFilter" belongs to a Tickets job/);
    assert.match(redsOf(validate({ ...withMcp('mcp'), ticketWatch: ['state'] })).join('\n'), /"ticketWatch" belongs to a Tickets job/);
    assert.equal(validate({ ...withMcp('tickets'), ticketFilter: f, ticketWatch: ['state'] }).ok, true);
  });
  test('flowTypeOf: the field when present; an old M12 job (mcp, no flowType) is tickets; no mcp is plain', () => {
    assert.equal(flowTypeOf({ flowType: 'mcp', mcp: {} }), 'mcp');
    assert.equal(flowTypeOf(withMcp()), 'tickets');
    assert.equal(flowTypeOf(base()), 'plain');
  });
  test('an old M12 job (mcp, no flowType) still validates', () => {
    const d = withMcp();
    d.ticketFilter = { priority: ['P1'] };
    assert.equal(validate(d).ok, true, redsOf(validate(d)).join('\n'));
  });
});
