// F236 harness ($0, no AI, no key, no network): a page phrase fact keeps only the first of its alternative words.
// Usage: node poc/walk-bugs/f236-phrase-anyof.mjs [--candidate]
//   no flag     = today's `checkCited` (src/citedcheck.js, unchanged) only: the baseline column
//   --candidate = also C1 (any-of, substring) and C2 (any-of, word edges) defined below; nothing under src/ changes
// Everything under ~/.config/fwdloop/flows and .claude/scratch/m19-walk-YBSm/flows is read only.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRubric, checkStep } from 'bareguard';
import { checkCited, buildCitedSpec, factPartReds, factClaims, sha256Text } from '../../src/citedcheck.js';

const CAND = process.argv.includes('--candidate');
const ROOTS = [join(homedir(), '.config/fwdloop/flows'), resolve('.claude/scratch/m19-walk-YBSm/flows')];
const out = [];
const say = (s = '') => { out.push(s); console.log(s); };

// ---- the candidate: a copy of checkCited whose phrase decide is `{phrases: anyOf, any: true, edges}` ----------------------
// a fact with `anyOf` is validated as a phrase fact on its first word (src's own validator), then its decide is replaced
async function checkCandidate({ part, text, results }, edges) {
  const sha = sha256Text(text);
  const none = { claims: [], evidence: [], sha256: sha };
  const plain = { ...part, facts: part.facts.map((f) => (f.anyOf ? { name: f.name, shape: 'phrase', phrase: f.anyOf[0] } : f)) };
  const reds = factPartReds(plain);
  if (reds.length) return { verdict: 'stopped', gapLines: [], fault: reds[0], ...none };
  let rubric;
  try {
    const spec = buildCitedSpec(plain, sha);
    const ds = spec.checkpoints.cited.checks[0].decides;
    part.facts.forEach((f, j) => { if (f.anyOf) ds[j] = { phrases: f.anyOf, any: true, edges }; });
    rubric = createRubric(spec);
  } catch (e) { return { verdict: 'stopped', gapLines: [], fault: `could not build: ${e.message}`, ...none }; }
  const claims = factClaims(plain, results);
  const r = await checkStep(rubric, 'cited', { count: claims.length, claims }, { inputs: { [part.source]: text } });
  if (r.verdict === 'stopped') return { verdict: 'stopped', gapLines: [], fault: r.fault ? `${r.fault.kind}: ${r.fault.detail}` : 'stopped', ...none };
  if (r.verdict === 'green') return { verdict: 'green', gapLines: [], fault: null, ...none };
  return { verdict: 'red', gapLines: r.full.gaps.map((g) => `${g.check ?? 'check'}: ${g.kind ?? 'failed'}`), fault: null, ...none };
}

// ---- an independent reference of the word-edge rule (ruling #69 text), no bareguard code ------------------------------------
const isWord = (ch) => ch !== undefined && /^[\p{L}\p{M}\p{Nd}]$/u.test(ch);
function refCarries(text, phrase) {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const p = phrase.toLowerCase();
  const cp = (s) => [...s];
  const T = cp(t); const P = cp(p);
  for (let i = 0; i + P.length <= T.length; i += 1) {
    if (T.slice(i, i + P.length).join('') !== P.join('')) continue;
    if (!isWord(T[i - 1]) && !isWord(T[i + P.length])) return true;
  }
  return false;
}
const subs = (text, phrase) => text.toLowerCase().includes(phrase.toLowerCase());

