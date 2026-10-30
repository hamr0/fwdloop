// M12 piece 1a (docs/wiki/the-module-ladder.md, "M12 scope (restart)" items 2, 3, 12): the job's typed MCP tools - `mcp: {server, tools}` at the top of the
// declaration, `mcpTools` on the steps that use them - and the preflight that refuses a job tool no step grants, by name, at $0 (F105).
// Written red-first: every test below failed before src/declaration.js and src/canrun.js knew the fields.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration, DECLARATION_FIELDS } from '../src/declaration.js';
import { canonicalBytes } from '../src/signature.js';
import { canFlowRun, findUnusedMcpTool, unusedMcpToolRed } from '../src/canrun.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = [
  { verb: 'read', skill: 'core', class: 'read' },
  { verb: 'write', skill: 'core', class: 'write' },
  { verb: 'addressCells', skill: 'core', class: 'read' },
  { verb: 'readDocx', skill: 'core', class: 'read' },
  { verb: 'compress', skill: 'core', class: 'derive' },
];
const declHash = (text) => createHash('sha256').update(/** @type {any} */ (canonicalBytes('declaration.json', text)).bytes).digest('hex');

const signed = parseSignedText(fixture('job2-with-sources.signed.txt'));
const validate = (d) => validateDeclaration(d, { arbiter: signed.arbiter, lines: signed.lines, catalogue: CATALOGUE });
const base = () => JSON.parse(fixture('job2.m1.declaration.json'));
const withMcp = () => {
  const d = base();
  d.mcp = { server: 'github', tools: ['issue_read'] };
  d.steps[0].mcpTools = ['issue_read'];
  return d;
};
const redsOf = (r) => (r.ok ? [] : r.reds);

describe('1a: the typed field is optional - an old job does not move', () => {
  test('a signed fixture without the field still validates and keeps its exact signature hash', () => {
    assert.equal(validate(base()).ok, true);
    // pinned BEFORE this piece was written; the hash code and the fixture are untouched
    assert.equal(declHash(fixture('job2.m1.declaration.json')), 'de295e8c68bda6d5b1fb2c15850070a8bca8f5c11937453a28d40163c65df522');
  });
  test('the field is in the signed bytes: adding it moves the hash', () => {
    assert.notEqual(declHash(JSON.stringify(withMcp())), declHash(fixture('job2.m1.declaration.json')));
  });
  test('DECLARATION_FIELDS names both new fields', () => {
    assert.ok(DECLARATION_FIELDS.includes('mcp'));
    assert.ok(DECLARATION_FIELDS.includes('mcpTools'));
  });
});

describe('1a: the declaration shape', () => {
  test('server + tools on the job, tools granted on a step: valid', () => {
    const r = validate(withMcp());
    assert.equal(r.ok, true, redsOf(r).join('\n'));
  });
  const bad = [
    ['mcp not an object', (d) => { d.mcp = 'github'; }, '"mcp"'],
    ['mcp.server empty', (d) => { d.mcp.server = ''; }, 'mcp.server'],
    ['mcp.server not a plain name', (d) => { d.mcp.server = 'git hub;rm'; }, 'mcp.server'],
    ['mcp.tools empty', (d) => { d.mcp.tools = []; }, 'mcp.tools'],
    ['mcp.tools has a duplicate', (d) => { d.mcp.tools = ['issue_read', 'issue_read']; }, 'issue_read'],
    ['mcp.tools has a blank name', (d) => { d.mcp.tools = ['']; }, 'mcp.tools'],
    ['mcp has an unknown key', (d) => { d.mcp.allowAll = true; }, 'allowAll'],
    ['a step grants a tool the job does not list', (d) => { d.steps[0].mcpTools = ['issue_write']; }, 'issue_write'],
    ['a step mcpTools is not a list', (d) => { d.steps[0].mcpTools = 'issue_read'; }, 'mcpTools'],
    ['a step grants a tool but the job lists none', (d) => { delete d.mcp; }, 'mcpTools'],
  ];
  for (const [name, mutate, needle] of bad) {
    test(`refused: ${name}`, () => {
      const d = withMcp();
      mutate(d);
      const r = validate(d);
      assert.equal(r.ok, false, 'expected a red');
      assert.ok(redsOf(r).some((x) => x.includes(needle)), `want a red naming ${needle}, got:\n${redsOf(r).join('\n')}`);
    });
  }
});

describe('1a: preflight refuses a job tool no step grants (F105), by name, at $0', () => {
  const step = (mcpTools) => ({ emits: 'ticket_digest', fromLine: 1, primitives: ['read'], close: { class: 'hitl' }, ...(mcpTools ? { mcpTools } : {}) });
  test('a listed tool no step grants: refused, naming it', () => {
    const decl = { steps: [step(['issue_read'])], mcp: { server: 'github', tools: ['issue_read', 'list_issues'] } };
    const found = findUnusedMcpTool(decl);
    assert.deepEqual(found, { tool: 'list_issues', server: 'github' });
    assert.equal(unusedMcpToolRed(found), 'preflight: job tool "list_issues" (server "github") is granted to no step');
    const can = canFlowRun({ ok: true, declaration: decl });
    assert.equal(can.ok, false);
    assert.match(can.red, /list_issues/);
  });
  test('every listed tool granted: fine', () => {
    const decl = { steps: [step(['issue_read'])], mcp: { server: 'github', tools: ['issue_read'] } };
    assert.equal(findUnusedMcpTool(decl), null);
    assert.equal(canFlowRun({ ok: true, declaration: decl }).ok, true);
  });
  test('no mcp field: nothing to refuse (an old job)', () => {
    assert.equal(findUnusedMcpTool({ steps: [step()] }), null);
    assert.equal(canFlowRun({ ok: true, declaration: { steps: [step()] } }).ok, true);
  });
});
