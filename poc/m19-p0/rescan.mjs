// F223b / M19 P0 rescan: every saved draft's `~` rules rebuilt by today's builder (src/planrebuild.js rebuildBlock) at $0. No AI, no key, no provider call.
// Read-only on ~/.config/fwdloop (each draft folder is COPIED to .claude/scratch/v061/p0b/work/ first). Prints rule and job names only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { NEGATING_RE } from '../../src/rubricstep.js';
import { rebuildBlock } from '../../src/planrebuild.js';
import { blockJobLines } from '../../src/blocklines.js';

const FLOWS = path.join(os.homedir(), '.config', 'fwdloop', 'flows');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', '..', 'test', 'fixtures');
const WORK = path.join(HERE, '..', '..', '.claude', 'scratch', 'v061', 'p0b', 'work');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const LIMIT_RE = /\d|\bone of\b|\b[\w'-]+(?:,\s*[\w' -]+)+,?\s+or\s+[\w'-]+|\byes\b|\bno\b|\bhas an? [\w-]+/i;
const norm = (t) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function parseProse(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (t === '' || /^Arbiter guardrails/.test(t)) { if (/^Arbiter/.test(t)) break; continue; }
    let m;
    if ((m = /^(\d+)\.\s+(.*)$/.exec(t))) lines.push({ n: Number(m[1]), text: m[2], ask: /^ask[: ]/i.test(m[2]), rules: [] });
    else if ((m = /^(?:guardrail:|~)\s*(.*)$/i.exec(t)) && lines.length) lines[lines.length - 1].rules.push(...m[1].split('; ').filter(Boolean));
  }
  return lines;
}

/** `~` rule rows left Not checked of a SAVED checkList (F223's reading); also every rule row with its state */
function savedRows(decl, prose) {
  const lines = prose ? parseProse(prose) : [];
  const sheetLines = new Set(decl.checkList.filter((r) => r.kind === 'sheet').map((r) => r.line));
  const out = [];
  for (const r of decl.checkList) {
    if (r.kind !== 'rule') continue;
    const line = lines.find((l) => l.n === r.line); const rule = line && line.rules[r.rule - 1];
    if (!line || !rule) continue;
    out.push({ line: line.text, rule, state: r.state, how: 'saved list', ask: line.ask, sheet: sheetLines.has(r.line) });
  }
  return out;
}

const reasons = {}; const bump = (k) => { reasons[k] = (reasons[k] ?? 0) + 1; };
const counted = { draftRebuilt: 0, draftSaved: 0, signedSaved: 0, fixtureSaved: 0 };
const excluded = { ticket: 0, ask: 0, sheet: 0 };
const suggestedHeld = { n: 0 };
/** per draft folder: the rule rows with their state, or null when not usable */
const draftRows = new Map();
const pool = []; // {kind, name, line, rule, state}

function take(kind, name, flowType, rows) {
  for (const r of rows) {
    if (flowType === 'tickets') { if (r.state === 'not-checked') excluded.ticket++; continue; }
    if (r.ask) { if (r.state === 'not-checked') excluded.ask++; continue; }
    if (r.sheet) { if (r.state === 'not-checked') excluded.sheet++; continue; }
    if (r.state === 'suggested') suggestedHeld.n++;
    pool.push({ kind, name, ...r });
  }
}

// ---- drafts
const DR = path.join(FLOWS, '.drafts');
let folders = 0;
const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true });
fs.rmSync(WORK, { recursive: true, force: true });
for (const d of fs.readdirSync(DR).filter((x) => x.startsWith('d-')).sort()) {
  for (const s of fs.readdirSync(path.join(DR, d)).filter((x) => x.startsWith('draft')).sort()) {
    folders++;
    const name = `${d}/${s}`;
    const src = path.join(DR, d, s);
    const prose = readText(path.join(src, 'prose.txt'));
    const decl = readJson(path.join(src, 'declaration.json'));
    const saved = decl && Array.isArray(decl.checkList) ? savedRows(decl, prose) : null;
    let reason = null; let rows = null;
    if (prose === null) reason = 'no prose.txt';
    else if (!decl || typeof decl !== 'object') reason = 'no declaration.json (the draft never made a plan)';
    else {
      const dest = path.join(WORK, d, s);
      copyDir(src, dest);
      if (!Array.isArray(decl.checkList)) {
        const bj = blockJobLines(prose, decl);
        if (!bj.ok) reason = 'prose does not parse today';
        else {
          const shim = { ...decl, checkList: bj.jobLines.map((l) => ({ line: l.n, kind: 'floor', state: 'built' })) };
          fs.writeFileSync(path.join(dest, 'declaration.json'), JSON.stringify(shim));
          if (bj.jobLines.length === 0) reason = 'no job line is a block line (all Ask, send or sheet)';
        }
      }
      if (!reason) {
        let b;
        try { b = rebuildBlock({ planDir: dest, asks: true }); } catch (e) { b = { ok: false, say: `builder threw: ${String(e && e.message).slice(0, 80)}` }; }
        if (!b.ok) reason = b.say.startsWith('The inputs of this plan have changed') ? 'an input file or page changed or is gone' : b.say.startsWith('This plan could not be read') ? 'plan could not be read' : b.say.slice(0, 80);
        else {
          rows = b.block.rows.filter((r) => r.kind === 'rule').map((r) => ({
            line: b.block.lines.find((l) => l.n === r.line)?.text ?? '', rule: r.text, state: r.state,
            how: r.state === 'built' ? `${r.can?.how ?? '?'}${r.pick ? `:${r.pick.check ?? r.pick.shape ?? r.pick.kind ?? '?'}` : ''}` : (r.reason ?? ''),
          }));
          counted.draftRebuilt++; take('draft', name, decl.flowType, rows);
        }
      }
    }
    if (reason) {
      if (saved) { rows = saved; counted.draftSaved++; take('draft', name, decl.flowType, saved); }
      else bump(reason);
    }
    draftRows.set(name, { rows, reason, rebuilt: rows && !reason });
  }
}
// ---- signed flows and fixtures: the saved checkList (F223's reading)
for (const f of fs.readdirSync(FLOWS).filter((x) => !x.startsWith('.')).sort()) {
  const dir = path.join(FLOWS, f);
  const decl = readJson(path.join(dir, 'declaration.json'));
  const prose = readText(path.join(dir, 'prose.txt')) ?? readText(path.join(dir, 'signed', 'prose.txt'));
  if (decl && Array.isArray(decl.checkList)) { counted.signedSaved++; take('signed', f, decl.flowType, savedRows(decl, prose)); }
  else bump('signed flow with no checkList: only prose and declaration saved (no look, picks or AI replies)');
}
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) walk(p);
  else if (e.name === 'declaration.json') {
    const decl = readJson(p); if (!decl || !Array.isArray(decl.checkList)) continue;
    const d = path.dirname(p);
    const prose = [path.join(d, 'prose.txt'), path.join(d, 'signed', 'prose.txt'), path.join(d, '..', 'prose.txt'), path.join(d, '..', 'job.txt')].map(readText).find((x) => x);
    counted.fixtureSaved++; take('fixture', path.relative(FIX, d), decl.flowType, savedRows(decl, prose ?? ''));
  }
} };
walk(FIX);

