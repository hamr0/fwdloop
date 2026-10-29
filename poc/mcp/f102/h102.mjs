import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { createHash } from 'node:crypto';
const { freezeInputs } = await import('/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/4bec273e-ed6e-489e-af3a-f8155c50cf10/scratchpad/f100/s/src/runner.js');
const dir = mkdtempSync(join(tmpdir(), 'f102-h-'));
const r = await freezeInputs(dir, [{ id: 'issue', path: 'https://github.com/ColinLeeo/tsfile/issues/5', ticket: true }]);
const t = readFileSync(join(dir, 'inputs', 'issue.txt'), 'utf8');
console.log(JSON.stringify({ ok: r.ok, red: r.red, files: readdirSync(join(dir, 'inputs')), bytes: t.length, sha: createHash('sha256').update(t).digest('hex'), mcp: readFileSync(join(dir, 'mcp-calls.jsonl'), 'utf8') }, null, 1));
console.log('--- frozen text ---'); console.log(t);