// ---- the universe ----------------------------------------------------------------------------------------------------------
function find(dir, name, acc = []) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) find(p, name, acc);
    else if (e.name === name) acc.push(p);
  }
  return acc;
}
const looks = ROOTS.flatMap((r) => find(r, 'page-look.json'));
const facts = []; // {file, role, line, name, words, kind, page, text}
for (const f of looks) {
  let j; try { j = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const pages = Array.isArray(j.pages) ? j.pages : [];
  for (const k of j.look?.facts ?? []) {
    if (k.shape !== 'phrase' && k.shape !== 'place') continue;
    const pg = pages.find((p) => p.role === k.source);
    let text = null;
    if (pg?.frozen) { const tp = join(dirname(f), 'pages', pg.frozen); if (existsSync(tp)) text = readFileSync(tp, 'utf8'); }
    const kind = Array.isArray(k.phrases) ? 'place' : ((k.words ?? []).length > 1 ? 'multi' : 'single');
    facts.push({ file: f, role: k.source, line: k.line, name: k.name, words: k.words ?? [], kind, page: pg?.sha256 ?? '', text });
  }
}
const uniq = (arr) => { const m = new Map(); for (const x of arr) m.set(`${x.page}|${x.line}|${x.name}|${x.words.join('\u0001')}`, x); return [...m.values()]; };

say(`F236 harness, mode: ${CAND ? 'today + candidate (C1 any-of substring, C2 any-of word edges)' : 'today only (baseline)'}`);
say(`page-look files read: ${looks.length}`);
// (a)
const raw = (k) => facts.filter((x) => x.kind === k);
for (const k of ['multi', 'single', 'place']) say(`(a) ${k === 'multi' ? 'plain phrase facts with more than one word' : k === 'single' ? 'plain phrase facts with exactly one word' : 'place facts (carry phrases, all-of, unchanged)'}: raw ${raw(k).length}, unique ${uniq(raw(k)).length}`);
const plainU = uniq([...raw('multi'), ...raw('single')]);
say(`(a) share of plain phrase facts that are multi-word: ${uniq(raw('multi')).length} of ${plainU.length} unique (${plainU.length ? Math.round((100 * uniq(raw('multi')).length) / plainU.length) : 0}%); in ${new Set(raw('multi').map((x) => x.file.split('/.drafts/')[1]?.split('/')[0] ?? x.file)).size} distinct drafts of ${new Set(facts.map((x) => x.file.split('/.drafts/')[1]?.split('/')[0] ?? x.file)).size} with any phrase fact`);
for (const x of uniq(raw('multi'))) say(`    multi: page role "${x.role}" line ${x.line} "${x.name}" words ${JSON.stringify(x.words)}${x.text === null ? ' [page text not saved]' : ''}`);
const wantA = uniq(raw('multi')).filter((x) => x.name === 'airline name' || x.name === 'stop count');
say(`(a) the walk's airline and stops facts are listed: ${wantA.length >= 2}`);

if (!CAND) {
  // the baseline column: today's verdict on the walk's two facts with a quote of each other word
  for (const x of uniq(raw('multi')).filter((y) => y.text)) {
    const lines = x.text.split('\n').map((s) => s.trim()).filter(Boolean);
    for (const w of x.words.slice(1)) {
      const q = lines.find((l) => refCarries(l, w));
      if (!q) continue;
      const g = await checkCited({ part: { source: 'p', facts: [{ name: 'n', shape: 'phrase', phrase: x.words[0] }] }, text: x.text, results: [{ quote: q, values: {} }] });
      say(`  today: "${x.name}" signed "${x.words[0]}", quote holds "${w}": ${g.verdict}${g.gapLines[0] ? ` (${g.gapLines[0]})` : ''}`);
    }
  }
  mkdirSync('.claude/scratch/walk-bugs', { recursive: true });
  writeFileSync('.claude/scratch/walk-bugs/f236-baseline.txt', `${out.join('\n')}\n`);
  process.exit(0);
}

const lineOf = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean);
const mkPart = (x, anyOf) => ({ source: 'p', facts: [anyOf ? { name: 'n', shape: 'phrase', anyOf } : { name: 'n', shape: 'phrase', phrase: x.words[0] }] });
const run3 = async (x, anyOf, text, q) => {
  const res = [{ quote: q, values: {} }];
  const t = await checkCited({ part: mkPart(x, null), text, results: res });
  const c1 = await checkCandidate({ part: mkPart(x, anyOf), text, results: res }, false);
  const c2 = await checkCandidate({ part: mkPart(x, anyOf), text, results: res }, true);
  return { t, c1, c2 };
};

