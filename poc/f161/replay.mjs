// NOT the product. F161: the M10 am23 candidate as a pure function, replayed old vs candidate. $0, read only. Writes poc/f161/out/replay.txt.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSignedText } from '../../src/signed-text.js';
import { lineRules } from '../../src/pagebits.js';
import { scopedRules, hasRoutingInput } from '../../src/checkpick.js';
import { guardrailWordNumbers, guardrailSectionCount } from '../../src/declaration.js';

const NW = '\\d+|one|two|three|four|five|six|seven|eight|nine|ten';
const itemCount = (g) => new RegExp(`(?<![$€£\\d.,])\\b(?:${NW})\\s+(?:\\w+\\s+)?(?:bullets?|list items?|items?|lines?|points?)\\b`, 'i').test(g);
const isCount = (g) => guardrailWordNumbers(g).length > 0 || guardrailSectionCount(g) !== null || itemCount(g);

const skipLines = (arbiter) => new Set([...(arbiter?.asks ?? []), ...(arbiter?.sends ?? [])].map((x) => x.line));
const key = (r) => `${r.line}.${r.rule}`;
// candidate scope: as scopedRules, but a count guardrail is always 'in'
function candScope(lines, arbiter) {
  const skip = skipLines(arbiter); const out = [];
  for (const l of lines) {
    if (skip.has(l.n)) continue;
    const seen = new Set();
    lineRules({ rule: l.guardrail }).forEach((text, i) => {
      const k = text.trim().toLowerCase();
      if (seen.has(k) || !(!hasRoutingInput(arbiter?.sources) || isCount(text) || guardrailWordNumbers(text).length > 0)) return;
      seen.add(k); out.push({ line: l.n, rule: i + 1, text });
    });
  }
  return out;
}
const tied = (facts, r) => facts.some((f) => f.line === r.line && f.forRule === r.rule);
const oldOffer = (lines, arbiter, facts) => scopedRules(lines, arbiter).filter((r) => !tied(facts, r));
const newOffer = (lines, arbiter, facts) => candScope(lines, arbiter).filter((r) => isCount(r.text) || !tied(facts, r));

const out = []; let ok = true;
const say = (s) => out.push(s);
const names = (o) => o.map((r) => `${r.line}.${r.rule}"${r.text}"`).join(', ') || '(none)';

// (a) + (b) synthetic
const ADDR = 'https://example.test/page';
const job = (g1) => parseSignedText(`1. Summarise the page,
   guardrail: ${g1}
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source page = page:${ADDR}
`);
const A = job('exactly 3 bullets; under 80 words');
if (!A.ok) { say('parse A failed'); ok = false; }
const lookA = { look: { facts: [{ line: 1, forRule: 1, name: 'bullets', shape: 'count' }, { line: 1, forRule: 2, name: 'length', shape: 'count' }] }, sheets: [] }; // shape of a saved page-look.json
const factsA = [...lookA.look.facts, ...lookA.sheets.flatMap((s) => s.facts ?? [])];
const aOld = oldOffer(A.lines, A.arbiter, factsA), aNew = newOffer(A.lines, A.arbiter, factsA);
const aPass = aOld.length < 2 && aNew.length === 2 && factsA.length === 2;
say(`(a) tied: old offer ${names(aOld)} | candidate offer ${names(aNew)} | facts kept ${factsA.length} => ${aPass ? 'ok' : 'FAIL'}`); ok &&= aPass;
const B = job('exactly 3 bullets');
const bOld = oldOffer(B.lines, B.arbiter, []), bNew = newOffer(B.lines, B.arbiter, []);
const bPass = bOld.length === 0 && bNew.length === 1;
say(`(b) untied: old ${names(bOld)} | candidate ${names(bNew)} => ${bPass ? 'ok' : 'FAIL'}`); ok &&= bPass;

// (c) replay
const drafts = path.join(os.homedir(), '.config/fwdloop/flows/.drafts');
const rj = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
let n = 0, gained = 0, bad = 0;
for (const d of fs.readdirSync(drafts).sort()) {
  const dd = path.join(drafts, d);
  if (!fs.statSync(dd).isDirectory()) continue;
  for (const s of fs.readdirSync(dd).sort()) {
    if (!/^draft(-\d+)?$/.test(s)) continue;
    const look = rj(path.join(dd, s, 'page-look.json')); if (!look) continue;
    let prose; try { prose = fs.readFileSync(path.join(dd, s, 'prose.txt'), 'utf8'); } catch { continue; }
    const p = parseSignedText(prose); if (!p.ok) continue;
    n++;
    const facts = [...(look.look?.facts ?? []), ...(look.sheets ?? []).flatMap((x) => x.facts ?? [])];
    const o = oldOffer(p.lines, p.arbiter, facts), c = newOffer(p.lines, p.arbiter, facts);
    const oK = new Set(o.map(key)), cK = new Set(c.map(key));
    const removed = o.filter((r) => !cK.has(key(r)));
    const added = c.filter((r) => !oK.has(key(r)));
    const addedNonCount = added.filter((r) => !isCount(r.text));
    if (removed.length || addedNonCount.length) { bad++; say(`BAD ${d}/${s}: removed ${names(removed)} addedNonCount ${names(addedNonCount)}`); }
    if (added.length) { gained++; say(`gain ${d}/${s}: ${names(added)}`); }
  }
}
const cPass = n === 41 && bad === 0;
say(`(c) replayed ${n} looks (expect 41): ${gained} gain a count guardrail, ${bad} bad => ${cPass ? 'ok' : 'FAIL'}`); ok &&= cPass;
say(`VERDICT: ${ok ? 'PASS' : 'FAIL'}`);
fs.writeFileSync(new URL('./out/replay.txt', import.meta.url), out.join('\n') + '\n');
console.log(out.join('\n'));
