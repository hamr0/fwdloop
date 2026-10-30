// F98 POC: pure matching (labels + keywords), no AI. $0, NO model calls. Pre-registered in docs/logs/FINDINGS.md (F98).
// Run: timeout 300 node poc/tickets/f98/f98.mjs
import { createMCPBridge } from 'bare-agent/mcp';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRubric, checkStep } from 'bareguard';

const here = dirname(fileURLToPath(import.meta.url)); const OUT = join(here, 'out'); mkdirSync(join(OUT, 'raw'), { recursive: true });
// self-assert: no provider/model code in this file or its imports
const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
const banned = ['make' + 'Provider', 'DEEP' + 'SEEK', 'bare-agent/prov', 'Loo' + 'p(', 'bare-agent/loop'];
const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
if (banned.some((w) => src.replace(/const banned[^\n]*\n/, '').includes(w)) || imports.some((i) => !['bare-agent/mcp', 'bareguard'].includes(i) && !i.startsWith('node:'))) throw new Error('provider/model code or unexpected import');

const R = { checks: {}, rec: {}, imports }; const t0 = Date.now();
const dockerIds = () => { try { return execFileSync('docker', ['ps', '-q'], { encoding: 'utf8', timeout: 20000 }).split('\n').filter(Boolean); } catch { return ['?']; } };
R.dockerBefore = dockerIds();
const parse = (r) => { const t = typeof r === 'string' ? r : r.content.map((c) => c.text ?? '').join(''); return JSON.parse(t); };
const exp = JSON.parse(readFileSync(join(here, '../f95/expected.json'), 'utf8'));
const F96 = [['f100047'], ['f193097'], ['f187579'], ['f193785'], ['f180865'], ['p2b'], ['p3'], ['none'], ['k124871'], ['l270'], ['h11'], ['y13']].map((x) => x[0]);
const sel = JSON.parse(readFileSync(join(here, 'tickets.json'), 'utf8'));

// --- fetch the 20 fresh by issue_read (bodies only now)
const CFG = join(homedir(), '.mcp.json'); const tickets = []; // {id, set, issue}
for (const id of F96) tickets.push({ id, set: '12', issue: JSON.parse(readFileSync(join(here, '../../mcp/f96/out/raw', id + '.json'), 'utf8')) });
const b = await createMCPBridge({ configPaths: [CFG], timeout: 90000, callTimeout: 90000, confirmServer: () => true, allow: { github: ['issue_read'] } });
const ir = b.tools.find((t) => t.name === 'github_issue_read');
for (const [set, nums] of [['A', sel.A], ['B', sel.B]]) for (const n of nums) {
  const f = join(OUT, 'raw', `fl${n}.json`);
  if (!existsSync(f)) writeFileSync(f, JSON.stringify(parse(await ir.execute({ method: 'get', owner: 'flutter', repo: 'flutter', issue_number: n })), null, 1));
  tickets.push({ id: 'fl' + n, set, issue: JSON.parse(readFileSync(f, 'utf8')) });
}
await b.close();
const labelsOf = (i) => (Array.isArray(i.labels) ? i.labels.map((l) => (typeof l === 'string' ? l : l?.name)) : null);

