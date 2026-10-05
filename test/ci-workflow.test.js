// M4c-fix item 23 (ci.yml half): a second push to main must not cancel the first push's run, or that commit
// never gets a recorded result. Only a superseded pull_request run may be cancelled.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const yml = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'ci.yml'), 'utf8');

test('ci.yml cancels a superseded run only for a pull_request, never for a push to main', () => {
  const m = /^\s*cancel-in-progress:\s*(.+?)\s*$/m.exec(yml);
  assert.ok(m, 'cancel-in-progress is set');
  assert.notEqual(m[1], 'true', 'a literal true would cancel the first of two quick pushes to main');
  assert.match(m[1], /github\.event_name\s*==\s*'pull_request'/, 'cancelled only when the event is a pull_request');
  assert.match(yml, /push:\s*\n\s*branches:\s*\[main\]/, 'control: the workflow still runs on push to main');
});
