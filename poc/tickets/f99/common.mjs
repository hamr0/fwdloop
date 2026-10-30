// F99 shared: the 32 tickets (F98's sample, read from F98/F96 recorded raw JSON; no network), the signed list, made-up cases.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const here = dirname(fileURLToPath(import.meta.url));
// SAME 12 phrases, same order as F98 G3. Unchanged.
export const KW = ['crash', 'crashes', 'crashed', 'crashing', 'hang', 'hangs', 'hung', 'freeze', 'freezes', 'frozen', 'ANR', 'not responding'];
const F96 = ['f100047', 'f193097', 'f187579', 'f193785', 'f180865', 'p2b', 'p3', 'none', 'k124871', 'l270', 'h11', 'y13'];
export function loadTickets() {
  const sel = JSON.parse(readFileSync(join(here, '../f98/tickets.json'), 'utf8'));
  const t = [];
  for (const id of F96) t.push({ id, set: '12', issue: JSON.parse(readFileSync(join(here, '../../mcp/f96/out/raw', id + '.json'), 'utf8')) });
  for (const [set, nums] of [['A', sel.A], ['B', sel.B]]) for (const n of nums) t.push({ id: 'fl' + n, set, issue: JSON.parse(readFileSync(join(here, '../f98/out/raw', `fl${n}.json`), 'utf8')) });
  for (const x of t) x.text = (x.issue.title ?? '') + '\n' + (x.issue.body ?? ''); // same text as F98
  return t;
}
// C1 targets, by issue number (the three `hang`-in-change substring false runs of F98)
export const C1_NUMBERS = [195397, 195468, 195368];
// C5 made-up text cases: [label, text, phrase, strict, expected]
export const C5 = [
  ['multi-word across newline+spaces', 'the app not\n  responding.', 'not responding', false, true],
  ['multi-word not-respondingly', 'it is not respondingly slow', 'not responding', false, false],
  ['hang-up needs the hyphen (hyphen present)', 'a hang-up happened', 'hang-up', false, true],
  ['hang-up needs the hyphen (hyphen absent)', 'a hang up happened', 'hang-up', false, false],
  ['hang-up needs the hyphen (underscore)', 'a hang_up happened', 'hang-up', false, false],
  ['crash2 no match', 'got crash2 today', 'crash', false, false],
  ['ANR, matches', 'saw ANR, then more', 'ANR', false, true],
  ['hang in change no match', 'I will change it', 'hang', false, false],
  ['hang in hanging no match (no stemming)', 'it is hanging', 'hang', false, false],
  ['(hang) matches', 'the (hang) case', 'hang', false, true],
  ['HANG: matches (forgiving)', 'HANG: now', 'hang', false, true],
  ['HANG: strict miss', 'HANG: now', 'hang', true, false],
  ['hang at text start and end', 'hang', 'hang', false, true],
  ['accented letter glues (cafe-e)', 'crashé', 'crash', false, false],
  ['strict exact case ok', 'it ANR dialog', 'ANR', true, true],
  ['strict lower text vs upper phrase', 'it anr dialog', 'ANR', true, false],
];
// C3 made-up inputs: field 'body'
export const C3_FIELDS = { noBody: { title: 'x' }, numberBody: { body: 12345 } };
// C6 refusals; each must throw with e.path (string) containing 'phrases'; item-level ones must contain 'phrases['
export const C6 = [
  ['empty list', [], false],
  ['blank phrase', ['crash', ''], true],
  ['leading space', [' hang'], true],
  ['double space', ['a  b'], true],
  ['51 phrases', Array.from({ length: 51 }, (_, i) => 'word' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26))), false],
  ['201-char phrase', ['a'.repeat(201)], true],
  ['case-fold duplicate', ['Hang', 'hang'], true],
];
