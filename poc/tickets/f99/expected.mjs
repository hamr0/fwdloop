// F99 pre-registration: run ONLY the reference matcher on the 32 tickets (+ made-up cases). Writes out/expected.json. $0, no bareguard.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { here, KW, loadTickets, C5 } from './common.mjs';
import { refMatched } from './ref.mjs';
const T = loadTickets(); const per = {};
for (const t of T) {
  const f = refMatched(t.text, KW), s = refMatched(t.text, KW, true);
  per[t.id] = { number: t.issue.number ?? null, forgiving: f.length ? 'green' : 'red', found: f, strict: s.length ? 'green' : 'red', strictFound: s };
}
const made = C5.map(([label, text, phrase, strict, expect]) => ({ label, got: refMatched(text, [phrase], strict).length > 0, expect }));
const g = Object.values(per).filter((x) => x.forgiving === 'green').length;
const out = { note: 'reference matcher outputs; written BEFORE bareguard carriesAny exists', phrases: KW, counts: { tickets: T.length, green: g, red: T.length - g, strictGreen: Object.values(per).filter((x) => x.strict === 'green').length }, madeUpAllAgree: made.every((m) => m.got === m.expect), madeUp: made, per };
writeFileSync(join(here, 'out/expected.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out.counts, madeUpAllAgree: out.madeUpAllAgree, madeBad: made.filter((m) => m.got !== m.expect).map((m) => m.label) }));
