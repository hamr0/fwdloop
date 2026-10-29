// M12 piece 3 (item 4): the signed label filter is a typed field of the declaration, `ticketFilter: {priority?, labels?}`, valid only on a job that
// lists MCP tools. Red-first: failed before src/declaration.js knew the field.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration, DECLARATION_FIELDS } from '../src/declaration.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = [
  { verb: 'read', skill: 'core', class: 'read' },
  { verb: 'write', skill: 'core', class: 'write' },
  { verb: 'addressCells', skill: 'core', class: 'read' },
  { verb: 'readDocx', skill: 'core', class: 'read' },
  { verb: 'compress', skill: 'core', class: 'derive' },
];
const signed = parseSignedText(fixture('job2-with-sources.signed.txt'));
const validate = (d) => validateDeclaration(d, { arbiter: signed.arbiter, lines: signed.lines, catalogue: CATALOGUE });
const withFilter = (f = { priority: ['P1', 'P2'], labels: ['c: crash'] }) => {
  const d = JSON.parse(fixture('job2.m1.declaration.json'));
  d.mcp = { server: 'github', tools: ['issue_read'] };
  d.steps[0].mcpTools = ['issue_read'];
  d.ticketFilter = f;
  return d;
};
const redsOf = (r) => (r.ok ? [] : r.reds);

test('DECLARATION_FIELDS names ticketFilter', () => assert.ok(DECLARATION_FIELDS.includes('ticketFilter')));
test('a valid filter (priority and labels) is accepted', () => { const r = validate(withFilter()); assert.equal(r.ok, true, redsOf(r).join('\n')); });
test('priority alone, labels alone are accepted', () => {
  assert.equal(validate(withFilter({ priority: ['P2'] })).ok, true);
  assert.equal(validate(withFilter({ labels: ['c: crash', 'network-outage'] })).ok, true);
});

describe('refused, naming the field', () => {
  const bad = [
    ['not an object', () => 'P2', 'ticketFilter'],
    ['empty object', () => ({}), 'ticketFilter'],
    ['unknown key', () => ({ priority: ['P2'], keywords: ['crash'] }), 'keywords'],
    ['priority off the scale', () => ({ priority: ['P7'] }), 'P7'],
    ['priority empty', () => ({ priority: [] }), 'ticketFilter.priority'],
    ['priority twice', () => ({ priority: ['P2', 'P2'] }), 'P2'],
    ['labels blank name', () => ({ labels: [''] }), 'ticketFilter.labels'],
    ['labels not a list', () => ({ labels: 'c: crash' }), 'ticketFilter.labels'],
    ['labels too long', () => ({ labels: ['x'.repeat(101)] }), 'ticketFilter.labels'],
  ];
  for (const [name, make, needle] of bad) {
    test(name, () => {
      const r = validate(withFilter(make()));
      assert.equal(r.ok, false, 'expected a red');
      assert.ok(redsOf(r).some((x) => x.includes(needle)), `want a red naming ${needle}, got:\n${redsOf(r).join('\n')}`);
    });
  }
  test('a filter on a job with no MCP tools', () => {
    const d = JSON.parse(fixture('job2.m1.declaration.json'));
    d.ticketFilter = { priority: ['P2'] };
    const r = validate(d);
    assert.equal(r.ok, false);
    assert.ok(redsOf(r).some((x) => x.includes('ticketFilter') && x.includes('mcp')));
  });
});

// ---- signed M12 item 7: the fields to watch, `ticketWatch: ['state'|'labels']`, valid only with mcp ----
describe('ticketWatch', () => {
  const withWatch = (w) => { const d = withFilter(); d.ticketWatch = w; return d; };
  test('DECLARATION_FIELDS names it; state, labels, or both are accepted', () => {
    assert.ok(DECLARATION_FIELDS.includes('ticketWatch'));
    for (const w of [['state'], ['labels'], ['state', 'labels']]) { const r = validate(withWatch(w)); assert.equal(r.ok, true, redsOf(r).join('\n')); }
  });
  const bad = [
    ['not a list', 'state', 'ticketWatch'],
    ['empty', [], 'ticketWatch'],
    ['a field that is not typed', ['assignee'], 'assignee'],
    ['title is not watchable', ['title'], 'title'],
    ['twice', ['state', 'state'], 'state'],
    ['not a string', [3], 'ticketWatch'],
  ];
  for (const [name, w, needle] of bad) {
    test(`refused: ${name}`, () => {
      const r = validate(withWatch(w));
      assert.equal(r.ok, false);
      assert.ok(redsOf(r).some((x) => x.includes(needle)), redsOf(r).join('\n'));
    });
  }
  test('refused on a job with no MCP tools', () => {
    const d = JSON.parse(fixture('job2.m1.declaration.json'));
    d.ticketWatch = ['state'];
    const r = validate(d);
    assert.equal(r.ok, false);
    assert.ok(redsOf(r).some((x) => x.includes('ticketWatch') && x.includes('mcp')));
  });
});
