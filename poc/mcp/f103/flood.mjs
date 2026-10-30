// F103 T4 flood + T5 unreadable. $0. Seeds a separate ledger from an independent gh read, then runs look.mjs.
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { look } from './look.mjs';
const OUT = new URL('./out/', import.meta.url).pathname;
const gh = JSON.parse(execFileSync('gh', ['api', 'repos/flutter/flutter/issues?state=open&sort=created&direction=desc&per_page=100'], { encoding: 'utf8', timeout: 60000 })).filter((i) => !i.pull_request);
const CUT = 30; // entries 31+ are "seen"; the 30 newest are the flood (>= 3 pages at perPage 10)
const seenList = gh.slice(CUT).slice(0, 10); const cutCreated = gh[CUT - 1].created_at;
const led = OUT + 'ledger-flood.jsonl'; if (existsSync(led)) rmSync(led);
writeFileSync(led, seenList.map((i) => JSON.stringify({ number: i.number, created_at: i.created_at, kind: 'baseline', tag: 'seed' })).join('\n') + '\n');
const r = await look({ ledger: led, per: 10, tag: 'flood' });
const expected = gh.filter((i) => i.created_at > seenList[0].created_at).map((i) => i.number).reverse();
const gh2 = JSON.parse(execFileSync('gh', ['api', 'repos/flutter/flutter/issues?state=open&sort=created&direction=desc&per_page=100'], { encoding: 'utf8', timeout: 60000 })).filter((i) => !i.pull_request);
const rows = readFileSync(led, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((x) => x.number);
const t4 = { seedNewest: seenList[0].number, expectedCount: expected.length, got: r.newOldestFirst.length, pages: r.pages, calls: r.calls, ms: r.ms, unreadable: r.unreadable,
  equalToGh: JSON.stringify(expected) === JSON.stringify(r.newOldestFirst), missed: expected.filter((n) => !r.newOldestFirst.includes(n)), extra: r.newOldestFirst.filter((n) => !expected.includes(n)),
  dupes: rows.length - new Set(rows).size, ghDriftBetweenReads: JSON.stringify(gh.map((i) => i.number)) !== JSON.stringify(gh2.map((i) => i.number)), newOldestFirst: r.newOldestFirst };
// T5
const led5 = OUT + 'ledger-unreadable.jsonl'; if (existsSync(led5)) rmSync(led5);
const u = await look({ repo: 'flutter/this-repo-does-not-exist-zzz', ledger: led5, tag: 'unreadable' });
const t5 = { unreadable: u.unreadable, newOldestFirst: u.newOldestFirst, ledgerWritten: existsSync(led5) && readFileSync(led5, 'utf8').length > 0, retried: u.retried, calls: u.calls };
writeFileSync(OUT + 't4-t5.json', JSON.stringify({ t4, t5 }, null, 1)); console.log(JSON.stringify({ t4, t5 }));
process.exit(0);