// ---- A and B (dedupe by job line text + rule text)
const seen = new Map();
for (const r of pool) {
  if (r.state !== 'not-checked') continue;
  const key = `${r.line}\u0000${r.rule}`;
  if (!seen.has(key)) seen.set(key, r);
}
const A = [...seen.values()];
const B = A.filter((x) => !NEGATING_RE.test(x.rule) && LIMIT_RE.test(x.rule));
const jobsB = new Set(B.map((x) => x.line));
const verdict = B.length === 0 ? 'NO-GO' : (B.length >= 3 && jobsB.size >= 2 ? 'GO' : 'BETWEEN');

const nRebuilt = counted.draftRebuilt;
const notRebuiltDrafts = folders - nRebuilt - counted.draftSaved;
console.log(`draft folders ${folders}: rebuilt by today's builder ${nRebuilt}; not rebuilt but a saved checkList read (F223 way) ${counted.draftSaved}; not counted ${notRebuiltDrafts}`);
console.log(`signed flows read from a saved checkList ${counted.signedSaved}; fixtures ${counted.fixtureSaved}`);
console.log('not counted, by reason:'); for (const [k, v] of Object.entries(reasons).sort()) console.log(`  ${v}  ${k}`);
console.log(`Not checked rule rows excluded before dedupe:`, JSON.stringify(excluded), `; rows held (state suggested, not Not checked): ${suggestedHeld.n}`);
console.log(`A = ${A.length}`);
for (const x of A) console.log(`  A [${x.kind}] ${x.name} | line: ${x.line.slice(0, 70)} | rule: ${x.rule}`);
console.log(`B = ${B.length} (distinct job lines ${jobsB.size})`);
for (const x of B) console.log(`  B [${x.kind}] job=${x.name} | line: ${x.line.slice(0, 70)} | rule: ${x.rule}`);
console.log(`VERDICT: ${verdict}`);

// ---- the limit-looking not-checked.json entries (F223's supplementary 31)
const ent = new Map(); // text -> [{name}]
for (const d of fs.readdirSync(DR).filter((x) => x.startsWith('d-'))) for (const s of fs.readdirSync(path.join(DR, d)).filter((x) => x.startsWith('draft'))) {
  const nc = readJson(path.join(DR, d, s, 'not-checked.json'));
  if (nc && Array.isArray(nc.notChecked)) for (const t of nc.notChecked) if (typeof t === 'string' && !NEGATING_RE.test(t) && LIMIT_RE.test(t)) { if (!ent.has(t)) ent.set(t, []); ent.get(t).push(`${d}/${s}`); }
}
console.log(`\nlimit-looking not-checked.json entries: ${ent.size} distinct`);
const tally = {};
for (const [text, names] of ent) {
  const outs = new Set();
  for (const n of names) {
    const dr = draftRows.get(n);
    if (!dr || !dr.rows) { outs.add('draft not rebuildable'); continue; }
    const hit = dr.rows.filter((r) => norm(text).includes(norm(r.rule)) || norm(r.rule).includes(norm(text)));
    if (!hit.length) { outs.add(dr.rebuilt ? 'not a ~ rule of its draft' : 'not a ~ rule of its draft (saved list)'); continue; }
    for (const h of hit) outs.add(h.state === 'built' ? `checked by ${h.how}` : h.state === 'not-checked' ? 'Not checked' : `held (${h.state})`);
  }
  const o = [...outs].sort().join(' | ');
  console.log(`  E "${text}" (${names.length} draft${names.length === 1 ? '' : 's'}) -> ${o}`);
  for (const k of outs) { const kk = k.replace(/^checked by .*/, 'checked'); tally[kk] = (tally[kk] ?? 0) + 1; }
}
console.log('entry outcomes (an entry can hold several):', JSON.stringify(tally));
