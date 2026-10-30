// M12 piece 1 live check, $0, no model call: read flutter/flutter #100047 through the REAL ~/.mcp.json github server via the real code path
// (freezeInputs -> readTicketMcp), freeze it in a throwaway run folder, print what the run would keep. Never prints a key or token.
// Run: timeout 120 node poc/mcp/m12p1/live.mjs
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { freezeInputs } from '../../../src/runner.js';

const dir = mkdtempSync(join(tmpdir(), 'm12p1-live-'));
try {
  const f = await freezeInputs(dir, [{ id: 'issue', path: 'https://github.com/flutter/flutter/issues', ticket: { number: 100047 } }], { mcp: { server: 'github', tools: ['issue_read'] } });
  if (!f.ok) { console.log('REFUSED:', f.red); process.exitCode = 2; } else {
    const e = f.manifest[0];
    const text = readFileSync(e.frozen, 'utf8');
    console.log('FROZEN ok');
    console.log(JSON.stringify({ id: e.id, source: e.source, bytes: e.bytes, sha256: e.sha256, shaMatches: createHash('sha256').update(readFileSync(e.frozen)).digest('hex') === e.sha256, mcp: e.mcp }, null, 1));
    console.log('body has "Tap the back arrow":', text.includes('Tap the back arrow'));
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
