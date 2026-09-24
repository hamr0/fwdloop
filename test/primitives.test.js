// Tests for src/primitives.js — M2 piece 2. $0, real filesystem against
// temp directories only, no network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolvePrimitives, rolePrimitiveFor } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';

const loaded = loadCatalogue();
assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.reds.join('\n'));
const CATALOGUE = loaded.primitives;

function tmpRunDir() {
  return mkdtempSync(path.join(tmpdir(), 'fwdloop-primitives-'));
}

test('menu-is-inventory: a verb not in the catalogue is a red, not a stub, and simply absent from tools', () => {
  const runDir = tmpRunDir();
  const { tools, reds } = resolvePrimitives(CATALOGUE, ['not-a-real-verb'], { runDir });
  assert.equal(tools['not-a-real-verb'], undefined);
  assert.ok(reds.some((r) => /not in the catalogue/.test(r)));
});

test('a catalogue-present but unimplemented verb (e.g. litectx\'s "compress") reds naming the gap, other verbs still resolve', () => {
  const runDir = tmpRunDir();
  const { tools, reds } = resolvePrimitives(CATALOGUE, ['compress', 'read'], { runDir });
  assert.equal(tools.compress, undefined);
  assert.ok(tools.read);
  assert.ok(reds.some((r) => /"compress".*no M2 implementation/.test(r)));
});

test('read: a path inside the run dir succeeds', async () => {
  const runDir = tmpRunDir();
  writeFileSync(path.join(runDir, 'note.txt'), 'hello');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], { runDir });
  const text = await tools.read.execute({ path: path.join(runDir, 'note.txt') });
  assert.match(text, /hello/);
});

test('read: a path outside the sandbox (run dir + frozen inputs) reds naming the path, never silently reads it', async () => {
  const runDir = tmpRunDir();
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-outside-'));
  const outsidePath = path.join(outsideDir, 'secret.txt');
  writeFileSync(outsidePath, 'should never be read');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], { runDir });
  await assert.rejects(
    () => tools.read.execute({ path: outsidePath }),
    (err) => {
      assert.match(err.message, /outside the sandbox/);
      assert.ok(err.message.includes(outsidePath), 'the red must name the refused path');
      return true;
    },
  );
});

test('read: a frozen input path (outside the run dir, inside its own inputs dir) is allowed', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-inputs-'));
  const framePath = path.join(inputsDir, 'resume.txt');
  writeFileSync(framePath, 'resume text');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'resume', frozen: framePath }],
  });
  const text = await tools.read.execute({ path: framePath });
  assert.match(text, /resume text/);
});

test('write: a path outside the run dir reds, never writes', async () => {
  const runDir = tmpRunDir();
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-outside-write-'));
  const outsidePath = path.join(outsideDir, 'should-not-exist.txt');
  const { tools } = resolvePrimitives(CATALOGUE, ['write'], { runDir });
  await assert.rejects(() => tools.write.execute({ path: outsidePath, content: 'x' }), /outside the sandbox/);
});

test('write: a path inside the run dir succeeds', async () => {
  const runDir = tmpRunDir();
  const { tools } = resolvePrimitives(CATALOGUE, ['write'], { runDir });
  const target = path.join(runDir, 'out.txt');
  await tools.write.execute({ path: target, content: 'written' });
  assert.equal(readFileSync(target, 'utf8'), 'written');
});

test('readDocx: reads a small real .docx fixture by role, never a raw path', async () => {
  const runDir = tmpRunDir();
  const fixturePath = path.join(process.cwd(), 'test', 'fixtures');
  mkdirSync(fixturePath, { recursive: true });
  // Reuse the repo's own small real .docx fixture if one exists under poc/m0/fixtures; else skip
  // gracefully — this test only proves the role-lookup wiring, not the docx byte parser itself
  // (that parser is src/docx.js's own borrowed logic, unchanged from the POC).
  const candidateDirs = [
    path.join(process.cwd(), 'poc', 'm0', 'fixtures'),
    path.join(process.cwd(), 'poc', 'm0', 'out'),
  ];
  let docxPath = null;
  for (const dir of candidateDirs) {
    try {
      const entries = readdirSync(dir);
      const found = entries.find((f) => f.endsWith('.docx'));
      if (found) { docxPath = path.join(dir, found); break; }
    } catch { /* dir may not exist */ }
  }
  if (!docxPath) {
    // No real .docx fixture is checked in — prove the role-not-found red instead, which is this
    // wiring's own responsibility regardless of parser content.
    const { tools } = resolvePrimitives(CATALOGUE, ['readDocx'], { runDir, inputs: [] });
    await assert.rejects(() => tools.readDocx.execute({ role: 'resume' }), /no frozen input for role "resume"/);
    return;
  }
  const { tools } = resolvePrimitives(CATALOGUE, ['readDocx'], {
    runDir, inputs: [{ id: 'resume', frozen: docxPath }],
  });
  const result = await tools.readDocx.execute({ role: 'resume' });
  assert.equal(typeof result.text, 'string');
  assert.ok(result.text.length > 0);
});

