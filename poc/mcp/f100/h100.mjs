import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { freezeInputs } from './src/runner.js';
const dir = mkdtempSync(join(tmpdir(), 'f100-h-'));
const r = await freezeInputs(dir, [{ id: 'issue', path: 'https://github.com/flutter/flutter/issues/100047', ticket: true }]);
const f = join(dir, 'inputs', 'issue.txt');
const t = readFileSync(f, 'utf8');
console.log(JSON.stringify({ ok: r.ok, red: r.red, files: readdirSync(join(dir, 'inputs')), manifest: r.manifest ?? r.entries, sha: createHash('sha256').update(t).digest('hex'), hasSentence: t.replace(/\\r\\n|\s+/g, ' ').includes('Tap the back arrow and the `show bottom sheet` button at the same time'), mcp: readFileSync(join(dir, 'mcp-calls.jsonl'), 'utf8') }, null, 1));