// --- G1 (F96 normaliser, copied)
const PRI = /^(priority\s*[:/\-]?\s*)?p([0-3])(?![0-9])/;
const BODY = /^\s*(?:[-*]\s*)?(?:\*\*)?priority(?:\*\*)?\s*:\s*(?:\*\*)?\s*(P[0-3])\b/im;
const priorityOf = (labels, body) => {
  const ps = new Set(); let nonScale = false;
  for (const raw of labels) { const l = raw.trim().toLowerCase(); const m = PRI.exec(l); if (m) ps.add('P' + m[2]); else if (/priority/.test(l)) nonScale = true; }
  if (ps.size === 1) return [...ps][0]; if (ps.size > 1 || nonScale) return 'unsure';
  const bm = BODY.exec(body ?? ''); return bm ? bm[1].toUpperCase() : 'none';
};
const rub = (checks) => createRubric({ schema: 1, goal: 'ticket filter', checkpoints: { filter: { gating: true, checks } }, maxReds: 9999 });
const rP = rub([{ id: 'priority', rule: 'in', field: 'priority', values: ['P2'] }]);
const TYPE = ['c: crash']; // flutter has no hang label (get_label c: hang -> not found)
const rT = rub([{ id: 'type', rule: 'in', field: 'typeHit', values: TYPE }]);
const KW = ['crash', 'crashes', 'crashed', 'crashing', 'hang', 'hangs', 'hung', 'freeze', 'freezes', 'frozen', 'ANR', 'not responding'];
const rK = KW.map((k) => [k, rub([{ id: 'kw', rule: 'mustCarry', field: 'text', phrases: [k] }])]);
const green = async (r, fields) => (await checkStep(r, 'filter', fields)).verdict !== 'red' ? true : false;
const kwPrimary = async (text) => { const hits = []; for (const [k, r] of rK) if (await green(r, { text })) hits.push(k); return hits; };
const kwBound = (text) => KW.filter((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/ /g, '\\s+')}($|[^a-z0-9])`, 'i').test(text));

// --- decide all
const T = {}; const ms = { g1: [], g2: [], g3: [] };
for (const t of tickets) {
  const labels = labelsOf(t.issue); const title = t.issue.title ?? ''; const body = t.issue.body ?? '';
  let s = Date.now(); const pri = labels ? priorityOf(labels, body) : null; const g1 = labels ? ((await green(rP, { priority: pri })) ? 'RUN' : 'SKIP') : 'UNREADABLE'; ms.g1.push(Date.now() - s);
  s = Date.now(); const typeHit = labels ? (labels.find((l) => TYPE.includes(l.trim().toLowerCase())) ?? 'none') : null;
  const g2 = labels ? ((await green(rT, { typeHit: typeHit?.toLowerCase() })) ? 'RUN' : 'SKIP') : 'UNREADABLE'; ms.g2.push(Date.now() - s);
  const near = (labels ?? []).filter((l) => /crash|hang|freez|anr\b|hung/i.test(l) && !TYPE.includes(l.toLowerCase()));
  const text = title + '\n' + body;
  s = Date.now(); const hits = await kwPrimary(text); ms.g3.push(Date.now() - s);
  const hitsW = kwBound(text);
  const snip = (k) => { const m = new RegExp(k.replace(/ /g, '\\s+'), 'i').exec(text); return m ? text.slice(Math.max(0, m.index - 30), m.index + k.length + 30).replace(/\s+/g, ' ') : null; };
  T[t.id] = { set: t.set, title: title.slice(0, 100), labels, priority: pri, g1, g2, near, g3Hits: hits, g3: hits.length ? 'RUN' : 'SKIP', g3wHits: hitsW, g3w: hitsW.length ? 'RUN' : 'SKIP', snippets: hits.slice(0, 3).map((k) => [k, snip(k)]) };
}
const ids = Object.keys(T);
// R1
const r1 = F96.filter((id) => T[id].priority === exp[id].priority);
R.checks.R1 = { verdict: r1.length === 12 ? 'PASS' : 'FAIL', match: r1.length, of: 12, mismatches: F96.filter((id) => !r1.includes(id)).map((id) => [id, T[id].priority, exp[id].priority]) };
// R2 page parse
const pageLabels = (txt) => { const line = txt.split('\n').find((l) => /^\s*-?\s*Labels:\s/.test(l)); if (!line) return []; return line.replace(/^\s*-?\s*Labels:\s*/, '').split(/\s*\[ref=\d+\](?:,\s*|\s*$)/).map((s) => s.trim()).filter(Boolean); };
const has = (pieces, L) => pieces.some((p) => p.toLowerCase() === L.toLowerCase() || p.toLowerCase().startsWith(L.toLowerCase() + ' '));
const R2 = {}; let r2ok = 0;
for (const id of F96) {
  const f = join(here, '../f95/pages', id + '.txt'); const pieces = pageLabels(readFileSync(f, 'utf8')); const ml = T[id].labels;
  const eq = ml.every((l) => has(pieces, l)) && pieces.length === ml.length; if (eq) r2ok++;
  R2[id] = { eq, mcp: ml, pagePieces: pieces.length, missingOnPage: ml.filter((l) => !has(pieces, l)) };
}
R.checks.R2 = { verdict: r2ok >= 11 ? 'PASS' : 'FAIL', equal: r2ok, of: 12, per: R2 };
// R3
const undec = ids.filter((id) => T[id].g2 === 'UNREADABLE'); const nearIds = ids.filter((id) => T[id].near.length);
R.checks.R3 = { verdict: undec.length === 0 && nearIds.length === 0 ? 'PASS' : 'FAIL', decided: ids.length - undec.length, of: ids.length, unreadable: undec, nearMisses: nearIds.map((id) => [id, T[id].near]), runBy: ids.filter((id) => T[id].g2 === 'RUN').length };
// R4/R5
const crash = ids.filter((id) => T[id].g2 === 'RUN'); const non = ids.filter((id) => T[id].g2 === 'SKIP');
const wrongSkip = crash.filter((id) => T[id].g3 === 'SKIP'); const wrongSkipW = crash.filter((id) => T[id].g3w === 'SKIP');
const falseRun = non.filter((id) => T[id].g3 === 'RUN'); const falseRunW = non.filter((id) => T[id].g3w === 'RUN');
const nm = (id) => ({ id, title: T[id].title, labels: T[id].labels });
R.checks.R4 = { verdict: wrongSkip.length <= 1 ? 'PASS' : 'FAIL', crashLabelled: crash.length, wrongSkips: wrongSkip.map(nm), wrongSkipsWordBounded: wrongSkipW.map(nm) };
R.checks.R5 = { verdict: falseRun.length === 0 ? 'PASS' : 'FAIL', nonCrashLabelled: non.length, falseRuns: falseRun.map((id) => ({ id, title: T[id].title, hits: T[id].g3Hits, snippets: T[id].snippets })), falseRunsWordBounded: falseRunW.map((id) => ({ id, hits: T[id].g3wHits })) };
// mustCarry semantics on made-up text
const mc = async (text, k) => (await green(rub([{ id: 'k', rule: 'mustCarry', field: 'text', phrases: [k] }]), { text }));
R.rec.mustCarry = { upperTextLowerPhrase: await mc('The APP CRASHED on start', 'crashed'), lowerTextUpperPhrase: await mc('anr dialog shown', 'ANR'), hangInsideChange: await mc('I will change the colour', 'hang'), hangInsideChangeWordLoose: 'see above (true = bareguard counts it)', realHang: await mc('the app will hang', 'hang') };
R.rec.msPerDecisionAvg = Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, +(v.reduce((a, c) => a + c, 0) / v.length).toFixed(2)]));
R.dockerAfter = dockerIds(); R.checks.R6 = { dockerEqual: JSON.stringify(R.dockerBefore) === JSON.stringify(R.dockerAfter), importsOnlyMcpGuard: true };
R.totalMs = Date.now() - t0; R.perTicket = T;
writeFileSync(join(OUT, 'results.json'), JSON.stringify(R, null, 1));
console.log(JSON.stringify({ R1: R.checks.R1.verdict + ' ' + r1.length, R2: R.checks.R2.verdict + ' ' + r2ok, R3: R.checks.R3, R4: R.checks.R4.verdict + ' ' + wrongSkip.length + '/' + crash.length, R5: R.checks.R5.verdict + ' ' + falseRun.length + '/' + non.length, mustCarry: R.rec.mustCarry, ms: R.rec.msPerDecisionAvg, docker: R.checks.R6.dockerEqual }));
