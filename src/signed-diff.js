// M5 close / amendment 43: say what changed. Pure — no disk, no clock. Given the signed copy of the two signed files and what is on disk now,
// name each change in plain words ("line 3 changed", "line 3's guardrail changed", "the cap changed") instead of only the file name.
// What this throws away: the old and new values themselves (only that a thing changed, and for a number the two numbers); a prose edit
// that parses to the same lines and arbiter (spacing, blank lines) is named as "wording or spacing", never silently dropped.

import { parseSignedText } from './signed-text.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sec = (ms) => (ms % 3600000 === 0 ? `${ms / 3600000}h` : ms % 60000 === 0 ? `${ms / 60000}m` : `${ms / 1000}s`);

/**
 * @param {{ oldProse: string, newProse: string, oldDecl: string, newDecl: string }} x the signed copy (old) and the files on disk (new)
 * @returns {string[]} plain sentences; empty when nothing differs
 */
export function describeChange({ oldProse, newProse, oldDecl, newDecl }) {
  const out = [];
  const a = parseSignedText(oldProse);
  const b = parseSignedText(newProse);
  if (oldProse.replace(/\r\n/g, '\n') !== newProse.replace(/\r\n/g, '\n')) {
    if (!a.ok || !b.ok) {
      out.push(b.ok ? 'the signed text could not be compared with the saved copy' : `prose.txt no longer reads as a signed job (${b.reds[0]})`);
    } else {
      const before = new Map(a.lines.map((l) => [l.n, l]));
      const after = new Map(b.lines.map((l) => [l.n, l]));
      for (const [n, l] of before) {
        const m = after.get(n);
        if (!m) { out.push(`line ${n} was removed`); continue; }
        if (l.text !== m.text) out.push(`line ${n} changed`);
        if (l.guardrail !== m.guardrail) out.push(`line ${n}'s guardrail changed`);
      }
      for (const n of after.keys()) if (!before.has(n)) out.push(`line ${n} was added`);
      const x = a.arbiter;
      const y = b.arbiter;
      if (x.capUsd !== y.capUsd) out.push(`the cap changed (from $${x.capUsd} to $${y.capUsd})`);
      if (x.redoCap !== y.redoCap) out.push(`the redo cap changed (from ${x.redoCap} to ${y.redoCap})`);
      if (x.roundBudgetMs !== y.roundBudgetMs) out.push(`the round budget changed (from ${sec(x.roundBudgetMs)} to ${sec(y.roundBudgetMs)})`);
      if (!same(x.skills, y.skills)) out.push('the skills changed');
      for (const k of x.asks) {
        const o = y.asks.find((s) => s.line === k.line);
        if (!o) out.push(`the ask at line ${k.line} was removed`);
        else if (o.ttlMs !== k.ttlMs) out.push(`the wait of the ask at line ${k.line} changed (from ${sec(k.ttlMs)} to ${sec(o.ttlMs)})`);
        else if (o.question !== k.question) out.push(`the question of the ask at line ${k.line} changed`);
      }
      for (const k of y.asks) if (!x.asks.some((s) => s.line === k.line)) out.push(`an ask was added at line ${k.line}`);
      for (const k of x.sends) {
        const o = y.sends.find((s) => s.line === k.line);
        if (!o) out.push(`the send at line ${k.line} was removed`);
        else if (!same(o.target, k.target)) out.push(`the send destination at line ${k.line} changed`);
      }
      for (const k of y.sends) if (!x.sends.some((s) => s.line === k.line)) out.push(`a send was added at line ${k.line}`);
      for (const k of x.sources) {
        const o = y.sources.find((s) => s.role === k.role);
        if (!o) out.push(`the input "${k.role}" was removed`);
        else if (!same(o, k)) out.push(`the input "${k.role}" changed`);
      }
      for (const k of y.sources) if (!x.sources.some((s) => s.role === k.role)) out.push(`an input "${k.role}" was added`);
      if (out.length === 0) out.push('prose.txt changed in wording or spacing (no job line, guardrail or arbiter value differs)');
    }
  }
  let d1;
  let d2;
  try { d1 = JSON.stringify(sortDeep(JSON.parse(oldDecl))); d2 = JSON.stringify(sortDeep(JSON.parse(newDecl))); } catch { d1 = oldDecl; d2 = newDecl; }
  if (d1 !== d2) out.push('the plan changed (declaration.json)');
  return out;
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  return v;
}
