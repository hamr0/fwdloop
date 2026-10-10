// M6 piece C (page): the Edit action on a picked signed job. Source-level checks (the real rendering is a browser walk at 1280/390/320).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');

test('every element id in the page is unique (the Edit button, its note and the banner are new)', () => {
  const ids = [...PAGE.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(dup)], []);
  for (const id of ['jf-run-edit', 'jf-run-edit-why', 'jf-edit-banner', 'details-jobfrom']) assert.ok(ids.includes(id), id);
});

test('the card sends editOf with every draft and revise (currentCard is the one reader), and a draft re-attached from disk gets it back', () => {
  assert.match(PAGE, /askWait: askWaitEl\.value\.trim\(\),\s*editOf: editOf/);
  assert.match(PAGE, /if\(c\.editOf && typeof c\.editOf\.flow === "string"\)\{\s*editOf = /);
});

test('Edit fills the boxes from the entry\'s own card; Clear/reset and a signed edit stop editing; the name box stays fixed while editing', () => {
  assert.match(PAGE, /function startEdit\(\)\{[\s\S]*?f\.edit\.card[\s\S]*?setVal\("jf-job", c\.job\)/);
  assert.match(PAGE, /function resetCard\(\)\{[\s\S]*?leaveEdit\(\)/);
  assert.match(PAGE, /if\(editOf !== null\)\{ byId\("jf-name"\)\.readOnly = true/);
  assert.equal((PAGE.match(/leaveEdit\(\); endSession\(\)/g) ?? []).length, 2, 'both signed paths leave the edit');
});

test('a job the card cannot hold shows its reason and the button is off (note from the server, never invented here)', () => {
  assert.match(PAGE, /editWhyEl\.textContent = \(f && f\.edit && f\.edit\.ok === false\) \? f\.edit\.say : ""/);
});
