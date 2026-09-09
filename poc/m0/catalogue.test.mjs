import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGUE, primitiveFor, menu, FENCE, JOB1_NEEDS, resolveJob1Need,
} from './catalogue.mjs';

test('unknown verb throws — never returns undefined, never defaults', () => {
  assert.throws(() => primitiveFor('teleport'), /unknown primitive verb "teleport"/);
});

test('PROOF the test can fail: a known verb resolves to its real implementation', () => {
  const entry = primitiveFor('read');
  assert.equal(entry.package, 'bare-agent/tools');
  assert.equal(entry.symbol, 'shell_read');
  assert.equal(entry.class, 'read');
  // (deliberately broken + restored below, see report)
});

test('every catalogue entry has the minimum required fields', () => {
  for (const entry of CATALOGUE) {
    assert.equal(typeof entry.verb, 'string');
    assert.equal(typeof entry.component, 'string');
    assert.equal(typeof entry.package, 'string');
    assert.equal(typeof entry.symbol, 'string');
    assert.ok(['read', 'write', 'store'].includes(entry.class), `${entry.verb} has an invalid class "${entry.class}"`);
    assert.equal(typeof entry.skill, 'string');
  }
});

test('negative #5: a read-only menu REMOVES write/store verbs — absence, not refusal', () => {
  const scoutMenu = menu({ classes: ['read'] });
  const verbs = scoutMenu.map((e) => e.verb);
  assert.ok(verbs.length > 0, 'sanity: the read-only menu is not accidentally empty');
  assert.ok(!verbs.includes('write'), 'write-class "write" must be absent from a read-only menu');
  assert.ok(!verbs.includes('checkpoint'), 'write-class "checkpoint" must be absent from a read-only menu');
  assert.ok(!verbs.includes('stash'), 'store-class "stash" must be absent from a read-only menu');
  assert.ok(!verbs.includes('remember'), 'store-class "remember" must be absent from a read-only menu');
  // every remaining entry really is read-class — not just the well-known ones above
  for (const entry of scoutMenu) assert.equal(entry.class, 'read');
});

test('PROOF the test can fail: an unfiltered menu DOES include write/store verbs', () => {
  const fullMenu = menu();
  const verbs = fullMenu.map((e) => e.verb);
  assert.ok(verbs.includes('write'));
  assert.ok(verbs.includes('stash'));
});

test('menu also filters by skill — mail-egress verbs are absent from a core-only menu', () => {
  const coreMenu = menu({ skills: ['core'] });
  const verbs = coreMenu.map((e) => e.verb);
  assert.ok(!verbs.includes('draftMail'));
  assert.ok(!verbs.includes('sendMail'));
});

test('the fence (Gate/redact/wireGate) is plumbing, never a selectable primitive', () => {
  assert.ok(FENCE.length > 0);
  const verbs = menu().map((e) => e.verb);
  for (const f of FENCE) assert.ok(!verbs.includes(f.name), `${f.name} must not appear in any primitive menu`);
  assert.throws(() => primitiveFor('fence'), /unknown primitive verb/);
});

test('every one of job #1\'s needs resolves (F13\'s table)', () => {
  assert.equal(JOB1_NEEDS.length, 8, 'F13 table has 8 rows covering 9 needs');
  for (const row of JOB1_NEEDS) {
    const resolved = resolveJob1Need(row);
    assert.ok(resolved, `need "${row.need}" did not resolve to anything`);
  }
});

test('job #1\'s CSV-addressing need resolves to fwdloop\'s own contract, not a baresuite entry', () => {
  const row = JOB1_NEEDS.find((r) => r.need.includes('addressable cells'));
  const [entry] = resolveJob1Need(row);
  assert.equal(entry.verb, 'addressCells');
  assert.equal(entry.component, 'fwdloop');
  assert.equal(entry.package, 'poc/m0/csv.mjs');
});

test('job #1\'s "match a customer, derive figures" need is fwdloop\'s own machinery, not a catalogue primitive', () => {
  const row = JOB1_NEEDS.find((r) => r.need.startsWith('match a customer'));
  const resolved = resolveJob1Need(row);
  assert.deepEqual(resolved, { own: true });
});

test('PROOF the test can fail: resolveJob1Need throws if a need names a verb the catalogue does not have', () => {
  assert.throws(() => resolveJob1Need({ need: 'bogus', verbs: ['nope-not-real'] }), /unknown primitive verb "nope-not-real"/);
});