// (b) and (c)
let bN = 0; let bC2 = 0; let bC1 = 0; let bToday = 0; let bMust = 0; let bTodayRedOnMust = 0; let bStopped = 0;
const bFail = [];
let cN = 0; let cAllRed = 0; let cNone = 0;
for (const x of uniq(raw('multi')).filter((y) => y.text)) {
  const L = lineOf(x.text);
  const onPage = x.words.filter((w) => L.some((l) => refCarries(l, w)));
  for (const w of x.words.slice(1)) {
    const q = L.find((l) => refCarries(l, w));
    if (!q) continue;
    const r = await run3(x, onPage, x.text, q);
    bN += 1;
    if (r.c2.verdict === 'green') bC2 += 1; else bFail.push(`C2 ${r.c2.verdict} ${r.c2.fault ?? r.c2.gapLines[0] ?? ''} :: "${x.name}" word "${w}" line "${q.slice(0, 80)}"`);
    if (r.c1.verdict === 'green') bC1 += 1;
    if (r.t.verdict === 'green') bToday += 1;
    if (!subs(q, x.words[0])) { bMust += 1; if (r.t.verdict === 'red' && /does not say/.test(r.t.gapLines.join(' '))) bTodayRedOnMust += 1; }
    if (['airline name', 'stop count'].includes(x.name)) say(`  (b) "${x.name}" word "${w}" line "${q.slice(0, 70)}": today(${x.words[0]}) ${r.t.verdict}, C1 ${r.c1.verdict}, C2 ${r.c2.verdict}`);
  }
  const none = L.find((l) => !x.words.some((w) => subs(l, w)));
  if (!none) { cNone += 1; continue; }
  const r = await run3(x, onPage, x.text, none);
  cN += 1;
  if (r.t.verdict === 'red' && r.c1.verdict === 'red' && r.c2.verdict === 'red') cAllRed += 1;
  else say(`  (c) NOT all red: "${x.name}" ${r.t.verdict}/${r.c1.verdict}/${r.c2.verdict} line "${none.slice(0, 80)}"`);
}
say(`(b) cases (fact, word after the first, a real page line holding it): ${bN}; C2 green ${bC2}; C1 green ${bC1}; today green ${bToday}; cases whose line lacks the first word anywhere: ${bMust}, today red with "does not say" on ${bTodayRedOnMust}`);
for (const f of bFail) say(`    ${f}`);
say(`(b) ${bN > 0 && bC2 === bN && bTodayRedOnMust === bMust ? 'PASS' : 'FAIL'}`);
say(`(c) multi-word facts with a real page line holding none of their words: ${cN} tested (today, C1 and C2 all red on ${cAllRed}); ${cNone} had no such line ("none available")`);
say(`(c) ${cN > 0 && cAllRed === cN ? 'PASS' : cN === 0 ? 'none available, not a pass' : 'FAIL'}`);

// (d1) one-word facts over every line of the page as the quote
let d1Facts = 0; let d1Lines = 0; let d1Diff = 0; let d1DiffC1 = 0; const d1List = [];
for (const x of uniq(raw('single')).filter((y) => y.text)) {
  d1Facts += 1;
  for (const q of lineOf(x.text)) {
    const r = await run3(x, [x.words[0]], x.text, q);
    d1Lines += 1;
    if (r.t.verdict !== r.c2.verdict) { d1Diff += 1; if (d1List.length < 8) d1List.push(`"${x.words[0]}" quote "${q.slice(0, 70)}": today ${r.t.verdict}, C2 ${r.c2.verdict}`); }
    if (r.t.verdict !== r.c1.verdict) d1DiffC1 += 1;
  }
}
say(`(d1) one-word facts with page text ${d1Facts}; lines tried ${d1Lines}; today vs C2 differ on ${d1Diff}; today vs C1 differ on ${d1DiffC1}`);
for (const s of d1List) say(`    ${s}`);

