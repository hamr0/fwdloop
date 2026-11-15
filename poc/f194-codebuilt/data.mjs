// F194 data loading: the same 24 plans as F193 (poc/f193-sheets/run.mjs), plus the tables of each plan's CSV sources. Read-only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSignedText } from '../../src/signed-text.js';
import { parseCsv, sheetTable } from '../../src/csv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const FLOWS = path.join(os.homedir(), '.config/fwdloop/flows');
const PW = path.join(ROOT, '.claude/scratch/m16/practice-walk/home/.config/fwdloop/flows');
export const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
export const sheetCount = (d) => (Array.isArray(d?.steps) ? d.steps : []).reduce((n, s) => n + (Array.isArray(s?.close?.sheet) ? s.close.sheet.length : 0), 0);

/** the table of each CSV source of a plan, from the source path (absolute in every saved plan); null entries are unreadable */
function tablesOf(parsed) {
  const out = {}; const unreadable = [];
  for (const s of parsed.arbiter?.sources ?? []) {
    if (!isRec(s) || s.kind === 'page' || typeof s.path !== 'string' || !s.path.toLowerCase().endsWith('.csv') || typeof s.role !== 'string') continue;
    const file = path.isAbsolute(s.path) ? s.path : path.join(ROOT, s.path);
    try { out[s.role] = sheetTable(parseCsv(fs.readFileSync(file, 'utf8'))); } catch { unreadable.push(s.role); }
  }
  return { tables: out, unreadable };
}

export function loadPlans() {
  const plans = []; const seen = new Set();
  const add = (id, dir, signedFlow) => {
    const prose = fs.existsSync(path.join(dir, 'prose.txt')) ? fs.readFileSync(path.join(dir, 'prose.txt'), 'utf8') : null;
    const decl = readJ(path.join(dir, 'declaration.json'));
    if (prose === null || decl === null || sheetCount(decl) === 0) return;
    const key = sha(prose + JSON.stringify(decl));
    if (seen.has(key)) return;
    seen.add(key);
    const parsed = parseSignedText(prose);
    if (!parsed.ok) return;
    plans.push({ id, dir, signedFlow, prose, decl, parsed, ...tablesOf(parsed) });
  };
  for (const name of fs.readdirSync(FLOWS).sort()) {
    if (/^(m10-walk-csv|m10b-aging|aging-live|walk-m16-csv)/.test(name) && fs.existsSync(path.join(FLOWS, name, 'signature.json'))) add(`flow:${name}`, path.join(FLOWS, name), name);
  }
  if (fs.existsSync(path.join(PW, 'pw-csv'))) add('flow:pw-csv(practice-walk)', path.join(PW, 'pw-csv'), null);
  const drafts = path.join(FLOWS, '.drafts');
  for (const d of fs.readdirSync(drafts).sort()) for (const sub of fs.readdirSync(path.join(drafts, d)).filter((x) => x === 'draft' || x.startsWith('draft-')).sort()) add(`draft:${d}/${sub}`, path.join(drafts, d, sub), null);
  return plans;
}

/** every other signed flow with a sheet check (report-only widening, as in F193) */
export function loadExtra(plans) {
  const extra = [];
  for (const name of fs.readdirSync(FLOWS).sort()) {
    const dir = path.join(FLOWS, name);
    if (!fs.existsSync(path.join(dir, 'signature.json')) || plans.some((x) => x.signedFlow === name)) continue;
    const prose = fs.existsSync(path.join(dir, 'prose.txt')) ? fs.readFileSync(path.join(dir, 'prose.txt'), 'utf8') : null; const decl = readJ(path.join(dir, 'declaration.json'));
    if (prose === null || decl === null || sheetCount(decl) === 0) continue;
    const parsed = parseSignedText(prose); if (!parsed.ok) continue;
    extra.push({ id: `flow-extra:${name}`, dir, signedFlow: name, prose, decl, parsed, ...tablesOf(parsed) });
  }
  return extra;
}