test('addressCells: reads a small CSV fixture as addressable cells, by role', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-csv-'));
  const csvPath = path.join(inputsDir, 'aging.csv');
  writeFileSync(csvPath, 'Customer,Amount\nAcme Corp,150.00\n');
  const { tools } = resolvePrimitives(CATALOGUE, ['addressCells'], {
    runDir, inputs: [{ id: 'aging', frozen: csvPath }],
  });
  const result = await tools.addressCells.execute({ role: 'aging' });
  assert.equal(result.kind, 'cells');
  assert.deepEqual(result.header, ['Customer', 'Amount']);
  assert.equal(result.rows[0].cells.A, 'Acme Corp');
  assert.equal(result.rows[0].cells.B, '150.00');
});

test('addressCells: an unknown role reds naming the role and the available ones', async () => {
  const runDir = tmpRunDir();
  const { tools } = resolvePrimitives(CATALOGUE, ['addressCells'], { runDir, inputs: [] });
  await assert.rejects(() => tools.addressCells.execute({ role: 'nope' }), /no frozen input for role "nope"/);
});

// ---------------------------------------------------------------------------
// Item 1: text sources (`read`/`grep`) are readable by role, not just by
// sandboxed path — the live gap the job #2 run hit (jd-text granted `read`
// but the executor context carries no paths to try).
// ---------------------------------------------------------------------------

test('read: by role returns the frozen file\'s text', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-'));
  const jdPath = path.join(inputsDir, 'jd.md');
  writeFileSync(jdPath, 'job description text');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'jd', frozen: jdPath }],
  });
  const text = await tools.read.execute({ role: 'jd' });
  assert.match(text, /job description text/);
});

test('read: an unknown role reds naming the role and the available ones', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-'));
  const jdPath = path.join(inputsDir, 'jd.md');
  writeFileSync(jdPath, 'text');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'jd', frozen: jdPath }],
  });
  await assert.rejects(() => tools.read.execute({ role: 'nope' }), /no frozen input for role "nope" \(available: jd\)/);
});

test('read: a path outside the sandbox still reds even when roles are available', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-'));
  const jdPath = path.join(inputsDir, 'jd.md');
  writeFileSync(jdPath, 'text');
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-outside-role-'));
  const outsidePath = path.join(outsideDir, 'secret.txt');
  writeFileSync(outsidePath, 'nope');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'jd', frozen: jdPath }],
  });
  await assert.rejects(() => tools.read.execute({ path: outsidePath }), /outside the sandbox/);
});

test('read: role wins when both path and role are given', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-'));
  const jdPath = path.join(inputsDir, 'jd.md');
  writeFileSync(jdPath, 'the role content');
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-outside-both-'));
  const outsidePath = path.join(outsideDir, 'ignored.txt');
  writeFileSync(outsidePath, 'must never be read');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'jd', frozen: jdPath }],
  });
  const text = await tools.read.execute({ path: outsidePath, role: 'jd' });
  assert.match(text, /the role content/);
});

test('read/grep: the tool description and role enum name only TEXT roles — a .docx role is not offered (F41 item 3)', () => {
  const runDir = tmpRunDir();
  const { tools } = resolvePrimitives(CATALOGUE, ['read', 'grep'], {
    runDir, inputs: [{ id: 'resume', frozen: '/x/resume.docx' }, { id: 'jd', frozen: '/x/jd.md' }],
  });
  assert.match(tools.read.description, /Available roles: jd\b/);
  assert.doesNotMatch(tools.read.description, /resume/);
  assert.match(tools.grep.description, /Available roles: jd\b/);
  assert.doesNotMatch(tools.grep.description, /resume/);
  assert.ok(tools.read.parameters.properties.role);
  assert.deepEqual(tools.read.parameters.properties.role.enum, ['jd']);
  assert.deepEqual(tools.grep.parameters.properties.role.enum, ['jd']);
});