// (d2) every saved run's signed phrase facts, re-checked on the run's own artifact and frozen input
function parts(o, acc = []) {
  if (Array.isArray(o)) { for (const v of o) parts(v, acc); return acc; }
  if (o && typeof o === 'object') {
    if (typeof o.source === 'string' && Array.isArray(o.facts) && o.facts.some((f) => f && f.shape === 'phrase')) acc.push(o);
    for (const v of Object.values(o)) parts(v, acc);
  }
  return acc;
}
let d2Runs = 0; let d2Checks = 0; let d2VerdictDiff = 0; let d2GapDiff = 0; let d2VerdictDiffC1 = 0; let d2Skipped = 0; let d2Red = 0;
const d2List = [];
for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  for (const flow of readdirSync(root)) {
    if (flow.startsWith('.')) continue;
    const rd = join(root, flow, 'runs');
    if (!existsSync(rd)) continue;
    for (const run of readdirSync(rd)) {
      const dir = join(rd, run);
      const decl = join(dir, 'job/declaration.json');
      if (!existsSync(decl)) continue;
      let d; try { d = JSON.parse(readFileSync(decl, 'utf8')); } catch { continue; }
      let ran = false;
      for (const st of d.steps ?? []) {
        for (const part of parts(st.close)) {
          const ap = join(dir, 'artifacts', `${st.emits}.json`);
          const ip = join(dir, 'inputs', `${part.source}.txt`);
          let art; let text;
          try { art = JSON.parse(readFileSync(ap, 'utf8')); text = readFileSync(ip, 'utf8'); } catch { d2Skipped += 1; continue; }
          if (!Array.isArray(art.results)) { d2Skipped += 1; continue; }
          const cand = (edges) => ({ ...part, facts: part.facts.map((f) => (f.shape === 'phrase' ? { name: f.name, shape: 'phrase', anyOf: [f.phrase] } : f)) });
          // only the phrase facts are swapped; a part with other facts is run whole through the real checker for today and, for the candidate, with those facts as signed
          const hasOther = part.facts.some((f) => f.shape !== 'phrase');
          const t = await checkCited({ part, text, results: art.results });
          let c1; let c2;
          if (hasOther) {
            c1 = await checkCandidateMixed(part, text, art.results, false);
            c2 = await checkCandidateMixed(part, text, art.results, true);
          } else {
            c1 = await checkCandidate({ part: cand(false), text, results: art.results }, false);
            c2 = await checkCandidate({ part: cand(true), text, results: art.results }, true);
          }
          ran = true; d2Checks += 1; if (t.verdict !== 'green') d2Red += 1;
          if (t.verdict !== c2.verdict) { d2VerdictDiff += 1; d2List.push(`${flow}/${run} step ${st.fromLine}: today ${t.verdict}, C2 ${c2.verdict} ${c2.fault ?? ''}`); }
          else if (JSON.stringify(t.gapLines) !== JSON.stringify(c2.gapLines)) { d2GapDiff += 1; d2List.push(`${flow}/${run} step ${st.fromLine}: same verdict ${t.verdict}, gap lines differ: today ${JSON.stringify(t.gapLines).slice(0, 120)} vs C2 ${JSON.stringify(c2.gapLines).slice(0, 120)}`); }
          if (t.verdict !== c1.verdict) d2VerdictDiffC1 += 1;
        }
      }
      if (ran) d2Runs += 1;
    }
  }
}
// a part with non-phrase facts: only its phrase facts are replaced, the rest are untouched
async function checkCandidateMixed(part, text, results, edges) {
  const f2 = part.facts.map((f) => (f.shape === 'phrase' ? { name: f.name, shape: 'phrase', anyOf: [f.phrase] } : f));
  const sha = sha256Text(text);
  const plain = { ...part, facts: f2.map((f) => (f.anyOf ? { name: f.name, shape: 'phrase', phrase: f.anyOf[0] } : f)) };
  const reds = factPartReds(plain);
  if (reds.length) return { verdict: 'stopped', gapLines: [], fault: reds[0] };
  let rubric;
  try {
    const spec = buildCitedSpec(plain, sha);
    f2.forEach((f, j) => { if (f.anyOf) spec.checkpoints.cited.checks[0].decides[j] = { phrases: f.anyOf, any: true, edges }; });
    rubric = createRubric(spec);
  } catch (e) { return { verdict: 'stopped', gapLines: [], fault: e.message }; }
  const claims = factClaims(plain, results);
  const r = await checkStep(rubric, 'cited', { count: claims.length, claims }, { inputs: { [part.source]: text } });
  if (r.verdict === 'green') return { verdict: 'green', gapLines: [] };
  if (r.verdict === 'stopped') return { verdict: 'stopped', gapLines: [], fault: r.fault?.detail };
  return { verdict: 'red', gapLines: r.full.gaps.map((g) => `${g.check ?? 'check'}: ${g.kind ?? 'failed'}`) };
}
say(`(d2) saved runs with a signed phrase fact re-checked: ${d2Runs} runs, ${d2Checks} checks (${d2Red} red today), ${d2Skipped} parts skipped (no artifact or frozen input); verdict differs today vs C2: ${d2VerdictDiff}; same verdict but gap text differs: ${d2GapDiff}; verdict differs today vs C1: ${d2VerdictDiffC1}`);
for (const s of d2List.slice(0, 12)) say(`    ${s}`);
say(`(d) ${d1Diff === 0 && d2VerdictDiff === 0 && d2GapDiff === 0 ? 'PASS' : 'FAIL on the letter'} (d1 differing ${d1Diff}, d2 verdict differing ${d2VerdictDiff}, d2 gap text differing ${d2GapDiff})`);

