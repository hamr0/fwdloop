// F201 cases (real data copied read-only into .claude/scratch/f201/cases/). Job lines are built the way src/drafter.js builds them for the page look.
import fs from 'node:fs';
import path from 'node:path';
import { parseSignedText } from '../../src/signed-text.js';
import { hideCounts } from '../../src/drafter.js';

export const CASES_DIR = path.resolve(import.meta.dirname, '../../.claude/scratch/f201/cases');
const rd = (...p) => fs.readFileSync(path.join(CASES_DIR, ...p), 'utf8');

// the drafter: jobLines = lines.map({n, text, rule: guardrail}); the look sees seenLines = hideCounts(jobLines, every line but ask/send)
function fromProse(prose) {
  const { lines, arbiter } = parseSignedText(prose);
  const jobLines = lines.map((l) => ({ n: l.n, text: l.text, ...(l.guardrail ? { rule: l.guardrail } : {}) }));
  const askOrSend = new Set([...arbiter.asks.map((a) => a.line), ...arbiter.sends.map((x) => x.line)]);
  return hideCounts(jobLines, new Set(lines.map((l) => l.n).filter((n) => !askOrSend.has(n)))).seenLines;
}

// bareloop run mwi76vh8: card.json jobText is one line plus three `~` rules; the same job in fwd's signed form is parsed by the real parser
function bareloopCase() {
  const card = JSON.parse(rd('c1-bareloop-mwi76vh8', 'card.json'));
  const [first, ...rules] = card.jobText.split('\n');
  const prose = `1. ${first.charAt(0).toLowerCase()}${first.slice(1)},\n   guardrail: ${rules.map((r) => r.replace(/^~\s*/, '')).join('; ')}\n2. ask 30m: check it with me,\n3. and once I accept, write it out.\n\nArbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):\nguardrail: cap $0.5 per run\nguardrail: send at line 3 to file:/tmp/x\nguardrail: source flights = page:https://example.invalid/flights\n`;
  return prose;
}

/** expect: the (line, rule) refs a person's rule is rightly tied to (F200 labels: same words / meaning match). nonsense: refs that must not be tied. */
export const CASES = [
  { id: 'c1-bareloop-mwi76vh8', note: 'bareloop run mwi76vh8, ~ be friendly', label: 'flights', file: 'c1-bareloop-mwi76vh8/flights.txt', prose: () => bareloopCase(), expect: ['1:1', '1:2'], nonsense: ['1:3'] },
  { id: 'c2-fwd-f41b', note: 'F200 draft d-00mvhunl83-f41b: under $150; nonstop', label: 'flights', file: 'c2-fwd-f41b/flights.txt', prose: () => rd('c2-fwd-f41b', 'prose.txt'), expect: ['2:1', '2:2'], nonsense: [] },
  { id: 'c3-fwd-69d1', note: 'F200 draft d-00mvihbmok-69d1: under $150; nonstop', label: 'flights', file: 'c3-fwd-69d1/flights.txt', prose: () => rd('c3-fwd-69d1', 'prose.txt'), expect: ['2:1', '2:2'], nonsense: [] },
  { id: 'c4-fwd-b310', note: 'F200 draft d-00mvmd5209-b310: under $40; nonstop', label: 'flights', file: 'c4-fwd-b310/flights.txt', prose: () => rd('c4-fwd-b310', 'prose.txt'), expect: ['2:1', '2:2'], nonsense: [] },
].map((c) => ({ ...c, jobLines: fromProse(c.prose()), text: rd(c.file) }));
