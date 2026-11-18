// F221 harness ($0, no AI, no key): M17 am9a, a single-column Agree rewrites the `~` rule (docs/logs/FINDINGS.md "F221 PRE-REGISTRATION").
// Run: NODE_ENV=test node poc/f221-single/run.mjs
// Real: applyAnswers (src/panel/authorcard.js), ruleOfAnswer, columnRuleWords, parseJobBox, cardToProse, findColumn. POC copy: authorcard.js with two string edits (src/ never touched).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import * as real from '../../src/panel/authorcard.js';
import { ruleOfAnswer } from '../../src/pageask.js';
import { columnRuleWords } from '../../src/sheetlook.js';

const SRC = new URL('../../src/', import.meta.url);
const work = mkdtempSync(join(tmpdir(), 'fwdloop-f221-'));
const results = [];
const bar = (id, pass, why) => results.push({ id, pass, why });

const OLD1 = "(!Number.isInteger(x.ruleNo) || swapped === null) ? columnChoiceParts(x.rule) : null;";
const NEW1 = "!Number.isInteger(x.ruleNo) ? columnChoiceParts(x.rule) : null;";
const OLD2 = " && (!isColumnChoiceRule(x.proposal) || !isColumnChoiceRule(x.rule) || swapped !== null)) {";
const NEW2 = ") {";
function once(t, a, b) { if (t.split(a).length !== 2) throw new Error(`patch: not exactly one match of ${a.slice(0, 50)}`); return t.replace(a, () => b); }
async function build(name, patched) {
  let t = readFileSync(new URL('panel/authorcard.js', SRC), 'utf8');
  if (patched) { t = once(t, OLD1, NEW1); t = once(t, OLD2, NEW2); }
  t = t.replace(/from '(\.\.?\/[^']+)'/g, (_m, f) => `from '${new URL(f, new URL('panel/', SRC)).href}'`);
  const file = join(work, name); writeFileSync(file, t);
  return import(pathToFileURL(file).href);
}
const P = await build('authorcard-patched.mjs', true);
const U = await build('authorcard-unpatched.mjs', false); // pre-break 5 (and a drift check against the real module)

const JOB = (rule) => `Read the sheet,\nList expenses,\n${rule === null ? '' : `~ ${rule}\n`}Ask 1h: check it with me,\nWrite it out\n`;
const lines = (j) => j.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('~')).length;
const rules = (j) => j.split('\n').filter((l) => l.startsWith('~'));
const CARD = (job) => ({ flowName: 'f', job, destination: '/tmp/out', inputs: '', capUsd: 1, askWait: '1h' });
const surfaces = (job) => ({
  box: rules(job).join(' | '),
  card: real.parseJobBox(job).steps.flatMap((s) => s.guardrails).join(' | '),
  signed: real.cardToProse(CARD(job)).split('\n').filter((l) => l.startsWith('   guardrail:')).map((l) => l.trim()).join(' | '),
});
// the answer exactly as the real door builds it: ruleOfAnswer on a look question, choice 'agree'
function agree(mod, job, ruleText, word, column, ruleNo = 1) {
  const q = { source: 'look', ask: 'reading', proposal: columnRuleWords(word, column), line: 2, question: `q ${word}`, ruleNo, ruleText };
  const eff = ruleOfAnswer(q, 'agree', 'agree');
  return mod.applyAnswers(job, [{ line: 2, question: q.question, answer: 'agree', ...eff, ruleNo, ruleText, ask: 'reading', proposal: q.proposal }]);
}
const show = (r) => JSON.stringify({ ...surfaces(r.job), lines: lines(r.job), added: r.added, told: r.columns });

const a0 = agree(real, JOB('Price over 500'), 'Price over 500', 'Price', 'Amount');
const b0 = agree(real, JOB('under budget'), 'under budget', 'Price', 'Amount');
console.log('TODAY (a)', show(a0)); console.log('TODAY (b)', show(b0));
bar('a-today', surfaces(a0.job).box === '~ Amount over 500', `today (a): ${show(a0)}`);
bar('b-today-red', surfaces(b0.job).box === "~ use the column 'Amount' for 'Price'", `today (b) vs am9a: ${show(b0)} (RED if the old words stay)`);

const a1 = agree(P, JOB('Price over 500'), 'Price over 500', 'Price', 'Amount');
const b1 = agree(P, JOB('under budget'), 'under budget', 'Price', 'Amount');
const okC = (r, rule, base) => { const s = surfaces(r.job); return s.box === `~ ${rule}` && s.card === rule && s.signed === `guardrail: ${rule}` && lines(r.job) === lines(base) && rules(r.job).length === 1 && r.columns.length === 0; };
bar('c-a', okC(a1, 'Amount over 500', JOB('x')), `patched (a): ${show(a1)}`);
bar('c-b', okC(b1, "use the column 'Amount' for 'Price'", JOB('x')), `patched (b): ${show(b1)}`);

// (d) a prose word: no rule number
const dJob = JOB(null); const dq = (m) => m.applyAnswers(dJob, [{ line: 2, question: 'q', answer: 'agree', rule: columnRuleWords('Price', 'Amount'), left: false, ruleNo: undefined, ruleText: undefined, ask: 'reading', proposal: columnRuleWords('Price', 'Amount') }]);
const d0 = dq(real), d1 = dq(P);
bar('d', JSON.stringify(d0) === JSON.stringify(d1) && d0.columns.length === 1 && d0.job === dJob, `prose word: today ${JSON.stringify(d0)} ; patched identical: ${JSON.stringify(d0) === JSON.stringify(d1)}`);
// drift check: the unpatched copy equals the real module
const u = agree(U, JOB('under budget'), 'under budget', 'Price', 'Amount');
bar('drift', JSON.stringify(u) === JSON.stringify(b0), 'unpatched derived copy == real module on (b)');
// (e) pre-break: the unpatched copy fails (c-b)
bar('e', !okC(u, "use the column 'Amount' for 'Price'", JOB('x')), `pre-break (patch removed): (c-b) is red: ${show(u)}`);

console.log(`F221 work root: ${work}`);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}\n   ${r.why}`);
