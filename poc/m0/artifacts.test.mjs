import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeArtifact, assertArtifactId, cellRef, ArtifactSpace, unwalkableReads,
} from './artifacts.mjs';
import { gather } from './mechanical.mjs';
import { parseCsv } from './csv.mjs';
import { hashFile } from './close.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = join(__dirname, '..', '..', 'fixtures');

function realCsvArtifact(id = 'a1') {
  return gather(id, join(FIXTURES, 'ar-aging.csv'), 'csv');
}

test('makeArtifact accepts a real gather()-produced csv artifact unchanged', () => {
  const gathered = realCsvArtifact();
  const artifact = makeArtifact('a1', 'csv', gathered);
  assert.equal(artifact.id, 'a1');
  assert.equal(artifact.kind, 'csv');
  assert.ok(artifact.rows.length > 0);
  assert.equal(artifact.sha256, gathered.sha256);
});

test('a malformed artifact is rejected loudly: unknown kind', () => {
  assert.throws(() => makeArtifact('a1', 'xml', { path: 'x' }), /unknown artifact kind "xml"/);
});

test('a malformed artifact is rejected loudly: missing required field', () => {
  assert.throws(
    () => makeArtifact('a1', 'csv', { path: 'x', sha256: 'deadbeef', header: [] }), // no rows
    /missing required field "rows"/,
  );
});

test('a malformed artifact is rejected loudly: bad id', () => {
  assert.throws(() => assertArtifactId(''), /artifact id must be/);
  assert.throws(() => assertArtifactId('has spaces'), /artifact id must be/);
  assert.throws(() => assertArtifactId(42), /artifact id must be/);
  assert.throws(() => makeArtifact('9bad', 'csv', { path: 'x' }), /artifact id must be/);
});

test('a malformed artifact is rejected loudly: non-object payload', () => {
  assert.throws(() => makeArtifact('a1', 'csv', null), /payload must be an object/);
  assert.throws(() => makeArtifact('a1', 'csv', 'nope'), /payload must be an object/);
});

test('derive/compose output kinds are addressable too, once they carry citations', () => {
  const derived = makeArtifact('s3', 'derive', { citations: [{ id: 'c1', value: 5850 }], fields: { total_owed: 'c1' } });
  assert.equal(derived.kind, 'derive');
  const composed = makeArtifact('s4', 'compose', { citations: [], text: 'hello' });
  assert.equal(composed.kind, 'compose');
});

test('PROOF the test can fail: a derive artifact missing "fields" is rejected', () => {
  assert.throws(
    () => makeArtifact('s3', 'derive', { citations: [] }),
    /missing required field "fields"/,
  );
});

test('cellRef resolves {row, col, cell} against the real fixture, matching csv.mjs\'s own shape', () => {
  const artifact = realCsvArtifact();
  const text = readFileSync(join(FIXTURES, 'ar-aging.csv'), 'utf8');
  const { rows } = parseCsv(text);
  const firstDataRow = rows[0];
  const [, firstCol] = Object.entries(firstDataRow.cells)[1]; // B column value
  const ref = cellRef(artifact, `B${firstDataRow.rowNumber}`);
  assert.equal(ref.row, firstDataRow.rowNumber);
  assert.equal(ref.col, 'B');
  assert.equal(ref.cell, `B${firstDataRow.rowNumber}`);
  assert.equal(ref.value, firstCol);
});

test('cellRef throws on a cell that does not exist', () => {
  const artifact = realCsvArtifact();
  assert.throws(() => cellRef(artifact, 'ZZ999'), /does not exist/);
});

test('cellRef throws on a non-csv artifact', () => {
  const textArtifact = gather('t1', join(FIXTURES, 'message.txt'), 'text');
  assert.throws(() => cellRef(textArtifact, 'A1'), /not a csv artifact/);
});

test('ArtifactSpace: a malformed artifact (declare) is rejected — never silently stored', () => {
  const space = new ArtifactSpace();
  assert.throws(() => space.declare({ noId: true }), /not a valid artifact/);
});

test('ArtifactSpace: unknown id lookup throws — never returns undefined', () => {
  const space = new ArtifactSpace();
  assert.throws(() => space.get('ghost'), /unknown artifact id "ghost"/);
});

test('ArtifactSpace: one writer per artifact id — a duplicate declare throws', () => {
  const space = new ArtifactSpace();
  const a = makeArtifact('a1', 'csv', realCsvArtifact());
  space.declare(a);
  assert.throws(() => space.declare(a), /already declared/);
});

test('the artifact-id scheme is stable and referenceable across the chain (M0a validator use case)', () => {
  const space = new ArtifactSpace();
  space.declare(makeArtifact('a1', 'csv', realCsvArtifact('a1')));
  space.declare(makeArtifact('s2', 'derive', { citations: [], fields: {} }));
  // s2 (declared second) reading a1 (declared first) is walkable
  assert.deepEqual(unwalkableReads(space, 's2', ['a1']), []);
});

test('PROOF the test can fail: a step reading an artifact no earlier step declared is caught', () => {
  const space = new ArtifactSpace();
  space.declare(makeArtifact('a1', 'csv', realCsvArtifact('a1')));
  // "a2" was never declared by anyone
  assert.deepEqual(unwalkableReads(space, 'a1', ['a2']), ['a2']);
});

test('unwalkableReads also catches a step reading an artifact declared AFTER it', () => {
  const space = new ArtifactSpace();
  space.declare(makeArtifact('a1', 'csv', realCsvArtifact('a1')));
  space.declare(makeArtifact('s2', 'derive', { citations: [], fields: {} }));
  // a1 (first) "reading" s2 (declared after it) is not walkable
  assert.deepEqual(unwalkableReads(space, 'a1', ['s2']), ['s2']);
});
