// M4e amendment 1 made a send never overwrite. The shared fixtures sign `file:poc/m0/out` (the
// real repo folder), and test files run in parallel with the same runIds, so they collided on the
// same `<runId>-<emits>.json`. `sandboxSend(prose)` points a fixture's send at this test process's
// own scratch folder instead (an absolute target, as amendment 1 allows); the folder is emptied
// after every test and removed at the end, so no test leaves litter and none sees another's file.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach } from 'node:test';

export const SEND_DIR = mkdtempSync(join(tmpdir(), 'fwdloop-send-'));
afterEach(() => {
  for (const name of readdirSync(SEND_DIR)) rmSync(join(SEND_DIR, name), { recursive: true, force: true });
});
after(() => rmSync(SEND_DIR, { recursive: true, force: true }));

/** @param {string} prose */
export const sandboxSend = (prose) => prose.replaceAll('file:poc/m0/out', `file:${SEND_DIR}`);
