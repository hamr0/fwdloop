// F97 $0 selftest of the scratch ticketFilter validator: a valid filter is green, each malformed one is a red. Run from the scratch repo: node <this> 
import { readFileSync } from 'node:fs';
import { parseSignedText } from './src/signed-text.js';
import { validateDeclaration, } from './src/declaration.js';
import { loadCatalogue } from './src/catalogue.js';
import { WIRED_VERBS } from './src/primitives.js';
const prose = readFileSync(process.argv[2], 'utf8');
const sp = parseSignedText(prose);
const { arbiter, lines } = sp;
const base = { steps: [
  { goal: lines[0].text, primitives: ['read'], reads: ['issue'], emits: 'prio', fromLine: 1, close: { class: 'hitl' } },
  { goal: lines[1].text, primitives: ['read'], reads: ['issue'], emits: 'what', fromLine: 2, close: { class: 'hitl' } },
  { goal: lines[2].text, primitives: [], reads: ['prio', 'what'], emits: 'plan', fromLine: 3, close: { class: 'softgreen', shape: { maxWords: 150 } } },
  { goal: lines[3].text, primitives: [], reads: ['plan'], emits: 'ok', fromLine: 4, close: { class: 'hitl' } },
  { goal: lines[4].text, primitives: ['write'], reads: ['ok'], emits: 'out', fromLine: 5, close: { class: 'hitl' } },
], guardrailClasses: { 1: 'hitl', 2: 'hitl', 3: 'softgreen', 4: 'hitl' }, unjudgeable: {}, refused: [], inputFacts: {} };
const ctx = { arbiter, lines, catalogue: loadCatalogue().primitives ?? loadCatalogue(), wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true };
const ok = { fromLine: 1, box: 'priority', values: ['P0', 'P1', 'P2', 'P3', 'none', 'unsure'], allowed: ['P2'] };
const cases = {
  'valid': [[ok, { fromLine: 2, box: 'topic', values: ['crash-or-hang', 'other', 'unsure'], allowed: ['crash-or-hang'] }], true],
  'no unsure last': [[{ ...ok, values: ['P0', 'P2', 'none'] }], false],
  'unsure not last': [[{ ...ok, values: ['unsure', 'P2'] }], false],
  'allowed has unsure': [[{ ...ok, allowed: ['P2', 'unsure'] }], false],
  'allowed not in values': [[{ ...ok, allowed: ['P9'] }], false],
  'line without guardrail (line 5)': [[{ ...ok, fromLine: 5 }], false],
  'two boxes one line': [[ok, { ...ok, box: 'other' }], false],
  'duplicate box name': [[ok, { ...ok, fromLine: 2 }], false],
  'bad box name': [[{ ...ok, box: 'Priority X' }], false],
  'extra field': [[{ ...ok, why: 'x' }], false],
  'not an array': ['x', false],
};
let bad = 0;
const green = validateDeclaration(base, ctx);
console.log('base without ticketFilter ok=', green.ok, green.reds?.slice(0, 3));
for (const [name, [tf, want]] of Object.entries(cases)) {
  const v = validateDeclaration({ ...base, ticketFilter: tf }, ctx);
  const got = v.ok;
  if (got !== want) bad++;
  console.log(got === want ? 'ok  ' : 'BAD ', name, '->', got, got ? '' : v.reds.filter((r) => /ticketFilter/.test(r)).join(' | ').slice(0, 140));
}
process.exit(bad ? 1 : 0);
