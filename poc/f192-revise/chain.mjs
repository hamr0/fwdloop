// F192 POC ($0): `node chain.mjs <tree> <jobName>` -> one JSON object on stdout: the four stages of Agree-then-Revise run through the TREE's own src (see docs/logs/FINDINGS.md "F192 PRE-REGISTERED").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const tree = path.resolve(process.argv[2]);
const jobName = process.argv[3];
const imp = (f) => import(pathToFileURL(path.join(tree, 'src', f)).href);
const { draft } = await imp('drafter.js');
const { cardFields, cardToProse, applyAnswers } = await imp('panel/authorcard.js');
const { fakeProvider, toolReply, RATES, MODEL } = await import(pathToFileURL(path.join(ROOT, 'test/drafter-fixture.mjs')).href);

const FLOWS = path.join(os.homedir(), '.config/fwdloop/flows');
const setup = (f) => fs.readFileSync(path.join(FLOWS, f, 'setup.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.kind === 'card');
const JOBS = {
  'walk-m16-m14': () => setup('walk-m16-m14')[0].card.job,
  'm14-walk-5': () => setup('m14-walk-5')[0].card.job,
  // the live failure: the job box after the append-Agree (line 3 and 5 each hold two rules)
  'live-failure': () => setup('walk-m16-m14')[1].card.job,
};
const job0 = JOBS[jobName]();

const scratch = fs.mkdtempSync(path.join(process.env.F192_TMP ?? os.tmpdir(), 'f192-'));
const out = path.join(scratch, 'out');
fs.mkdirSync(out);
const notes = path.join(scratch, 'notes.md');
fs.copyFileSync(path.join(ROOT, 'test/fixtures/m16-block/m14-walk-5/notes.md'), notes);
const proseOf = (job) => cardToProse(cardFields({ flowName: 'garden', job, inputs: `notes: ${notes}`, destination: out, capUsd: '5', askWait: '1h', provider: 'x', model: 'y' }));
const suggest = (checks) => ({ text: '', toolCalls: [{ id: 's1', name: 'suggest_checks', arguments: { checks } }], usage: { inputTokens: 900, outputTokens: 100 }, stopReason: 'tool_calls', model: MODEL });
const plan = () => toolReply({ steps: [], guardrailClasses: {}, unjudgeable: {}, refused: [] });
const tilde = (job) => { const o = {}; let step = 0; for (const l of job.split('\n')) { const t = l.trim(); if (t === '') continue; if (t.startsWith('~')) o[step] = (o[step] ?? 0) + 1; else step += 1; } return o; };
const qs = (r) => (r.questions ?? []).map((q) => ({ line: q.line, ask: q.ask, ruleNo: q.ruleNo, ruleText: q.ruleText, proposal: q.proposal, check: q.check ?? null }));

const res = { tree: path.basename(tree), job: jobName, tilde0: tilde(job0) };
try {
  // stage 1: the first draft, questions on
  const rec1 = { v: null };
  const p1 = fakeProvider([suggest([]), plan(), plan(), plan()]);
  const r1 = await draft({ proseText: proseOf(job0), provider: p1, rates: RATES, modelId: MODEL, onPickRecord: (x) => { rec1.v = x; } });
  const asked1 = qs(r1);
  res.stage1 = { stop: r1.stop, asked: asked1, suggestCalled: p1.calls.some((c) => c.tools[0] === 'suggest_checks') };
  // stage 2: Agree every asked check question, as src/panel/author.js builds `all`
  const all = asked1.filter((q) => q.ask === 'check').map((q) => ({ line: q.line, question: '', answer: 'agree', rule: q.proposal, left: false, ruleNo: q.ruleNo, ruleText: q.ruleText, ask: q.ask, check: q.check }));
  const grown = applyAnswers(job0, all);
  res.stage2 = { answers: all.length, job: grown.job, tilde: tilde(grown.job), picks: grown.picks, added: grown.added };
  // stage 3: the redraft after the answers (no questions), carrying the plan that asked
  const rec3 = { v: null };
  const p3 = fakeProvider([plan(), plan(), plan(), plan()]);
  const r3 = await draft({ proseText: proseOf(grown.job), provider: p3, rates: RATES, modelId: MODEL, offerQuestions: false, checkPicks: grown.picks, leftRules: grown.left, carriedPicks: rec1.v?.picks ?? [], onPickRecord: (x) => { rec3.v = x; } });
  res.stage3 = { stop: r3.stop, recordPicks: (rec3.v?.picks ?? []).map((e) => ({ lineWords: e.lineWords, ruleText: e.ruleText, added: e.added ?? null, check: e.check })) };
  // stage 4: the Revise from the card the Agree left (its job box is the grown job), carrying the redraft's record
  const rec4 = { v: null };
  const p4 = fakeProvider([suggest([]), plan(), plan(), plan()]);
  const r4 = await draft({ proseText: proseOf(grown.job), provider: p4, rates: RATES, modelId: MODEL, carriedPicks: rec3.v?.picks ?? [], onPickRecord: (x) => { rec4.v = x; } });
  // negative control (the harness can fail): the same Revise with NO carried picks must ask again
  const pN = fakeProvider([suggest([]), plan(), plan(), plan()]);
  const rN = await draft({ proseText: proseOf(grown.job), provider: pN, rates: RATES, modelId: MODEL, carriedPicks: [] });
  res.negControl = { asked: qs(rN).map((q) => q.line), suggestCalled: pN.calls.some((c) => c.tools[0] === 'suggest_checks') };
  res.stage4 = {
    stop: r4.stop, asked: qs(r4), suggestCalled: p4.calls.some((c) => c.tools[0] === 'suggest_checks'),
    kept: (rec4.v?.kept ?? []).map((k) => ({ line: k.line, rule: k.rule, ruleText: k.ruleText, check: k.check })), tildeAfter: tilde(grown.job),
  };
} catch (e) {
  res.error = String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify(res));
