// F146b (pre-registered in docs/logs/FINDINGS.md): M10 am18, $0, no src/ change, no provider, no key.
// A kept pick follows its job line's words + the guardrail's exact words, never the line number. The decision function lives HERE only.
// Run: node poc/m10-am17/keep-picks-am18.mjs   (one line per bar, then the must-fail line per bar; exit 1 if any bar is not as registered)
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readQuestions } from '../../src/authoring.js';
import { ruleOfAnswer } from '../../src/pageask.js';
import { cardFields, cardToProse } from '../../src/panel/authorcard.js';
import { parseSignedText } from '../../src/signed-text.js';
import { scopedRules, settleRules } from '../../src/checkpick.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixture');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2));
const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
const ok = [];

const parseCard = (card) => { const p = parseSignedText(cardToProse(cardFields(card))); assert.ok(p.ok, `card does not parse: ${p.reds}`); return p; };
// the line key: the line's own words + how many lines before it have the same words (duplicates match in order)
function lineKeys(parsed) {
  const seen = new Map();
  return new Map(parsed.lines.map((l) => { const w = norm(l.text); const o = seen.get(w) ?? 0; seen.set(w, o + 1); return [l.n, `${w}#${o}`]; }));
}

// ---- the record, read from disk (bar g): card.json (line words), questions.json (line, ruleNo, ruleText), answer-K.json (rule = the added `~` line) ----------------
// One pick = { lineKey, ruleText (source guardrail), added (the `~` line an agree/own answer wrote, or null), check|null, own, left }.
function picksFromDisk(dir) {
  const marker = readJson(path.join(dir, 'redraft-1.json'));
  const planDir = path.join(dir, marker.fromPlan);
  const keys = lineKeys(parseCard(readJson(path.join(dir, 'card.json'))));
  const { questions } = readQuestions(planDir);
  const picks = [];
  for (const q of questions) {
    if (q.answer === null || q.source !== 'look' || !(q.ask === 'check' || q.ask === 'no-check')) continue;
    const eff = ruleOfAnswer(q, q.answer);
    // `added` comes from the answer file's own `rule` field; it has to agree with what the real ruleOfAnswer makes of the answer
    picks.push({ lineKey: keys.get(q.line), ruleText: q.ruleText, added: q.rule ?? null, addedByCode: eff.rule, check: eff.check ?? null, own: !!eff.own, left: !!eff.left });
  }
  return picks;
}

// ---- the keep/ask decision (POC only) ------------------------------------------------------------------------------------------------------------------------
// A pick is intact when, on the card's matching line (same words, same order among equal lines), its source guardrail AND (if it has one) its added line are both
// still there with the exact words. Intact: the source keeps its pick, the added line is settled. Broken: both are asked (whatever of them is still there).
function decide(picks, card) {
  const parsed = parseCard(card);
  const keys = lineKeys(parsed);
  const rules = scopedRules(parsed.lines, parsed.arbiter);
  const has = (line, text) => rules.some((r) => r.line === line && norm(r.text) === norm(text));
  const lineOf = (k) => [...keys].find(([, v]) => v === k)?.[0];
  const kept = []; const keptLeft = []; const settledAdded = []; const brokenPicks = [];
  const intact = new Set();
  for (const p of picks) {
    const n = lineOf(p.lineKey);
    if (n === undefined) { brokenPicks.push(p); continue; } // the line's own words changed (or it is gone): a new line
    if (has(n, p.ruleText) && (p.added === null || has(n, p.added))) intact.add(p); else brokenPicks.push(p);
  }
  const asks = [];
  for (const r of rules) {
    let hit = null;
    for (const p of intact) {
      if (lineOf(p.lineKey) !== r.line) continue;
      if (norm(p.ruleText) === norm(r.text)) { hit = { p, as: 'source' }; break; }
      if (p.added !== null && norm(p.added) === norm(r.text)) { hit = { p, as: 'added' }; break; }
    }
    if (!hit) asks.push(r);
    else if (hit.as === 'added') settledAdded.push(r);
    else if (hit.p.left) keptLeft.push({ line: r.line, rule: r.rule });
    else kept.push({ line: r.line, rule: r.rule, check: hit.p.check, added: hit.p.added ?? undefined, ...(hit.p.own ? { own: true } : {}) });
  }
  const askSet = new Set(asks.map((a) => `${a.line}:${a.rule}`));
  const keptRules = rules.filter((r) => !askSet.has(`${r.line}:${r.rule}`));
  const settled = settleRules(keptRules, kept, keptLeft);
  return { rules, kept, keptLeft, settledAdded, asks, settled, brokenPicks, keys };
}

