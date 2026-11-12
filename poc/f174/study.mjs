// F174 $0 study (no model calls, read-only). Usage: node poc/f174/study.mjs <root> [<root> ...]
// Q7: re-asked "drop it" after a Revise. Q3: same-meaning check pairs and split results.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const rj = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const kids = (d) => { try { return readdirSync(d); } catch { return []; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isDropIt = (t) => String(t ?? '').trim().replace(/\.$/, '').toLowerCase() === 'drop it'; // same words as src/pageask.js isDropIt
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** every directory under root (not through symlinks, skip node_modules/.cache) */
function* walk(d, depth = 0) {
  if (depth > 9) return;
  yield d;
  for (const k of kids(d)) {
    if (k === 'node_modules' || k === '.cache' || k === 'chromium') continue;
    const p = join(d, k);
    let st; try { st = statSync(p, { throwIfNoEntry: false }); } catch { continue; }
    if (st?.isDirectory()) yield* walk(p, depth + 1);
  }
}
const planNum = (name) => (name === 'draft' ? 0 : /^draft-(\d+)$/.test(name) ? Number(name.slice(6)) : null);

/** a draft session = a dir holding `draft` and/or `draft-<n>` plan folders */
export function sessionsOf(root) {
  const out = [];
  for (const d of walk(root)) {
    const plans = kids(d).filter((k) => planNum(k) !== null && isDir(join(d, k)));
    if (plans.length) out.push({ dir: d, plans: plans.sort((a, b) => planNum(a) - planNum(b)) });
  }
  return out;
}

function lookAsksOf(planDir) {
  const q = rj(join(planDir, 'questions.json'))?.questions;
  if (!Array.isArray(q)) return [];
  return q.map((x, i) => {
    const a = rj(join(planDir, `answer-${i + 1}.json`));
    return { k: i + 1, ...x, answer: typeof a?.answer === 'string' ? a.answer : null, rule: a ? a.rule : undefined };
  }).filter((x) => x.source === 'look');
}

export function q7(roots) {
  const cases = []; const reasks = [];
  for (const root of roots) for (const s of sessionsOf(root)) {
    const revise = (name) => { const n = planNum(name); return n > 0 && existsSync(join(s.dir, `card-${n}.json`)) && !existsSync(join(s.dir, `redraft-${n}.json`)); };
    for (const p of s.plans) {
      const drops = lookAsksOf(join(s.dir, p)).filter((x) => x.ask === 'cant-check' && isDropIt(x.answer));
      for (const dr of drops) for (const later of s.plans.filter((l) => planNum(l) > planNum(p) && revise(l))) {
        cases.push({ session: s.dir, droppedIn: p, line: dr.line, ruleText: dr.ruleText, revise: later });
        const again = lookAsksOf(join(s.dir, later)).filter((x) => x.line === dr.line && norm(x.ruleText) === norm(dr.ruleText));
        if (again.length) reasks.push({ session: s.dir, droppedIn: p, revise: later, line: dr.line, ruleText: dr.ruleText });
      }
    }
  }
  const verdict = reasks.length >= 1 ? 'REAL' : cases.length >= 1 ? 'UNSEEN' : 'NO DATA';
  return { cases, reasks, verdict };
}

/** the checks of one declaration step: [{kind:'words'|'count'|..., rule, n}] */
export function checksOf(step) {
  const out = []; const c = step.close ?? {};
  const sh = c.shape ?? {};
  if (typeof sh.maxWords === 'number') out.push({ kind: 'words', rule: 'maxWords', n: sh.maxWords, src: 'shape.maxWords' });
  for (const [where, list] of [['shape.picked', sh.picked], ['picked', c.picked]]) for (const p of Array.isArray(list) ? list : []) {
    out.push({ kind: p.rule === 'maxWords' ? 'words' : p.rule === 'listItems' ? 'count' : p.rule, rule: p.rule, n: p.value, src: where });
  }
  const cn = c.cited?.count;
  if (cn && cn.min === cn.max && Number.isInteger(cn.min)) out.push({ kind: 'count', rule: 'citedCount', n: cn.min, src: 'cited.count' });
  return out;
}
export function pairsOfStep(step) {
  const cs = checksOf(step); const pairs = [];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j];
    let t = null;
    if (a.rule === b.rule && a.n === b.n) t = 'a-same-rule';
    else if (a.kind === 'count' && b.kind === 'count' && a.n === b.n) t = 'b-count';
    else if (a.kind === 'words' && b.kind === 'words' && a.n === b.n) t = 'c-words';
    if (t) pairs.push({ type: t, a, b });
  }
  return pairs;
}

