// M20 am3e item 18: redraft-<n>.json has one reader; a `rowEdit` that is not an object is read as none everywhere (named change).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createAuthor } from '../src/panel/author.js';

const ID = 'd-0000000001-abcd';
function session(rowEdit) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am3e18-'));
  const dir = path.join(root, '.drafts', ID);
  mkdirSync(path.join(dir, 'draft'), { recursive: true });
  mkdirSync(path.join(dir, 'draft-1'), { recursive: true });
  writeFileSync(path.join(dir, 'card.json'), JSON.stringify({ flowName: 'job2', job: 'Read my resume' }));
  writeFileSync(path.join(dir, 'card-1.json'), JSON.stringify({ flowName: 'job2', job: 'Read my resume' }));
  writeFileSync(path.join(dir, 'draft', 'log.json'), JSON.stringify({ ok: true }));
  writeFileSync(path.join(dir, 'draft', 'spec.hash'), 'abc\n');
  writeFileSync(path.join(dir, 'draft-1', 'log.json'), JSON.stringify({ ok: false, reds: [] }));
  writeFileSync(path.join(dir, 'redraft-1.json'), JSON.stringify({ fromPlan: 'draft', answers: [], rowEdit }));
  return root;
}
const nameOf = (rowEdit) => {
  const root = session(rowEdit);
  try {
    const author = createAuthor({ root, skipMonthly: true, loadEnv: () => ({ ok: true, env: {}, refusal: null }), childRunning: () => false });
    return author.get(ID).body.revises?.[0]?.name;
  } finally { rmSync(root, { recursive: true, force: true }); }
};

test('am3e item 18: a rowEdit object names the plan "a check added"/"a check dropped"; one that is not an object is none: "drafted again with your answers"', () => {
  assert.equal(nameOf({ op: 'add', key: 'k', at: 'x', asks: true }), 'a check added');
  assert.equal(nameOf({ op: 'drop', key: 'k', at: 'x', asks: true }), 'a check dropped');
  assert.equal(nameOf('a string'), 'drafted again with your answers', 'a truthy rowEdit that is not an object is none');
  assert.equal(nameOf([1]), 'drafted again with your answers');
});