const baseCard = () => readJson(path.join(FIX, 'card-1.json'));
const withJob = (fn) => { const c = baseCard(); return { ...c, job: fn(c.job.split('\n')).join('\n') }; };
const asksOf = (d) => d.asks.map((a) => `${a.line}:${a.text}`);
const fmt = (d) => `asks ${JSON.stringify(asksOf(d))} kept ${JSON.stringify(d.kept.map((k) => k.line))}${d.keptLeft.length ? ` left ${JSON.stringify(d.keptLeft.map((k) => k.line))}` : ''}`;
const maxWords80 = (d, line) => (d.settled.checks.get(line) ?? []).some((c) => c.rule === 'maxWords' && c.value === 80);

function scratch(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-f146b-'));
  try { cpSync(FIX, dir, { recursive: true }); return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- bars -------------------------------------------------------------------------------------------------------------------------------------------------------------
function barA(dir, { alsoEdit = false } = {}) {
  let card = withJob((l) => ['Intro line from the top', ...l]);
  if (alsoEdit) card = { ...card, job: card.job.replace('~ exactly 3 bullets', '~ exactly 4 bullets') };
  const d = decide(picksFromDisk(dir), card);
  const lines = d.kept.map((k) => k.line);
  return { pass: d.asks.length === 0 && JSON.stringify(lines) === '[4,6]' && d.settled.checks.get(4)?.[0]?.rule === 'listItems' && maxWords80(d, 6), why: fmt(d) };
}
function barB(dir, { alsoEdit = false } = {}) {
  let card = withJob((l) => [...l.slice(0, 2), ...l.slice(6, 10), ...l.slice(2, 6), l[10]]); // closing-note block first, list-jobs block second
  if (alsoEdit) card = { ...card, job: card.job.replace('~ exactly 3 bullets', '~ exactly 4 bullets') };
  const d = decide(picksFromDisk(dir), card);
  return { pass: d.asks.length === 0 && JSON.stringify(d.kept.map((k) => k.line)) === '[3,5]' && maxWords80(d, 3) && d.settled.checks.get(5)?.[0]?.rule === 'listItems', why: fmt(d) };
}
function barC(dir, { mode = 'added' } = {}) {
  const job = { added: (s) => s.replace('~ at most 80 words', '~ at most 60 words'), source: (s) => s.replace('~ under 80 words', '~ under 60 words'), none: (s) => s }[mode];
  const c = baseCard();
  const d = decide(picksFromDisk(dir), { ...c, job: job(c.job) });
  const onlyLine5 = d.asks.length > 0 && d.asks.every((a) => a.line === 5);
  return { pass: onlyLine5 && d.kept.length === 1 && d.kept[0].line === 3 && !maxWords80(d, 5), why: `${fmt(d)} maxWords80 on 5: ${maxWords80(d, 5)}` };
}
function barD(dir, { alsoOther = false } = {}) {
  let c = baseCard(); c = { ...c, job: c.job.replace('List 3 jobs for this week from the notes', 'List 4 chores for next week from the notes') };
  if (alsoOther) c = { ...c, job: c.job.replace('Write a short closing note to my neighbour', 'Write a short closing note to my cousin') };
  const d = decide(picksFromDisk(dir), c);
  return { pass: d.asks.length > 0 && d.asks.every((a) => a.line === 3) && d.kept.length === 1 && d.kept[0].line === 5 && maxWords80(d, 5) && !d.settled.checks.has(3), why: fmt(d) };
}
// (e) and (f) need plan dirs of their own shape: rewrite card.json / questions.json / answer-K.json of the fixture copy
function rewritePlan(dir, { job, questions, answers }) {
  const card = readJson(path.join(dir, 'card.json')); writeJson(path.join(dir, 'card.json'), { ...card, job });
  writeJson(path.join(dir, 'draft', 'questions.json'), { questions });
  for (const a of ['answer-1.json', 'answer-2.json']) rmSync(path.join(dir, 'draft', a), { force: true });
  answers.forEach((a, i) => writeFileSync(path.join(dir, 'draft', `answer-${i + 1}.json`), JSON.stringify(a) + '\n'));
}
const NOTE = 'Write a short closing note to my neighbour';
const q = (line, ruleNo, ruleText, proposal, check) => ({ line, question: `Line ${line}, guardrail "${ruleText}"`, source: 'look', ask: 'check', ruleNo, ruleText, proposal, check });
const ans = (k, line, ruleNo, ruleText, answer, rule) => ({ k, line, question: 'q', answer, at: '2026-11-04T00:00:00.000Z', source: 'look', ask: 'check', ruleNo, ruleText, proposal: 'at most 80 words', ...(rule ? { rule } : {}) });
const MW = { rule: 'maxWords', value: 80 };
function barE(dir, { reversed = false } = {}) {
  // two lines with the same words; the first is agreed (a check), the second is Not checked
  const asked = `${NOTE}\n~ under 80 words\nAsk 1h: check it with me\n${NOTE}\n~ under 80 words\nAsk 1h: check it with me\nWrite it out`;
  const answers = reversed ? [ans(1, 1, 1, 'under 80 words', 'drop it'), ans(2, 3, 1, 'under 80 words', 'agree', 'at most 80 words')]
    : [ans(1, 1, 1, 'under 80 words', 'agree', 'at most 80 words'), ans(2, 3, 1, 'under 80 words', 'drop it')];
  rewritePlan(dir, { job: asked, questions: [q(1, 1, 'under 80 words', 'at most 80 words', MW), q(3, 1, 'under 80 words', 'at most 80 words', MW)], answers });
  // the card after the first answer-redraft: the agreed line grew its `~ at most 80 words`; the second line is untouched; the stored picks above stay as they were
  const revise = { ...readJson(path.join(dir, 'card-1.json')), job: `${NOTE}\n~ under 80 words\n~ at most 80 words\nAsk 1h: check it with me\n${NOTE}\n~ under 80 words\nAsk 1h: check it with me\nWrite it out` };
  const picks = picksFromDisk(dir);
  const d = decide(picks, revise);
  const first = d.settled.checks.get(1)?.[0]; const second = d.settled.checks.get(3);
  return { pass: d.asks.length === 0 && first?.rule === 'maxWords' && second === undefined && d.keptLeft.length === 1 && d.keptLeft[0].line === 3, why: `${fmt(d)} first ${JSON.stringify(first)} second ${JSON.stringify(second)}` };
}
function barF(dir, { alsoChange = false } = {}) {
  // line 5 carried `~ plain tone` (no check suggested, not asked) before the picked rule: the picked rule was rule 2
  const asked = `Write a short closing note to my neighbour\n~ plain tone\n~ under 80 words\nAsk 1h: check it with me\nWrite it out`;
  rewritePlan(dir, { job: asked, questions: [q(1, 2, 'under 80 words', 'at most 80 words', MW)], answers: [ans(1, 1, 2, 'under 80 words', 'agree', 'at most 80 words')] });
  const before = `${NOTE}\n~ plain tone\n~ under 80 words\n~ at most 80 words\nAsk 1h: check it with me\nWrite it out`;
  let after = `${NOTE}\n~ under 80 words\n~ at most 80 words\nAsk 1h: check it with me\nWrite it out`; // `~ plain tone` deleted
  if (alsoChange) after = after.replace('~ under 80 words', '~ under 70 words');
  const base = readJson(path.join(dir, 'card-1.json'));
  const pre = decide(picksFromDisk(dir), { ...base, job: before }); // sanity: unedited, the pick sits on rule 2
  const d = decide(picksFromDisk(dir), { ...base, job: after });
  return { pass: pre.kept[0]?.rule === 2 && d.asks.length === 0 && d.kept.length === 1 && d.kept[0].rule === 1 && maxWords80(d, 1), why: `before: kept rule ${pre.kept[0]?.rule}; after: ${fmt(d)} kept rule ${d.kept[0]?.rule}` };
}
function barG(dir, { dropRule = false } = {}) {
  if (dropRule) for (const f of ['answer-1.json', 'answer-2.json']) { const p = path.join(dir, 'draft', f); const j = readJson(p); delete j.rule; writeFileSync(p, JSON.stringify(j) + '\n'); }
  const picks = picksFromDisk(dir);
  const fromFiles = picks.map((p) => `${p.ruleText} <- ${p.added}`);
  const agree = picks.every((p) => p.added !== null && p.added === p.addedByCode);
  return { pass: picks.length === 2 && agree && picks.every((p) => p.lineKey), why: `pairs from answer-K.json {line, ruleText, rule} + card.json: ${JSON.stringify(fromFiles)}; equals ruleOfAnswer's: ${agree}` };
}

// ---- run ---------------------------------------------------------------------------------------------------------------------------------------------------------------
const report = (name, r) => { ok.push(r.pass); console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name}  (${r.why})`); };
const red = (name, r) => { const pass = r.pass === false; ok.push(pass); console.log(`${pass ? 'RED-OK' : 'NOT-RED'}  ${name}  (${r.why})`); };
console.log('== bars as registered');
report('(a) a line inserted at the top: 0 asks, picks on lines 4 and 6', scratch(barA));
report('(b) two blocks swapped: 0 asks, picks follow (lines 3 and 5)', scratch(barB));
report('(c1) only the agree-added line edited 80->60: line 5 asked, line 3 kept, no maxWords 80', scratch((d) => barC(d, { mode: 'added' })));
report('(c2) only the source guardrail edited 80->60: line 5 asked, line 3 kept, no maxWords 80', scratch((d) => barC(d, { mode: 'source' })));
report('(d) job line 3 own words changed: its guardrails asked, line 5 kept', scratch(barD));
report('(e) two lines, identical words, different picks: matched in order', scratch(barE));
report('(f) an earlier ~ rule deleted: pick survives as rule 1, check carried', scratch(barF));
report('(g) the pairing is read from answer-K.json + card.json', scratch(barG));

console.log('== must-fail: each bar made red by breaking its input');
red('(a) insert AND edit another line\'s guardrail', scratch((d) => barA(d, { alsoEdit: true })));
red('(b) swap AND edit a guardrail', scratch((d) => barB(d, { alsoEdit: true })));
red('(c) edit nothing (pick must be asked)', scratch((d) => barC(d, { mode: 'none' })));
red('(d) also change the other line\'s words', scratch((d) => barD(d, { alsoOther: true })));
red('(e) the two stored picks in reverse order', scratch((d) => barE(d, { reversed: true })));
red('(f) the picked rule\'s words also changed', scratch((d) => barF(d, { alsoChange: true })));
red('(g) `rule` removed from the answer files', scratch((d) => barG(d, { dropRule: true })));

console.log('== recorded, not deciding');
scratch((d) => {
  const a = decide(picksFromDisk(d), (() => { const c = baseCard(); return { ...c, job: c.job.replace('~ at most 80 words', '~ at most 60 words') }; })());
  console.log(`(c1) the broken pair asks ${a.asks.length} rules (${JSON.stringify(asksOf(a))}) for ONE pick; a build folds them to one ask`);
  const e = decide(picksFromDisk(d), (() => { const c = baseCard(); return { ...c, job: c.job.replace('List 3 jobs for this week from the notes', 'List 4 chores') }; })());
  console.log(`(d) a changed line: its old agree-added line is a plain guardrail again and is asked too: ${JSON.stringify(asksOf(e))}`);
});
const all = ok.every(Boolean);
console.log(all ? 'ALL AS REGISTERED' : 'NOT ALL AS REGISTERED');
process.exit(all ? 0 : 1);
