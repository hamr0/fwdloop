// F148 (pre-registered in docs/logs/FINDINGS.md): M10 am20, $0, no src/ change, no provider, no key. READ ONLY on the draft dir.
// Run: node poc/m10-am20/startover-carry.mjs [draftDir]    BREAK=1 node ... shows bar (b) red (the record's line words are damaged in memory).
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cardFields, cardToProse } from '../../src/panel/authorcard.js';
import { parseSignedText } from '../../src/signed-text.js';
import { scopedRules } from '../../src/checkpick.js';
import { matchRecord, readRecordFile, recordPath } from '../../src/pickrecord.js';

const dir = process.argv[2] ?? path.join(os.homedir(), '.config/fwdloop/flows/.drafts/d-00mw23a969-7629');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
let fail = 0;
const bar = (name, pass, note) => { if (!pass) fail++; console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${note}`); };

// (a) the record the Start-over path would carry: the newest plan folder with a record, as carryArgv picks it (draft-<n> newest first, then draft)
const ns = [1, 2, 3, 4, 5, 6].filter((n) => existsSync(path.join(dir, `draft-${n}`)));
const rels = [...ns].sort((x, y) => y - x).map((n) => `draft-${n}`).concat('draft');
const rel = rels.find((r) => existsSync(recordPath(path.join(dir, r))));
let entries = rel ? readRecordFile(recordPath(path.join(dir, rel))) : null;
bar('a', Array.isArray(entries) && entries.length === 2, `record = ${rel}/picks-record.json field "picks" (${entries?.length ?? 0} entries)`);

// (b) the card as it stands (the newest card is what Start over drafts), minus the revise-2 line added in walk 9 = the "unchanged" card
const cardNow = readJson(path.join(dir, 'card-3.json'));
const unchanged = { ...cardNow, job: cardNow.job.split('\n').slice(0, -1).join('\n') };
if (process.env.BREAK === '1' && entries) entries = entries.map((e) => ({ ...e, lineWords: `${e.lineWords} x` }));
const parsed = parseSignedText(cardToProse(cardFields(unchanged)));
if (!parsed.ok) { bar('b', false, `card does not parse: ${parsed.reds}`); process.exit(1); }
const m = matchRecord(entries ?? [], parsed.lines, scopedRules(parsed.lines, parsed.arbiter));
bar('b', m.askRules.length === 0, `${m.askRules.length} asks, ${m.kept.length} kept for the unchanged card`);
process.exit(fail ? 1 : 0);
