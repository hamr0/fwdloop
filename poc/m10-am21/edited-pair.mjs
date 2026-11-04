// F150 (pre-registered in docs/logs/FINDINGS.md): M10 am21, $0, no provider, no key. READ ONLY on the draft dir.
// Run: node poc/m10-am21/edited-pair.mjs [draftDir]
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cardFields, cardToProse } from '../../src/panel/authorcard.js';
import * as authorcard from '../../src/panel/authorcard.js';
import { parseSignedText } from '../../src/signed-text.js';
import { scopedRules, rowsFromAnswer, checkAsks, settleRules } from '../../src/checkpick.js';
import { matchRecord, readRecordFile, recordPath } from '../../src/pickrecord.js';
import { ruleOfAnswer } from '../../src/pageask.js';

const dir = process.argv[2] ?? path.join(os.homedir(), '.config/fwdloop/flows/.drafts/d-00mw28nmoh-e174');
const card1 = JSON.parse(readFileSync(path.join(dir, 'card-1.json'), 'utf8'));
const record = readRecordFile(recordPath(path.join(dir, 'draft')));
let fail = 0;
const bar = (name, pass, note) => { if (!pass) fail++; console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${note}`); };
const load = (card) => {
  const p = parseSignedText(cardToProse(cardFields(card)));
  if (!p.ok) throw new Error(`card does not parse: ${p.reds}`);
  return { lines: p.lines, rules: scopedRules(p.lines, p.arbiter) };
};
// the suggestion call is canned: maxWords 60 for the guardrail it is asked about (the call is am16's)
const suggest = (askRules) => rowsFromAnswer(askRules, { checks: askRules.map((r) => ({ line: r.line, guardrail: r.rule, rule: 'maxWords', value: 60 })) });

const { lines, rules } = load(card1);
const m = matchRecord(record, lines, rules);
const asks = checkAsks(suggest(m.askRules));

// (a)
bar('a', asks.length === 1 && asks[0].line === 6 && asks[0].ruleText === 'at most 60 words',
  `${asks.length} ask(s): ${asks.map((a) => `line ${a.line} "${a.ruleText}"`).join('; ')}`);

// (b)
try {
  const ask = asks[0];
  const q = { source: 'look', ask: ask.ask, ruleNo: ask.rule, ruleText: ask.ruleText, proposal: ask.reading, check: ask.check, ...(ask.pairRule === undefined ? {} : { pairRule: ask.pairRule }) };
  const all = [{ line: ask.line, answer: 'agree', ruleText: ask.ruleText, ...ruleOfAnswer(q, 'agree'), ruleNo: q.ruleNo, ask: q.ask, ...(q.pairRule === undefined ? {} : { pairRule: q.pairRule }) }];
  const done = authorcard.applyAnswers(card1.job, all);
  const block = done.job.split('\n').filter((l) => l.startsWith('~') && /words/.test(l));
  const after = load({ ...card1, job: done.job });
  const settled = settleRules(after.rules, done.picks, done.left);
  const checks6 = settled.checks.get(6) ?? [];
  const notes6 = settled.notes.filter((n) => n.line === 6);
  bar('b', JSON.stringify(block) === JSON.stringify(['~ under 80 words', '~ at most 60 words']) && JSON.stringify(checks6) === JSON.stringify([{ rule: 'maxWords', value: 60 }]) && notes6.length === 0,
    `words lines ${JSON.stringify(block)}; line 6 checks ${JSON.stringify(checks6)}; notes ${JSON.stringify(notes6.map((n) => `${n.text}:${n.reason}`))}`);
} catch (e) { bar('b', false, `could not run: ${e.message}`); }

// (c) no answer given: the edited rule is asked (never left no-pick); control: the record's added line unchanged asks nothing
const edited = rules.find((r) => r.line === 6 && r.text === 'at most 60 words');
bar('c', edited !== undefined && m.askRules.some((r) => r.line === 6 && r.rule === edited.rule), `asked rules: ${m.askRules.map((r) => `${r.line}.${r.rule} "${r.text}"`).join('; ')}`);
const orig = load({ ...card1, job: card1.job.replace('~ at most 60 words', '~ at most 80 words') });
const ctl = matchRecord(record, orig.lines, orig.rules);
bar('c-control', ctl.askRules.length === 0, `${ctl.askRules.length} asks with the added line unchanged`);
process.exit(fail ? 1 : 0);
