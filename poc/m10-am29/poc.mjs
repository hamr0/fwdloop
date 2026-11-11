// F177 study script (throwaway, $0). Usage: node poc.mjs <codeRoot> [breakMapping]
// Bars 1-4 against the code in <codeRoot> (repo = today, worktree = candidate). Prints JSON of counts and shapes only (draft data may hold PII).
import { readdirSync, readFileSync, mkdtempSync, cpSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const HOME = process.env.HOME;
const SC = '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/bacc1500-09a3-4575-90fd-670b7893e350/scratchpad';
const CORPORA = [join(HOME, '.config/fwdloop/flows/.drafts'), ...['f162-1', 'f165-1', 'f168-1', 'f170-1', 'f172-1', 'f173-1'].map((d) => join(SC, d, 'flows/.drafts'))];
const root = resolve(process.argv[2]);
const imp = (f) => import(pathToFileURL(join(root, f)).href);
const pa = await imp('src/pageask.js');
const { readQuestions } = await imp('src/authoring.js');
const out = {};
const J = (x) => JSON.stringify(x);

// ---- bar 1 / 4: every answered question in the corpus
const plans = [];
for (const c of CORPORA) {
  if (!existsSync(c)) continue;
  for (const d of readdirSync(c)) {
    for (const p of readdirSync(join(c, d))) {
      if (/^draft(-\d+)?$/.test(p)) plans.push(join(c, d, p));
    }
  }
}
let answered = 0; let same = 0; const stripped = []; const readingDrop = []; const other = []; let noChoiceSame = 0; let noChoiceDiff = 0;
const byKind = {};
for (const p of plans) {
  for (const q of readQuestions(p).questions) {
    if (q.answer === null) continue;
    answered += 1;
    const kind = `${q.source ?? 'drafter'}/${q.ask ?? '-'}`; byKind[kind] = (byKind[kind] ?? 0) + 1;
    const today = J(pa.ruleOfAnswer(q, q.answer));
    // Bar 4: the candidate with NO choice (CLI, old files) is today's rule (when run against the repo this is the same call, a sanity check)
    if (J(pa.ruleOfAnswer(q, q.answer, undefined)) === today) noChoiceSame += 1; else noChoiceDiff += 1;
    // the button a user would have pressed
    const look = q.source === 'look';
    const proposes = look && typeof q.proposal === 'string' && (q.ask === 'reading' || q.ask === 'check');
    const t = String(q.answer).replace(/\s*\n\s*/g, ' ').trim();
    const choice = !look ? 'rule' : (pa.isAgree(t) && proposes) ? 'agree' : pa.isDropIt(t) ? 'drop' : 'rule';
    const cand = J(pa.ruleOfAnswer(q, q.answer, choice));
    if (cand === today) same += 1;
    else if (look && choice === 'rule' && pa.stripAgreeLead(t) !== t) stripped.push(kind);
    else if (look && choice === 'drop' && q.ask === 'reading') readingDrop.push(kind);
    else other.push(kind);
  }
}
out.bar1 = { plans: plans.length, answered, byKind, identical: same, stripAgreeLeadCases: stripped.length, strippedKinds: stripped, readingDropNew: readingDrop.length, unexplainedDiffs: other.length };
out.bar4 = { noChoiceSame, noChoiceDiff };

// ---- bar 2: the trap
const reading = { source: 'look', ask: 'reading', proposal: 'price under 450 US dollars' };
const check = { source: 'look', ask: 'check', proposal: 'P', check: { a: 1 } };
const r = (q, w, c) => pa.ruleOfAnswer(q, w, c);
out.bar2 = {
  boxAgreeWhyNot: r(reading, 'agree, why not', 'rule').rule === 'agree, why not' && r(reading, 'agree, why not', 'rule').left === false,
  boxAgree: r(reading, 'agree', 'rule').rule === 'agree',
  boxYes: r(reading, 'yes', 'rule').rule === 'yes',
  agreeButton: r(reading, '', 'agree').rule === reading.proposal,
  agreeCheckCarriesCheck: J(r(check, '', 'agree').check) === '{"a":1}',
  dropReading: r(reading, '', 'drop').rule === null && r(reading, '', 'drop').left === true,
  boxDropIt: r(reading, 'drop it', 'rule').rule === 'drop it',
};

// ---- bar 3: the panel's real answer handler on a mkdtemp copy
const { createAuthor } = await imp('src/panel/author.js');
let src = null;
for (const c of CORPORA) {
  if (src || !existsSync(c)) continue;
  for (const d of readdirSync(c)) {
    const p = join(c, d, 'draft');
    if (!existsSync(p)) continue;
    const qs = readQuestions(p).questions;
    if (qs.length >= 2 && qs.every((q) => q.source === 'look' && (q.ask === 'reading' || q.ask === 'check') && typeof q.proposal === 'string') && existsSync(join(c, d, 'card.json'))) { src = join(c, d); break; }
  }
}
out.bar3 = { sourceFound: src !== null };
if (src) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'f177-'));
  const cfgHome = join(tmpRoot, 'cfg'); mkdirSync(cfgHome); cpSync(join(HOME, '.config/fwdloop/config.json'), join(cfgHome, 'config.json')); // a copy: the real Settings tick, never the real file
  const stub = join(tmpRoot, 'stub.mjs'); writeFileSync(stub, 'process.exit(0);\n');
  try {
    const mk = (id) => {
      const dd = join(tmpRoot, '.drafts'); mkdirSync(dd, { recursive: true });
      cpSync(src, join(dd, id), { recursive: true });
      const pd = join(dd, id, 'draft');
      for (const f of readdirSync(pd)) if (/^answer-\d+\.json$/.test(f)) rmSync(join(pd, f));
      const cf = join(dd, id, 'card.json'); const cj = JSON.parse(readFileSync(cf, 'utf8')); cj.provider = 'DEEPSEEK_API_KEY'; cj.model = 'deepseek-flash'; writeFileSync(cf, J(cj)); // the real Settings tick, so the redraft's card check passes
      for (const f of ['signed.json', 'pid.json', 'abandoned.json']) rmSync(join(dd, id, f), { force: true });
      for (const f of readdirSync(join(dd, id))) if (/^(card|prose|redraft)-\d+/.test(f)) rmSync(join(dd, id, f), { recursive: true, force: true });
      return join(pd);
    };
    const author = createAuthor({ root: tmpRoot, home: cfgHome, loadEnv: () => ({ ok: true, env: { DEEPSEEK_API_KEY: 'poc-fake-not-a-key' }, refusal: null, keyNames: ['DEEPSEEK_API_KEY'] }), bin: stub, childRunning: () => false, skipMonthly: true });
    const id = 'd-00f177aaaa-0001';
    const pd = mk(id);
    const nq = readQuestions(pd).questions.length;
    const ans = (b) => { const x = author.answer(id, b); return { status: x.status, refused: x.body?.refused, ok: x.body?.ok }; };
    out.bar3.questions = nq;
    // refusals first (they write nothing)
    out.bar3.badChoice = ans({ k: 1, answer: 'x', choice: 'maybe' });
    out.bar3.badChoiceNoWrite = !existsSync(join(pd, 'answer-1.json'));
    // agree on a question with no proposal: a copy with the proposal removed
    const id2 = 'd-00f177bbbb-0002'; const pd2 = mk(id2);
    const qf = join(pd2, 'questions.json'); const qj = JSON.parse(readFileSync(qf, 'utf8')); qj.questions[0].proposal = null; writeFileSync(qf, J(qj));
    out.bar3.agreeNoProposal = (() => { const x = author.answer(id2, { k: 1, answer: '', choice: 'agree' }); return { status: x.status, refused: x.body?.refused }; })();
    // drop / agree on a drafter (non-look) question
    const id3 = 'd-00f177cccc-0003'; const pd3 = mk(id3);
    const qf3 = join(pd3, 'questions.json'); const qj3 = JSON.parse(readFileSync(qf3, 'utf8'));
    for (const q of qj3.questions) { delete q.source; delete q.ask; delete q.proposal; delete q.ruleNo; delete q.ruleText; delete q.check; }
    writeFileSync(qf3, J(qj3));
    out.bar3.dropDrafter = (() => { const x = author.answer(id3, { k: 1, answer: 'x', choice: 'drop' }); return { status: x.status, refused: x.body?.refused }; })();
    out.bar3.agreeDrafter = (() => { const x = author.answer(id3, { k: 1, answer: 'x', choice: 'agree' }); return { status: x.status, refused: x.body?.refused }; })();
    out.bar3.ruleDrafterOk = (() => { const x = author.answer(id3, { k: 1, answer: 'my words', choice: 'rule' }); return { status: x.status }; })();
    // good paths on the first copy: k=1 agree button, (last) box answer that STARTS with "agree"
    out.bar3.agree1 = ans({ k: 1, answer: 'ignored words', choice: 'agree' });
    const f1 = existsSync(join(pd, 'answer-1.json')) ? JSON.parse(readFileSync(join(pd, 'answer-1.json'), 'utf8')) : null;
    out.bar3.file1 = f1 && { choice: f1.choice, ruleIsProposal: f1.rule === f1.proposal, answer: f1.answer };
    const rq = readQuestions(pd).questions[0];
    out.bar3.readBackChoice = rq.choice;
    for (let k = 2; k < nq; k += 1) ans({ k, answer: 'filler', choice: 'rule' });
    const lx = author.answer(id, { k: nq, answer: 'agree, why not', choice: 'rule' }); out.bar3.lastBox = { status: lx.status, refused: lx.body?.refused, refusals: (lx.body?.refusals ?? []).map((x) => x.field + ': ' + String(x.say).slice(0, 90)) };
    const fl = existsSync(join(pd, `answer-${nq}.json`)) ? JSON.parse(readFileSync(join(pd, `answer-${nq}.json`), 'utf8')) : null;
    out.bar3.fileLast = fl && { choice: fl.choice, rule: fl.rule === 'agree, why not' };
    const dd1 = join(tmpRoot, '.drafts', id);
    const cardFile = readdirSync(dd1).filter((f) => /^card-\d+\.json$/.test(f)).sort().pop();
    if (cardFile) {
      const job = JSON.parse(readFileSync(join(dd1, cardFile), 'utf8')).job;
      out.bar3.redraft = { card: cardFile, hasProposalLine: job.split('\n').some((l) => l === `~ ${f1.proposal}`), hasWhyNotLine: job.split('\n').some((l) => l === '~ agree, why not') };
    } else out.bar3.redraft = 'no card written';
  } finally { rmSync(tmpRoot, { recursive: true, force: true }); }
}
console.log(JSON.stringify(out, null, 1));
