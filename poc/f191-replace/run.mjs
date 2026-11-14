// F191 POC ($0): bareloop v0.57.0's one-rule-in-one-rule-out, ported (vendor/), against fwd's CURRENT block (src/), on fwd's real saved drafts.
// `node poc/f191-replace/run.mjs` -> per-bar lines on stdout (tee into result-1.log). Reads ~/.config/fwdloop/flows READ-ONLY. No provider, no key, no network.
// Pre-registration: docs/logs/FINDINGS.md "F191 PRE-REGISTERED". The bars are read there, not here; nothing below changes them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FIX = (f) => fs.readFileSync(path.join(ROOT, 'test/fixtures/m16-block', f), 'utf8');
const FLOWS = path.join(os.homedir(), '.config/fwdloop/flows');

const { CheckBlock: CurBlock } = await import(path.join(ROOT, 'src/checkblock.js'));
const { CheckBlock: NewBlock } = await import(path.join(HERE, 'vendor/checkblock.js'));
const { obviousCheck } = await import(path.join(HERE, 'vendor/blockpick.js'));
const { entriesFromAnswers, matchRecord } = await import(path.join(HERE, 'vendor/pickrecord.js'));
const { blockJobLines } = await import(path.join(ROOT, 'src/blocklines.js'));
const { applyAnswers } = await import(path.join(ROOT, 'src/panel/authorcard.js'));
const { assembleFromBlock } = await import(path.join(ROOT, 'src/blockassemble.js'));
const { parseSignedText } = await import(path.join(ROOT, 'src/signed-text.js'));

const results = {};
const say = (s) => console.log(s);
const verdict = (bar, v, why) => { results[bar] = v; say(`BAR ${bar}: ${v}${why ? ` - ${why}` : ''}`); };

const mk = (Block, texts, jobLines, look) => {
  const b = new Block({ texts, labels: Object.keys(texts), asks: true, split: true, cited: false });
  b.fromJob(jobLines);
  if (look) b.addLook(look.facts, look.dropped);
  b.reconcile();
  return b;
};
const rulesOn = (b, n) => b.ruleRows(n).map((r) => ({ rule: r.rule, text: r.text }));
const askedOf = (b) => b.open.map((q) => ({ line: q.line, rowKey: q.rowKey, ask: q.ask, ruleText: q.ruleText }));