test('rolePrimitiveFor: maps frozen path extension to the primitive that owns its text', () => {
  assert.equal(rolePrimitiveFor('/x/jd.md'), 'read');
  assert.equal(rolePrimitiveFor('/x/notes.txt'), 'read');
  assert.equal(rolePrimitiveFor('/x/resume.docx'), 'readDocx');
  assert.equal(rolePrimitiveFor('/x/aging.csv'), 'addressCells');
  assert.equal(rolePrimitiveFor('/x/scan.pdf'), null);
});

test('read: a .docx role is refused BY NAME naming readDocx, never returning file bytes', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-docx-'));
  const resumePath = path.join(inputsDir, 'resume.docx');
  writeFileSync(resumePath, 'PK\x03\x04 fake zip bytes that must never come back as text');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'resume', frozen: resumePath }],
  });
  await assert.rejects(
    () => tools.read.execute({ role: 'resume' }),
    /read: role "resume" is a \.docx — use readDocx/,
  );
});

test('grep: a .csv role is refused BY NAME naming addressCells', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-csv-'));
  const sheetPath = path.join(inputsDir, 'sheet.csv');
  writeFileSync(sheetPath, 'a,b\n1,2\n');
  const { tools } = resolvePrimitives(CATALOGUE, ['grep'], {
    runDir, inputs: [{ id: 'sheet', frozen: sheetPath }],
  });
  await assert.rejects(
    () => tools.grep.execute({ pattern: 'x', role: 'sheet' }),
    /grep: role "sheet" is a \.csv — use addressCells/,
  );
});

test('read: an unknown-extension role is refused naming "no text primitive serves it", not silently read', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-pdf-'));
  const pdfPath = path.join(inputsDir, 'scan.pdf');
  writeFileSync(pdfPath, '%PDF-1.4 fake');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'scan', frozen: pdfPath }],
  });
  await assert.rejects(
    () => tools.read.execute({ role: 'scan' }),
    /read: role "scan" is a \.pdf — no text primitive serves it/,
  );
});

test('read: this refusal fires even when the model passes a role never offered in the schema\'s enum (defence beyond the schema)', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-defence-'));
  const resumePath = path.join(inputsDir, 'resume.docx');
  writeFileSync(resumePath, 'zip bytes');
  const jdPath = path.join(inputsDir, 'jd.md');
  writeFileSync(jdPath, 'jd text');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'resume', frozen: resumePath }, { id: 'jd', frozen: jdPath }],
  });
  // The schema's enum offers only "jd" — "resume" is not in it — yet the refusal
  // must still fire by name, not fall through to "no frozen input for role".
  assert.deepEqual(tools.read.parameters.properties.role.enum, ['jd']);
  await assert.rejects(
    () => tools.read.execute({ role: 'resume' }),
    /read: role "resume" is a \.docx — use readDocx/,
  );
});

test('read: still works by role for a text (.md) input alongside a .docx input', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-mixed-'));
  const resumePath = path.join(inputsDir, 'resume.docx');
  writeFileSync(resumePath, 'zip bytes');
  const jdPath = path.join(inputsDir, 'jd.md');
  writeFileSync(jdPath, 'the real jd text');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'resume', frozen: resumePath }, { id: 'jd', frozen: jdPath }],
  });
  const text = await tools.read.execute({ role: 'jd' });
  assert.match(text, /the real jd text/);
});

test('read: with only a .docx input, the description says "(none)" and there is no role property, but path still works', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-noneleft-'));
  const resumePath = path.join(inputsDir, 'resume.docx');
  writeFileSync(resumePath, 'zip bytes');
  const { tools } = resolvePrimitives(CATALOGUE, ['read'], {
    runDir, inputs: [{ id: 'resume', frozen: resumePath }],
  });
  assert.match(tools.read.description, /Available roles: \(none\)/);
  assert.equal(tools.read.parameters.properties.role, undefined);
  // path route is untouched: a plain text file in the run dir still reads fine.
  writeFileSync(path.join(runDir, 'note.txt'), 'plain text');
  const text = await tools.read.execute({ path: path.join(runDir, 'note.txt') });
  assert.match(text, /plain text/);
});

test('grep: by role searches the frozen file\'s text', async () => {
  const runDir = tmpRunDir();
  const inputsDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-role-grep-'));
  const jdPath = path.join(inputsDir, 'jd.md');
  writeFileSync(jdPath, 'requirements: five years experience\nlocation: remote');
  const { tools } = resolvePrimitives(CATALOGUE, ['grep'], {
    runDir, inputs: [{ id: 'jd', frozen: jdPath }],
  });
  const result = await tools.grep.execute({ pattern: 'remote', role: 'jd' });
  assert.match(JSON.stringify(result), /remote/);
});
