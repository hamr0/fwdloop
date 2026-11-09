// NOT the product. F160: read-only $0 scan of ~/.config/fwdloop/flows/.drafts for a countable guardrail that a page/sheet look fact tied (forRule),
// so src/drafter.js:662 removed it from the pick offer. Prints flow names, line numbers, guardrail text only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSignedText } from '../../src/signed-text.js';
import { lineRules } from '../../src/pagebits.js';
import { scopedRules } from '../../src/checkpick.js';
import { guardrailWordNumbers, guardrailSectionCount, guardrailWordsPerSection, guardrailStandaloneNumbers } from '../../src/declaration.js';

const drafts = path.join(os.homedir(), '.config/fwdloop/flows/.drafts');
const rj = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const NOUN = /\b(bullets?|items?|lines?|points?|sections?|rows?|entries|flights|jobs|sentences|paragraphs|words?)\b/i;
const countable = (t) => guardrailWordNumbers(t).length > 0 || guardrailSectionCount(t) !== null || guardrailWordsPerSection(t) !== null
  || (guardrailStandaloneNumbers(t).length > 0 && NOUN.test(t) && !/[$€£]/.test(t));

const c = { tries: 0, noProse: 0, noLook: 0, withLook: 0, withTiedFact: 0, rulesScoped: 0, tied: 0, tiedCountable: 0, hits: 0, allTied: 0, allTiedCountable: 0, allTiedOutOfScope: 0 };
const out = [];
for (const d of fs.readdirSync(drafts).sort()) {
  const dd = path.join(drafts, d);
  if (!fs.statSync(dd).isDirectory()) continue;
  const flow = rj(path.join(dd, 'card.json'))?.flowName ?? d;
  for (const s of fs.readdirSync(dd).sort()) {
    if (!/^draft(-\d+)?$/.test(s)) continue;
    c.tries++;
    let prose; try { prose = fs.readFileSync(path.join(dd, s, 'prose.txt'), 'utf8'); } catch { c.noProse++; continue; }
    const parsed = parseSignedText(prose);
    if (!parsed.ok) { c.noProse++; continue; }
    const look = rj(path.join(dd, s, 'page-look.json'));
    if (!look) { c.noLook++; continue; }
    c.withLook++;
    const facts = [...(look.look?.facts ?? []), ...(look.sheets ?? []).flatMap((x) => x.facts ?? [])];
    const rules = scopedRules(parsed.lines, parsed.arbiter);
    c.rulesScoped += rules.length;
    // context only (not the bar): every rule a fact ties, whether or not scopedRules would offer it
    for (const l of parsed.lines) lineRules({ rule: l.guardrail }).forEach((text, i) => {
      const f = facts.find((x) => x.line === l.n && x.forRule === i + 1);
      if (!f) return;
      c.allTied++;
      if (countable(text)) { c.allTiedCountable++; out.push(`context: countable tied ${flow} line ${l.n} rule ${i + 1}: "${text}" -> "${f.name}" (${f.shape}); in offer scope: ${rules.some((r) => r.line === l.n && r.rule === i + 1)}`); }
      if (!rules.some((r) => r.line === l.n && r.rule === i + 1)) c.allTiedOutOfScope++;
    });
    let any = false;
    for (const r of rules) {
      const f = facts.find((x) => x.line === r.line && x.forRule === r.rule);
      if (!f) continue;
      any = true; c.tied++;
      if (countable(r.text)) { c.tiedCountable++; c.hits++; out.push(`HIT ${flow} ${d}/${s} line ${r.line} rule ${r.rule}: "${r.text}" tied to fact "${f.name}" (${f.shape})`); }
      else out.push(`tied, not countable: ${flow} ${d}/${s} line ${r.line} rule ${r.rule}: "${r.text}" -> fact "${f.name}" (${f.shape})`);
    }
    if (any) c.withTiedFact++;
  }
}
const lines = ['F160 scan', JSON.stringify(c), ...out, `VERDICT: ${c.hits >= 1 ? 'SEEN' : 'NOT SEEN'}`];
fs.writeFileSync(new URL('./out/scan.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.join('\n'));