/** the job box with the `~` lines of every step replaced by one `~ rule` per rule of `view` (a step's number counts every non-`~` line, as appendAnswersToJob does) */
function renderJob(job, view) {
  const rulesOf = new Map(view.map((l) => [l.n, l.rules]));
  const out = [];
  let step = 0;
  let emitted = new Set();
  const flush = () => { if (step > 0 && rulesOf.has(step) && !emitted.has(step)) { for (const r of rulesOf.get(step)) out.push(`~ ${r}`); emitted.add(step); } };
  for (const raw of job.split('\n')) {
    const t = raw.trim();
    if (t === '') { out.push(raw); continue; }
    if (t.startsWith('~')) continue;
    flush();
    step += 1;
    out.push(raw);
  }
  flush();
  // a step's `~` lines come right after the step line: re-insert by walking again (simple pass: rules emitted at flush of the NEXT step line would be out of place), so build precisely instead
  return out;
}
// precise version: rules go right after their own step line
function renderJob2(job, view) {
  const rulesOf = new Map(view.map((l) => [l.n, l.rules]));
  const out = [];
  let step = 0;
  for (const raw of job.split('\n')) {
    const t = raw.trim();
    if (t === '') { out.push(raw); continue; }
    if (t.startsWith('~')) continue;
    step += 1;
    out.push(raw);
    for (const r of rulesOf.get(step) ?? []) out.push(`~ ${r}`);
  }
  return out.join('\n');
}
void renderJob;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// the real saved data
const notes = FIX('m14-walk-5/notes.md');
const prose = FIX('m14-walk-5/prose.txt');
const m14 = {};
for (const f of ['walk-m16-m14', 'walk-m16-m14b']) {
  const rows = fs.readFileSync(path.join(FLOWS, f, 'setup.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const cards = rows.filter((r) => r.kind === 'card');
  m14[f] = { card0: cards[0].card.job, card1: cards[1].card.job, humans: rows.filter((r) => r.kind === 'human') };
}
const signedProse = fs.readFileSync(path.join(FLOWS, 'walk-m16-m14/prose.txt'), 'utf8');
const signedDecl = JSON.parse(fs.readFileSync(path.join(FLOWS, 'walk-m16-m14/declaration.json'), 'utf8'));
const jl = blockJobLines(prose);
const jobLines = jl.jobLines;
say(`data: m14 flows ${Object.keys(m14).join(', ')}; saved answers per flow: ${Object.values(m14).map((x) => x.humans.length).join(', ')}; block lines ${jobLines.map((l) => l.n).join(',')}`);

// ---- Bar 1
say('\n== BAR 1: one rule in, one rule out');
let b1 = true;
const why1 = [];
const fail1 = (s) => { b1 = false; why1.push(s); say(`  FAIL: ${s}`); };

// (a) control: CURRENT reproduces card 1 byte-for-byte
let controlOk = true;
for (const [f, d] of Object.entries(m14)) {
  const cur = mk(CurBlock, { notes }, jobLines);
  const qs = cur.open.map((q) => ({ line: q.line, ruleText: q.ruleText, proposal: q.proposal }));
  const all = d.humans.map((h) => ({ line: h.line, rule: h.rule, left: false, ruleNo: h.ruleNo, ruleText: h.ruleText, ask: 'check', check: null }));
  const grown = applyAnswers(d.card0, all).job;
  const same = grown === d.card1;
  say(`  (a) ${f}: CURRENT applyAnswers(card0, saved answers) === saved card 1: ${same}; CURRENT block asks ${qs.length} (${qs.map((q) => `L${q.line} "${q.ruleText}"`).join('; ')})`);
  if (!same) controlOk = false;
  const rc = (job) => (job.match(/^~ /gm) ?? []).length;
  say(`      ~ rules in card0 ${rc(d.card0)}, saved card1 ${rc(d.card1)}`);
}

// (b) PORTED, same card0 job, same Agree answers
for (const [f, d] of Object.entries(m14)) {
  const b = mk(NewBlock, { notes }, jobLines);
  const before = Object.fromEntries(jobLines.map((l) => [l.n, b.ruleRows(l.n).length]));
  const applied = [];
  for (const h of d.humans) {
    const q = b.open.find((x) => x.line === h.line && x.ruleText === h.ruleText);
    if (!q) { fail1(`(b) ${f}: no open question for L${h.line} "${h.ruleText}" in PORTED (asked: ${JSON.stringify(askedOf(b))})`); continue; }
    if (String(q.ask) !== 'check' && String(q.ask) !== 'reading') say(`      note: L${h.line} ask kind is ${q.ask}`);
    const r = b.applyAnswer(q.key, 'agree');
    applied.push({ key: q.key, ok: r.ok, why: r.why });
    if (!r.ok) fail1(`(b) ${f}: applyAnswer refused: ${r.why}`);
  }
  b.reconcile();
  const view = b.jobLinesView(jobLines);
  const job = renderJob2(d.card0, view);
  const expected = d.card0.split('\n').map((l) => { const t = l.trim(); const h = d.humans.find((x) => t === `~ ${x.ruleText}`); return h ? `~ ${h.proposal}` : l; }).join('\n');
  const after = Object.fromEntries(jobLines.map((l) => [l.n, b.ruleRows(l.n).length]));
  const counts = JSON.stringify(before) === JSON.stringify(after);
  const numbers = d.humans.every((h) => b.ruleRows(h.line).some((r) => r.rule === h.ruleNo && r.text === h.proposal));
  const noFollow = b.rows.every((r) => r.parent === undefined && r.pairWith === undefined);
  say(`  (b) ${f}: rule counts before ${JSON.stringify(before)} after ${JSON.stringify(after)}; rule no. kept and words = proposal: ${numbers}; no parent/pairWith rows: ${noFollow}; job === expected (card0 with each asked rule replaced by its proposal): ${job === expected}`);
  say(`      PORTED job text:\n${job.split('\n').map((l) => `        | ${l}`).join('\n')}`);
  if (!controlOk) continue;
  if (!counts) fail1(`(b) ${f}: per-line ~ counts changed`);
  if (!numbers) fail1(`(b) ${f}: a rule number or words differ`);
  if (!noFollow) fail1(`(b) ${f}: a follower row exists`);
  if (job !== expected) fail1(`(b) ${f}: job text differs from card0 with the replaced rules`);
  if (job === d.card1) fail1(`(b) ${f}: PORTED job equals the grown card 1`);
}

// (c) own words on line 3
{
  const b = mk(NewBlock, { notes }, jobLines);
  const q = b.open.find((x) => x.line === 3);
  const r = q ? b.applyAnswer(q.key, 'rule', 'exactly 3 items') : { ok: false, why: 'no question on line 3' };
  b.reconcile();
  const rr = rulesOn(b, 3);
  const okc = r.ok && rr.length === 1 && rr[0].text === 'exactly 3 items';
  say(`  (c) own words on L3: applied ${r.ok}; rules on line 3 ${JSON.stringify(rr)}`);
  if (!okc) fail1('(c) own-words answer did not leave exactly one rule with the typed words');
}

// (d) flights
const flightsJl = blockJobLines(FIX('flights/draft-prose.txt')).jobLines;
const flightsLook = JSON.parse(FIX('flights/page-look.json')).look;
const flightsTexts = { flights: FIX('flights/flights.txt') };
const agreeAll = (b) => { b.drive({ answer: (q) => (q.offers.agree ? { choice: 'agree' } : null) }); return b.reconcile(); };
let flightsCur;
{
  const cur = mk(CurBlock, flightsTexts, flightsJl, flightsLook);
  const nb = Object.fromEntries(flightsJl.map((l) => [l.n, cur.ruleRows(l.n).length]));
  agreeAll(cur);
  const na = Object.fromEntries(flightsJl.map((l) => [l.n, cur.ruleRows(l.n).length]));
  flightsCur = { nb, na, followers: cur.rows.filter((r) => r.parent !== undefined).length };
  say(`  (d) flights CURRENT: ~ per line before ${JSON.stringify(nb)} after Agree-all ${JSON.stringify(na)}; follower rows ${flightsCur.followers}`);
  const p = mk(NewBlock, flightsTexts, flightsJl, flightsLook);
  const pb = Object.fromEntries(flightsJl.map((l) => [l.n, p.ruleRows(l.n).length]));
  const openBefore = p.open.length;
  agreeAll(p);
  const pa = Object.fromEntries(flightsJl.map((l) => [l.n, p.ruleRows(l.n).length]));
  const fol = p.rows.filter((r) => r.parent !== undefined).length;
  say(`  (d) flights PORTED: open before ${openBefore}; ~ per line before ${JSON.stringify(pb)} after Agree-all ${JSON.stringify(pa)}; follower rows ${fol}; open after ${p.open.length}`);
  if (JSON.stringify(pb) !== JSON.stringify(pa)) fail1('(d) flights: per-line ~ count changed after Agree-all');
  if (fol !== 0) fail1('(d) flights: follower rows exist');
  if (flightsCur.followers < 1) say('  (d) note: CURRENT gave no follower on this data, so the control for (d) did not show the old behaviour');
}

// (e) the live-failure job
{
  const sp = blockJobLines(signedProse);
  const e = mk(NewBlock, { notes }, sp.jobLines);
  const before = Object.fromEntries(sp.jobLines.map((l) => [l.n, e.ruleRows(l.n).length]));
  const asked = askedOf(e);
  agreeAll(e);
  const after = Object.fromEntries(sp.jobLines.map((l) => [l.n, e.ruleRows(l.n).length]));
  say(`  (e) live-failure job (signed prose of walk-m16-m14): PORTED asks ${JSON.stringify(asked)}; ~ per line before ${JSON.stringify(before)} after Agree-all ${JSON.stringify(after)}; rules after ${JSON.stringify(sp.jobLines.map((l) => e.ruleRows(l.n).map((r) => r.text)))}`);
  const ok = Object.keys(before).every((k) => before[k] === after[k]) && after[3] === 2 && after[5] === 2;
  if (!ok) fail1('(e) the line did not keep exactly its 2 rules');
}
if (!controlOk) { verdict(1, 'INCONCLUSIVE', 'control (a): CURRENT did not reproduce the saved card 1 byte-for-byte'); } else verdict(1, b1 ? 'PASS' : 'FAIL', why1.join(' | '));

// ---- Bar 2
say('\n== BAR 2: an obvious count rule is not asked');
let b2 = true;
const why2 = [];
const afterJob = jobLines.map((l) => (l.n === 3 ? { ...l, rules: ['exactly 3 list items'] } : l.n === 5 ? { ...l, rules: ['at most 80 words'] } : l));
for (const [name, Block] of [['CURRENT', CurBlock], ['PORTED', NewBlock]]) {
  const b = mk(Block, { notes }, afterJob);
  const q = b.open.filter((x) => x.line === 3 || x.line === 5);
  const rr = [3, 5].map((n) => b.ruleRows(n).map((r) => ({ line: n, text: r.text, state: r.state, hasPick: !!r.pick })));
  say(`  fresh block from the post-Agree job, ${name}: open on L3/L5 ${JSON.stringify(q.map((x) => ({ line: x.line, ruleText: x.ruleText, ask: x.ask })))}; rule rows ${JSON.stringify(rr.flat())}`);
  if (name === 'PORTED') {
    if (q.length !== 0) { b2 = false; why2.push(`fresh PORTED asks ${q.length} on L3/L5`); }
    if (!rr.flat().every((r) => r.state === 'built' && r.hasPick)) { b2 = false; why2.push('a L3/L5 rule row is not built with a pick'); }
  }
  if (name === 'CURRENT') var curAsksFresh = q.length;
}
say(`  obviousCheck("exactly 3 bullets") = ${JSON.stringify(obviousCheck('exactly 3 bullets'))}; ("exactly 3 list items") = ${JSON.stringify(obviousCheck('exactly 3 list items'))}; ("under 80 words") = ${JSON.stringify(obviousCheck('under 80 words'))}; ("at most 80 words") = ${JSON.stringify(obviousCheck('at most 80 words'))}`);
// the registered Revise variant: ORIGINAL card-0 job plus the carry of the two picks
const d0 = Object.values(m14)[0];
const pickedBlock = mk(NewBlock, { notes }, jobLines);
const picks = [];
for (const h of d0.humans) { const q = pickedBlock.open.find((x) => x.line === h.line && x.ruleText === h.ruleText); picks.push({ line: h.line, rule: h.ruleNo, check: q ? q.proposal : null, q }); }
for (const p of picks) pickedBlock.applyAnswer(p.q.key, 'agree');
pickedBlock.reconcile();
const finalRules = [].concat(...jobLines.map((l) => pickedBlock.ruleRows(l.n).map((r) => ({ line: l.n, rule: r.rule, text: r.text }))));
const ents = entriesFromAnswers(jobLines, finalRules, picks.map((p) => ({ line: p.line, rule: p.rule, check: pickedBlock.ruleRows(p.line).find((r) => r.rule === p.rule)?.pick ?? null })), []);
{
  // registered: original card-0 job + carry
  const origRules = [].concat(...jobLines.map((l) => l.rules.map((t, i) => ({ line: l.n, rule: i + 1, text: t }))));
  const m = matchRecord(ents, jobLines, origRules);
  const b = mk(NewBlock, { notes }, jobLines);
  b.carry({ picks: m.picks, left: m.left });
  b.reconcile();
  const q = b.open.filter((x) => x.line === 3 || x.line === 5);
  say(`  REGISTERED Revise (original card-0 job + carry of the saved picks): matchRecord kept ${m.picks.length} picks, asks ${m.askRules.length}; open on L3/L5 ${JSON.stringify(q.map((x) => ({ line: x.line, ruleText: x.ruleText, ask: x.ask })))}`);
  if (q.length !== 0) { b2 = false; why2.push(`registered Revise (original job + carry) asks ${q.length} on L3/L5`); }
  // unregistered observation: the job box as the person has it after the Agree (replaced rules) + carry
  const m2 = matchRecord(ents, afterJob, [].concat(...afterJob.map((l) => l.rules.map((t, i) => ({ line: l.n, rule: i + 1, text: t })))));
  const b3 = mk(NewBlock, { notes }, afterJob);
  b3.carry({ picks: m2.picks, left: m2.left });
  b3.reconcile();
  const q3 = b3.open.filter((x) => x.line === 3 || x.line === 5);
  say(`  OBSERVATION (not registered): Revise on the replaced job + carry: kept ${m2.picks.length} picks; open on L3/L5 ${q3.length}`);
}
if (curAsksFresh === 0) verdict(2, 'INCONCLUSIVE', 'CURRENT also asks 0 on the fresh post-Agree job; the bar cannot fail on this data' + (b2 ? '' : ` (PORTED: ${why2.join(' | ')})`));
else verdict(2, b2 ? 'PASS' : 'FAIL', why2.join(' | ') + ` (CURRENT asks ${curAsksFresh} on the fresh post-Agree job)`);

// ---- Bar 3
say('\n== BAR 3: Not checked names each rule once');
let b3ok = true;
const why3 = [];
const stepsLines = parseSignedText(signedProse).lines.map((l) => ({ n: l.n, guardrail: l.guardrail }));
const sheetOf = (name, Block, texts, jlines, look, dropAll, lineSetNums, decl, lines) => {
  const b = mk(Block, texts, jlines, look);
  if (dropAll) b.drive({ answer: () => ({ choice: 'drop' }) }); // every open question: drop it
  b.reconcile();
  const out = assembleFromBlock({ declaration: JSON.parse(JSON.stringify(decl)), block: b, lines, lineSet: new Set(lineSetNums) });
  const rows = b.signedRows().filter((r) => r.kind === 'rule');
  const per = new Map();
  for (const r of rows) per.set(`${r.line}.${r.rule}`, (per.get(`${r.line}.${r.rule}`) ?? 0) + 1);
  const dup = [...per].filter(([, n]) => n > 1);
  const says = [...new Set(b.rows.filter((r) => r.kind === 'rule').map((r) => `${r.line}.${r.rule}`))].filter((k) => { const [l, n] = k.split('.').map(Number); return b.rows.some((r) => r.kind === 'rule' && r.line === l && r.rule === n && r.state === 'not-checked'); });
  const saysOk = typeof b.saysRule === 'function' ? says.every((k) => { const [l, n] = k.split('.').map(Number); return b.saysRule(l, n); }) : null;
  // a rule named twice: the Not-checked sentences naming one rule's words
  const nameCount = rows.map((r) => ({ key: `${r.line}.${r.rule}`, n: out.notChecked.filter((s) => s.includes(`"${b.rows.find((x) => x.key === r.key)?.text}"`)).length }));
  return { name, openAfter: b.open.length, rowsPerRuleDup: dup, notChecked: out.notChecked, nameCount, saysOk, saysKeys: says };
};
{
  // m14 signed declaration (real): the two asked rules dropped. Use the card-0 lines: declaration steps cover lines 1..9; lineSet = block lines
  const lineSet = jobLines.map((l) => l.n);
  const results3 = [];
  for (const [nm, Block] of [['CURRENT', CurBlock], ['PORTED', NewBlock]]) {
    results3.push(sheetOf(`m14/${nm}`, Block, { notes }, jobLines, null, true, lineSet, signedDecl, stepsLines));
  }
  // flights: the real draft prose and look; the declaration is not saved with the fixture, so a minimal step per line stands in (assembleFromBlock reads steps' fromLine only for the close it builds)
  const fl = FIX('flights/draft-prose.txt');
  const fp = parseSignedText(fl);
  const fDecl = { steps: fp.lines.map((l) => ({ fromLine: l.n, close: {} })) };
  const fLines = fp.lines.map((l) => ({ n: l.n, guardrail: l.guardrail }));
  for (const [nm, Block] of [['CURRENT', CurBlock], ['PORTED', NewBlock]]) {
    results3.push(sheetOf(`flights/${nm}`, Block, flightsTexts, flightsJl, flightsLook, true, flightsJl.map((l) => l.n), fDecl, fLines));
  }
  for (const r of results3) {
    say(`  ${r.name}: open after drop-all ${r.openAfter}; signed rule rows duplicated per (line,rule): ${JSON.stringify(r.rowsPerRuleDup)}; sentences naming a rule's words: ${JSON.stringify(r.nameCount.filter((x) => x.n !== 1))} (others exactly 1); Not-checked ${r.notChecked.length} sentences; saysRule true for every not-checked rule: ${r.saysOk}`);
    if (r.name.endsWith('PORTED')) {
      if (r.rowsPerRuleDup.length) { b3ok = false; why3.push(`${r.name}: a rule has 2 signed rows`); }
      if (r.nameCount.some((x) => x.n > 1)) { b3ok = false; why3.push(`${r.name}: a rule is named twice`); }
      if (r.saysOk === false) { b3ok = false; why3.push(`${r.name}: saysRule false for a not-checked rule`); }
    }
  }
  const curDupe = results3.filter((r) => r.name.endsWith('CURRENT')).some((r) => r.rowsPerRuleDup.length || r.nameCount.some((x) => x.n > 1));
  say(`  CURRENT already names each rule once on this data: ${!curDupe} (so the bar ${curDupe ? 'shows a gain' : 'cannot show a gain; PASS stands on the letter, flagged'})`);
}
verdict(3, b3ok ? 'PASS' : 'FAIL', why3.join(' | '));
say('  other fwd writers of Not-checked sentences for a `~` rule (read, not run): see the report; none is part of this bar.');

// ---- Bar 4
say('\n== BAR 4: $0 rescan of the good signed jobs (F190 method), BEFORE = HEAD, AFTER = HEAD + ported files');
{
  const scratch = fs.mkdtempSync(path.join(process.env.F191_TMP ?? os.tmpdir(), 'f191-'));
  const before = path.join(scratch, 'before');
  const after = path.join(scratch, 'after');
  const sh = (cmd, args, opt = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 150000, maxBuffer: 64 * 1024 * 1024, ...opt });
  for (const d of [before, after]) {
    fs.mkdirSync(d);
    const tar = sh('git', ['-C', ROOT, 'archive', 'HEAD'], { encoding: 'buffer' });
    fs.writeFileSync(path.join(scratch, 'a.tar'), tar);
    sh('tar', ['-xf', path.join(scratch, 'a.tar'), '-C', d]);
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(d, 'node_modules'));
  }
  for (const f of ['checkblock', 'blockpick', 'blockasks', 'pickrecord']) {
    const txt = fs.readFileSync(path.join(HERE, 'vendor', `${f}.js`), 'utf8').replace(/from '\.\.\/\.\.\/\.\.\/src\//g, "from './");
    fs.writeFileSync(path.join(after, 'src', `${f}.js`), txt);
  }
  const run = (tree) => sh('node', [path.join(tree, 'poc/f190-rescan/run.mjs'), tree]);
  const ob = run(before);
  const oa = run(after);
  const lines = (s) => s.trim().split('\n');
  const flowsOf = (s) => lines(s).map((l) => JSON.parse(l)).filter((j) => j.k === 'flow');
  const fb = flowsOf(ob);
  const fa = flowsOf(oa);
  const acceptedB = fb.filter((x) => x.ok).length;
  const acceptedA = fa.filter((x) => x.ok).length;
  const newlyRefused = fb.filter((x) => x.ok).filter((x) => !fa.find((y) => y.flow === x.flow)?.ok).map((x) => x.flow);
  const identical = ob === oa;
  say(`  signed flows: BEFORE accepted ${acceptedB}/${fb.length}; AFTER accepted ${acceptedA}/${fa.length}; newly refused in AFTER: ${JSON.stringify(newlyRefused)}; JSONL lines BEFORE ${lines(ob).length} AFTER ${lines(oa).length}; byte-identical: ${identical}`);
  // does the F190 run path import the ported files at all?
  const seen = new Set();
  const crawl = (f) => {
    const abs = path.resolve(f);
    if (seen.has(abs) || !abs.startsWith(path.join(ROOT, 'src')) || !fs.existsSync(abs)) return;
    seen.add(abs);
    const txt = fs.readFileSync(abs, 'utf8');
    for (const m of txt.matchAll(/from '(\.[^']+)'|import\('(\.[^']+)'\)/g)) crawl(path.resolve(path.dirname(abs), m[1] ?? m[2]));
  };
  for (const e of ['flow.js', 'catalogue.js', 'signed-text.js', 'sheetchecks.js', 'sheetrun.js']) crawl(path.join(ROOT, 'src', e));
  const reached = ['checkblock.js', 'blockpick.js', 'blockasks.js', 'pickrecord.js'].filter((f) => seen.has(path.join(ROOT, 'src', f)));
  say(`  F190 run path (flow.js, catalogue.js, signed-text.js, sheetchecks.js, sheetrun.js) imports ${seen.size} src files; of the four ported files it reaches: ${JSON.stringify(reached)}`);
  const ok = newlyRefused.length === 0 && identical;
  verdict(4, ok ? 'PASS' : 'FAIL', (ok ? '' : 'differences present; ') + (reached.length === 0 ? 'VACUOUS for the block path: the F190 run path never imports the ported files' : `reaches ${reached.join(', ')}`));
  fs.rmSync(scratch, { recursive: true, force: true });
}

say(`\nSUMMARY ${JSON.stringify(results)}`);
