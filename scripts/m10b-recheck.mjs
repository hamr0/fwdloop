// M10b exit: a SEPARATE checker. Re-runs one run's signed sheet checks against its saved (frozen) sheet and says ok or NOT OK.
// Deliberately shares no code with fwdloop's run path (no src/ imports): its own CSV reader, its own reading of the signed job, bareguard + node stdlib only.
// usage: node scripts/m10b-recheck.mjs <flowsRoot> <flow> <runId>      exit 0 = ok, 1 = NOT OK (or unreadable), 2 = bad usage. Reads only; writes nothing.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRubric, checkStep, tableSha, renderGaps } from 'bareguard';

const [root, flow, runId] = process.argv.slice(2);
if (!root || !flow || !runId) { console.error('usage: node scripts/m10b-recheck.mjs <flowsRoot> <flow> <runId>'); process.exit(2); }

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
let bad = false;
const out = (s) => console.log(s);
const fail = (s) => { out(s); bad = true; };

/** RFC 4180 CSV into bareguard's table: real line numbers (header = 1, blank lines skipped but counted), rows exactly as the file has them. */
function csvTable(text) {
  const recs = [];
  let line = 1, start = 1, fields = [], cell = '', inQ = false, quoted = false;
  const endRec = () => {
    fields.push(cell); cell = '';
    if (!(fields.length === 1 && fields[0] === '' && !quoted)) recs.push({ line: start, fields });
    fields = []; quoted = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1; } else inQ = false; }
      else { if (ch === '\n') line += 1; cell += ch; }
    } else if (ch === '"' && cell === '') { inQ = true; quoted = true; }
    else if (ch === ',') { fields.push(cell); cell = ''; }
    else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) { if (ch === '\r') i += 1; endRec(); line += 1; start = line; }
    else cell += ch;
  }
  if (cell !== '' || fields.length > 0 || quoted) endRec();
  if (recs.length === 0) return { header: [], rows: [] };
  return { header: recs[0].fields, rows: recs.slice(1).map((r) => ({ rowNumber: r.line, cells: r.fields })) };
}

const flowDir = path.join(root, flow);
const runDir = path.join(flowDir, 'runs', runId);
try {
  // 1. the signed checks: the run's own job copy, else the flow's declaration
  const own = path.join(runDir, 'job', 'declaration.json');
  const decl = readJson(existsSync(own) ? own : path.join(flowDir, 'declaration.json'));
  const steps = (decl.steps ?? []).filter((s) => Array.isArray(s?.close?.sheet) && s.close.sheet.length > 0);
  if (steps.length === 0) throw new Error('the signed job has no sheet checks');

  // 2-3. the saved sheets and their fingerprints
  const recorded = readJson(path.join(runDir, 'inputs.json'));
  const rec = readJson(path.join(runDir, 'sheet-checks.json'));
  const tables = {};
  const inputs = [];
  for (const i of recorded) {
    if (!i.tableSha) continue;
    const table = csvTable(readFileSync(path.join(runDir, 'inputs', path.basename(i.frozen)), 'utf8'));
    tables[i.id] = table;
    const mine = tableSha(table);
    const logged = (rec.lines ?? []).flatMap((l) => l.tables ?? []).filter((t) => t.name === i.id).map((t) => t.tableSha);
    const same = mine === i.tableSha && logged.every((s) => s === mine);
    if (same) out(`ok table ${i.id} ${mine.slice(0, 12)}`);
    else fail(`mismatch table ${i.id}: saved sheet gives ${mine}, run recorded ${i.tableSha}${logged.length ? ` (sheet-checks.json: ${[...new Set(logged)].join(', ')})` : ''}`);
    inputs.push({ name: i.id, sha256: i.tableSha });
  }

  // 4-5. each signed check against the newest recorded claims of its job line
  for (const s of steps) {
    const tries = (rec.lines ?? []).filter((l) => l.n === s.fromLine).sort((a, b) => a.try - b.try);
    const claims = tries.at(-1)?.claims;
    const checks = s.close.sheet.map(({ covers: _c, ...rest }) => rest);
    if (!claims) { for (const c of checks) fail(`RED ${c.id} no recorded claims for job line ${s.fromLine}`); continue; }
    const rubric = createRubric({ schema: 1, goal: 'recheck', inputs, checkpoints: { sheet: { gating: true, checks }, }, maxReds: 3 });
    const res = await checkStep(rubric, 'sheet', claims, { tables });
    if (res.verdict === 'stopped') {
      const f = res.fault;
      for (const c of checks) fail(`RED ${c.id} stopped: ${f?.id ?? ''} ${f?.kind ?? ''}${f?.detail ? ` ${f.detail}` : ''}`.trimEnd());
      continue;
    }
    const gaps = res.verdict === 'red' ? res.gaps : [];
    for (const c of checks) {
      const mine = gaps.filter((g) => g.id === c.id);
      if (mine.length === 0) out(`ok ${c.id}`); else fail(`RED ${c.id} ${renderGaps(mine)}`);
    }
  }
} catch (err) {
  fail(`NOT OK could not re-check: ${err.message}`);
}
out(bad ? 'NOT OK' : 'ok');
process.exit(bad ? 1 : 0);
