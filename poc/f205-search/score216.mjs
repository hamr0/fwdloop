// F216 scorer: node poc/f205-search/score216.mjs <tag>   (bars as pre-registered)
import { readFileSync, existsSync } from 'node:fs';
import { resultsPath216, SITES, ENGINES } from './run216.mjs';

const tag = process.argv[2];
if (!tag) { console.error('usage: score216.mjs <tag>'); process.exit(2); }
if (!existsSync(resultsPath216(tag))) { console.error(`no results for tag ${tag}`); process.exit(2); }
const rows = readFileSync(resultsPath216(tag), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === 'read');
const get = (s, e) => rows.find((r) => r.site === s && r.engine === e);
for (const s of SITES) for (const e of ENGINES) {
  const r = get(s.id, e); if (!r) continue;
  console.log(`${s.id} ${e}: status=${r.status ?? '-'} botBlocked=${r.botBlocked} marker=${r.marker} challengeWords=${r.challengeWords} chars=${r.chars ?? 0} product=${r.product ?? 0} landing=${r.landing ?? '-'}${r.error ? ` | ERROR ${r.error}` : ''}${r.hold?.attempted ? `\n     hold(${r.hold.ref}, 12000): botBlockedAfter=${r.hold.botBlockedAfter} productAfter=${r.hold.productAfter} charsAfter=${r.hold.charsAfter} urlAfter=${r.hold.urlAfter} challengeWordsAfter=${r.hold.challengeWordsAfter}` : ''}`);
}
const wm = ENGINES.map((e) => get('walmart', e)).filter(Boolean);
const shows = wm.filter((r) => r.challengeWords);
const b1 = shows.length >= 1 && shows.every((r) => r.botBlocked === true);
const b2 = wm.some((r) => r.hold?.attempted && r.hold.botBlockedAfter === false && r.hold.productAfter >= 5);
const falseFlags = ['amazon', 'duckduckgo'].flatMap((s) => ENGINES.map((e) => get(s, e)).filter(Boolean)).filter((r) => r.botBlocked && !r.challengeWords);
const b3 = falseFlags.length === 0;
console.log(`Bar 1: walmart shows the challenge on ${shows.length} engine(s) (${shows.map((r) => r.engine).join(', ') || 'none'}); flagged on ${shows.filter((r) => r.botBlocked).length}: ${b1 ? 'PASS' : 'FAIL'}`);
console.log(`Bar 2: hold clears walmart (botBlocked false and >= 5 product lines after) on ${wm.filter((r) => r.hold?.attempted && r.hold.botBlockedAfter === false && r.hold.productAfter >= 5).map((r) => r.engine).join(', ') || 'no engine'}: ${b2 ? 'PASS' : 'FAIL'}`);
console.log(`Bar 3: amazon/duckduckgo flagged without challenge words: ${falseFlags.length}${falseFlags.length ? ` (${falseFlags.map((r) => `${r.site} ${r.engine}`).join(', ')})` : ''}: ${b3 ? 'PASS' : 'FAIL'}`);
for (const s of ['ebay', 'newegg']) console.log(`reported: ${s} ${ENGINES.map((e) => `${e} status=${get(s, e)?.status ?? '-'} botBlocked=${get(s, e)?.botBlocked}`).join('; ')}`);
console.log(`VERDICT: ${b1 && b2 && b3 ? 'GO' : 'NO-GO'}`);