// (e) the word edges, a fixed table
const cases = [
  ['United', 'United States'], ['United', 'Reunited'], ['United', 'Unitedly'], ['Delta', 'Delta Air Lines'], ['Delta', 'Deltas'], ["Delta", "Delta's"],
  ['1 stop', '1 stop'], ['1 stop', '11 stops'], ['1 stop', '1 stops'], ['1 stop', '2 stops or 1 stop'], ['Nonstop', 'Nonstop flight'], ['Nonstop', 'non-stop'], ['Nonstop', 'Nonstop· 3 hr'], ['American', 'American Airlines'], ['American', 'Pan-American'],
];
let eOk = 0; let eRefused = 0;
say('(e) word edges (phrase | quote | today substring | C1 | C2 | reference):');
for (const [p, q] of cases) {
  const text = `${q}\nother line`;
  const x = { words: [p] };
  const r = await run3(x, [p], text, q);
  const ref = refCarries(q, p);
  const c2g = r.c2.verdict === 'green';
  if (c2g === ref) eOk += 1;
  say(`    ${JSON.stringify(p)} | ${JSON.stringify(q)} | ${r.t.verdict} | ${r.c1.verdict} | ${r.c2.verdict} | ${ref ? 'green' : 'red'}`);
}
// words edges would refuse to sign: not starting and ending on a letter or digit
const allWords = [...new Set(facts.filter((x) => x.kind !== 'place').flatMap((x) => x.words))];
const refused = [];
for (const w of allWords) {
  const r = await checkCandidate({ part: { source: 'p', facts: [{ name: 'n', shape: 'phrase', anyOf: [w] }] }, text: `${w} x`, results: [{ quote: `${w} x`, values: {} }] }, true);
  if (r.verdict === 'stopped') refused.push(`${JSON.stringify(w)}: ${String(r.fault).slice(0, 100)}`);
  else eRefused += 0;
}
say(`(e) reference agreement ${eOk} of ${cases.length}; distinct saved look words ${allWords.length}, edges mode refuses to sign ${refused.length}`);
for (const s of refused.slice(0, 12)) say(`    refused: ${s}`);
say(`(e) ${eOk === cases.length ? 'PASS' : 'FAIL'}`);
mkdirSync('.claude/scratch/walk-bugs', { recursive: true });
writeFileSync('.claude/scratch/walk-bugs/f236-candidate.txt', `${out.join('\n')}\n`);