/** plans = each flow dir's signed plan, and each draft session's newest plan with a declaration */
export function plansOf(roots) {
  const plans = new Map();
  for (const root of roots) for (const d of walk(root)) {
    if (!d.includes('/runs/') && existsSync(join(d, 'signature.json'))) { // a run's frozen job copy is not another plan
      const p = existsSync(join(d, 'signed', 'declaration.json')) ? join(d, 'signed', 'declaration.json') : join(d, 'declaration.json');
      if (existsSync(p)) plans.set(p, { path: p, flowDir: d });
    }
  }
  for (const root of roots) for (const s of sessionsOf(root)) {
    const withDecl = s.plans.filter((p) => existsSync(join(s.dir, p, 'declaration.json')));
    if (withDecl.length) { const p = join(s.dir, withDecl[withDecl.length - 1], 'declaration.json'); plans.set(p, { path: p, flowDir: null }); }
  }
  return [...plans.values()];
}

export function q3(roots) {
  const plans = plansOf(roots); const pairPlans = []; const pairs = [];
  for (const pl of plans) {
    const decl = rj(pl.path); let any = false;
    for (const step of decl?.steps ?? []) for (const pr of pairsOfStep(step)) {
      any = true; pairs.push({ plan: pl.path, line: step.fromLine, emits: step.emits, ...pr });
    }
    if (any) pairPlans.push(pl);
  }
  // harm: run folders of flows whose plan has a pair
  const runs = []; let proved = 0; const oneSided = [];
  for (const pl of pairPlans) {
    if (!pl.flowDir) continue;
    const decl = rj(pl.path);
    const runsDir = join(pl.flowDir, 'runs');
    for (const r of kids(runsDir).filter((k) => /^run-/.test(k))) {
      const rd = join(runsDir, r);
      const log = rj(join(rd, 'log.json')); const lc = rj(join(rd, 'line-checks.json'));
      if (!log?.attempts) continue;
      let used = false;
      for (const step of decl.steps) {
        const ps = pairsOfStep(step); if (!ps.length) continue;
        const atts = log.attempts.filter((a) => a.step === step.emits);
        if (!atts.length) continue;
        used = true;
        atts.forEach((a, i) => {
          const g = String(a.gap ?? ''); if (a.verdict !== 'red' || !g) return;
          const fails = (x) => (x.kind === 'words' ? /\d+ words, limit/.test(g) : x.rule === 'listItems' ? /list items/.test(g) : x.rule === 'citedCount' ? /\bresults?\b.*(exactly|found|count)|exactly \d+ results/.test(g) : false);
          for (const pr of ps) {
            const fa = fails(pr.a), fb = fails(pr.b);
            if (fa === fb) continue;
            const last = i === atts.length - 1;
            const failed = fa ? pr.a : pr.b, other = fa ? pr.b : pr.a;
            // partner's PASS is only on record for a cited check: the line's final line-checks.json says passed:true
            const lineRow = lc?.cited?.lines?.find((l) => l.n === step.fromLine);
            if (last && other.rule === 'citedCount' && lineRow?.passed === true) { proved++; oneSided.push({ run: rd, line: step.fromLine, attempt: a.attempt, proved: true, gap: g }); }
            else oneSided.push({ run: rd, line: step.fromLine, attempt: a.attempt, proved: false, gap: g });
          }
        });
      }
      if (used) runs.push(rd);
    }
  }
  return {
    plans: plans.length, pairPlans: pairPlans.length, pairs,
    distinctPairPlans: new Set(pairPlans.map((p) => createHash('sha256').update(readFileSync(p.path)).digest('hex'))).size,
    pairLines: new Set(pairs.map((p) => `${p.plan}#${p.line}`)).size,
    dup: pairs.length ? 'DUP SEEN' : 'NOT SEEN', runs, split: proved, oneSided,
    harm: !runs.length ? 'HARM NO DATA' : proved >= 1 ? 'HARM REAL' : 'HARM UNSEEN',
  };
}

if (process.argv[1]?.endsWith('study.mjs')) {
  const roots = process.argv.slice(2);
  const a = q7(roots); const b = q3(roots);
  console.log(JSON.stringify({ q7: { cases: a.cases.length, reasks: a.reasks.length, verdict: a.verdict, casePaths: a.cases, reaskPaths: a.reasks },
    q3: { plans: b.plans, pairPlans: b.pairPlans, distinctPairPlans: b.distinctPairPlans, pairLines: b.pairLines, pairs: b.pairs.length, dup: b.dup, byType: Object.fromEntries([...new Set(b.pairs.map((p) => p.type))].map((t) => [t, b.pairs.filter((p) => p.type === t).length])), runs: b.runs.length, split: b.split, oneSidedReds: b.oneSided.length, harm: b.harm } }, null, 1));
  if (process.env.DETAIL) console.log(JSON.stringify({ pairs: b.pairs.map((p) => ({ plan: p.plan, line: p.line, type: p.type, a: `${p.a.src}:${p.a.rule}=${p.a.n}`, b: `${p.b.src}:${p.b.rule}=${p.b.n}` })), runs: b.runs, oneSided: b.oneSided }, null, 1));
}
