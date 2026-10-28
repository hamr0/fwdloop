// F96 POC: GitHub MCP typed path, code-only priority decision. $0, NO model calls. Pre-registered in docs/logs/FINDINGS.md (F96).
// Run: timeout 300 node poc/mcp/f96/f96.mjs   (token loads inside ~/.mcp.json's own `sh -c`; never read, printed or stored here)
import { createMCPBridge, listServerTools } from 'bare-agent/mcp';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRubric, checkStep } from 'bareguard';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out'); mkdirSync(OUT, { recursive: true });
const CFG = join(homedir(), '.mcp.json');
const exp = JSON.parse(readFileSync(join(here, '../../tickets/f95/expected.json'), 'utf8'));
const TICKETS = [
  ['f100047', 'flutter', 'flutter', 100047], ['f193097', 'flutter', 'flutter', 193097], ['f187579', 'flutter', 'flutter', 187579],
  ['f193785', 'flutter', 'flutter', 193785], ['f180865', 'flutter', 'flutter', 180865], ['p2b', 'flutter', 'flutter', 195397],
  ['p3', 'flutter', 'flutter', 195327], ['none', 'flutter', 'flutter', 195468], ['k124871', 'kubernetes', 'kubernetes', 124871],
  ['l270', 'lmchkhi', 'CS423-CSC15003-Testing-N08', 270], ['h11', 'hoangphi117', 'HW02', 11], ['y13', 'YarouAnarkis', 'UTS-PPL-Kelompok-07-Katalog', 13],
];
const R = { checks: {}, rec: {} };
const t0 = Date.now(); const dockerIds = () => { try { return execFileSync('docker', ['ps', '-q'], { encoding: 'utf8', timeout: 20000 }).split('\n').filter(Boolean); } catch { return ['?']; } };
R.dockerBefore = dockerIds();
const parse = (r) => { if (typeof r === 'string') { try { return JSON.parse(r); } catch { return { _text: r }; } } if (r && Array.isArray(r.content)) { const t = r.content.map((c) => c.text ?? '').join(''); try { return JSON.parse(t); } catch { return { _text: t }; } } return r; };
const errShape = (e) => ({ name: e?.name, message: String(e?.message).slice(0, 200) });

// --- M1
let tl;
{ const s = Date.now(); tl = await listServerTools({ configPaths: [CFG], server: 'github', confirmServer: () => true, timeout: 90000 }); R.rec.listServerToolsMs = Date.now() - s; }
const tools = tl.map((t) => ({ name: t.name, readOnlyHint: t.annotations?.readOnlyHint }));
const issueRead = tools.filter((t) => /issue/.test(t.name));
R.checks.M1 = { verdict: tools.length >= 1 && issueRead.length >= 1 && tools.every((t) => t.readOnlyHint === true) ? 'PASS' : 'FAIL', tools, count: tools.length };

// --- M2 (allow mode: one tool)
let b = null;
try {
  const s = Date.now();
  b = await createMCPBridge({ configPaths: [CFG], timeout: 90000, callTimeout: 90000, confirmServer: () => true, allow: { github: ['issue_read'] } });
  R.rec.bridgeStartMs = Date.now() - s;
  const meta = Object.fromEntries(b.metaTools.map((t) => [t.name, t]));
  const names = b.tools.map((t) => t.name);
  const tryInvoke = async (name) => { try { await meta.mcp_invoke.execute({ name, args: { owner: 'flutter', repo: 'flutter', perPage: 1 } }); return { refused: false }; } catch (e) { return { refused: true, ...errShape(e) }; } };
  const other = await tryInvoke('github_list_issues'); const nope = await tryInvoke('github_nonexistent_zzz');
  R.checks.M2 = { bridgeTools: names, missing: b.missing, listIssuesCall: other, nonexistentCall: nope, verdict: names.length === 1 && names[0] === 'github_issue_read' && other.refused && nope.refused ? 'PASS' : 'FAIL' };

  // --- M3 / M4
  const ir = b.tools.find((t) => t.name === 'github_issue_read');
  mkdirSync(join(OUT, 'raw'), { recursive: true });
  const per = {}; const callMs = [];
  for (const [id, owner, repo, n] of TICKETS) {
    const s2 = Date.now();
    try { const r = parse(await ir.execute({ method: 'get', owner, repo, issue_number: n })); callMs.push(Date.now() - s2); writeFileSync(join(OUT, 'raw', id + '.json'), JSON.stringify(r, null, 1)); per[id] = r; }
    catch (e) { per[id] = { _error: errShape(e) }; }
  }
  R.rec.issueReadMs = callMs;
  // typed-field extraction (field path recorded, not assumed)
  const M3 = {}; let m3ok = 0;
  for (const [id] of TICKETS) {
    const r = per[id];
    const labelsArr = Array.isArray(r.labels) ? r.labels : null;
    const names = labelsArr ? labelsArr.map((l) => (typeof l === 'string' ? l : l?.name)) : null;
    const ok = !!labelsArr && typeof r.state === 'string' && typeof r.created_at === 'string' && names.every((x) => typeof x === 'string');
    if (ok) m3ok++;
    M3[id] = { ok, topKeys: Object.keys(r).slice(0, 40), labelsPath: 'labels', labelItemType: labelsArr?.length ? typeof labelsArr[0] : null, labels: names, state: r.state, created_at: r.created_at };
  }
  R.checks.M3 = { verdict: m3ok === TICKETS.length ? 'PASS' : 'FAIL', ok: m3ok, of: TICKETS.length, perTicket: M3 };

  // M4: normaliser + body rule (stated in the pre-registration)
  const PRI = /^(priority\s*[:/\-]?\s*)?p([0-3])(?![0-9])/;
  const BODY = /^\s*(?:[-*]\s*)?(?:\*\*)?priority(?:\*\*)?\s*:\s*(?:\*\*)?\s*(P[0-3])\b/im;
  const priorityOf = (labels, body) => {
    const ps = new Set(); let nonScale = false;
    for (const raw of labels) { const l = raw.trim().toLowerCase(); const m = PRI.exec(l); if (m) ps.add('P' + m[2]); else if (/priority/.test(l)) nonScale = true; }
    if (ps.size === 1) return { value: [...ps][0], via: 'label' };
    if (ps.size > 1) return { value: 'unsure', via: 'label-conflict' };
    if (nonScale) return { value: 'unsure', via: 'label-nonscale' };
    const bm = BODY.exec(body ?? ''); if (bm) return { value: bm[1].toUpperCase(), via: 'body' };
    return { value: 'none', via: 'none' };
  };
  const rubric = createRubric({ schema: 1, goal: 'ticket filter', checkpoints: { filter: { gating: true, checks: [{ id: 'priority', rule: 'in', field: 'priority', values: ['P2'] }] } }, maxReds: 5 });
  const decide = async (priority) => {
    const res = await checkStep(rubric, 'filter', { priority });
    if (res.verdict !== 'red') return res.verdict === 'stopped' ? 'RED' : 'RUN-candidate';
    const j = JSON.stringify(res.gaps);
    if (!/not-in/.test(j)) return 'RED';
    return /"unsure"/.test(j) ? 'HITL' : 'SKIP';
  };
  const M4 = {}; let match = 0; const mism = [];
  for (const [id] of TICKETS) {
    const r = per[id]; const labels = M3[id].labels ?? [];
    const p = priorityOf(labels, r.body); const d = await decide(p.value);
    const e = exp[id]; const eq = p.value === e.priority; if (eq) match++; else mism.push({ id, got: p.value, expected: e.priority, labels });
    const expPri = await decide(e.priority);
    M4[id] = { priority: p.value, via: p.via, expectedPriority: e.priority, equal: eq, decision: d, decisionOnExpectedPriority: expPri, f95FullDecision: e.decision, topic: d === 'RUN-candidate' ? 'needs AI read' : '(not needed: priority decided)' };
  }
  R.checks.M4 = { verdict: match >= 11 ? 'PASS' : 'FAIL', match, of: TICKETS.length, mismatches: mism, perTicket: M4 };
} catch (e) { R.error = errShape(e); }
finally { if (b) { try { await b.close(); } catch (e) { R.closeErr = errShape(e); } } }

// --- M5 list + new
let b2 = null;
try {
  b2 = await createMCPBridge({ configPaths: [CFG], timeout: 90000, callTimeout: 90000, confirmServer: () => true, allow: { github: ['list_issues'] } });
  const li = b2.tools.find((t) => t.name === 'github_list_issues');
  const s = Date.now();
  const r1 = parse(await li.execute({ owner: 'flutter', repo: 'flutter', state: 'OPEN', orderBy: 'CREATED_AT', direction: 'DESC', perPage: 30, fields: ['number', 'title', 'state', 'labels', 'created_at'] }));
  R.rec.listMs = Date.now() - s;
  writeFileSync(join(OUT, 'list-page1.json'), JSON.stringify(r1, null, 1));
  const items = r1.issues ?? r1.items ?? (Array.isArray(r1) ? r1 : []);
  const pageInfo = r1.pageInfo ?? r1.page_info ?? null;
  const typed = items.length > 0 && items.every((i) => typeof i.number === 'number' && typeof i.created_at === 'string');
  const desc = items.every((x, i) => i === 0 || items[i - 1].created_at >= x.created_at);
  // page 2 via cursor
  let page2 = null;
  const cursor = pageInfo?.endCursor ?? pageInfo?.end_cursor;
  if (cursor) { const r2 = parse(await li.execute({ owner: 'flutter', repo: 'flutter', state: 'OPEN', orderBy: 'CREATED_AT', direction: 'DESC', perPage: 30, after: cursor, fields: ['number', 'created_at'] })); const it2 = r2.issues ?? []; page2 = { count: it2.length, firstNumber: it2[0]?.number, overlapWithPage1: it2.filter((x) => items.some((y) => y.number === x.number)).length }; }
  // `since`: does the schema accept it?
  let sinceTest;
  try { const newest = items[0]?.created_at; const r3 = parse(await li.execute({ owner: 'flutter', repo: 'flutter', state: 'OPEN', since: newest, perPage: 5, fields: ['number', 'created_at'] })); sinceTest = { accepted: true, count: (r3.issues ?? []).length, keys: Object.keys(r3) }; } catch (e) { sinceTest = { accepted: false, ...errShape(e) }; }
  let f94 = null;
  try { const k = JSON.parse(readFileSync(join(here, '../../tickets/f94/out/results.json'), 'utf8')); const j = JSON.stringify(k); f94 = [...new Set([...j.matchAll(/flutter\/flutter\/issues\/(\d+)/g)].map((m) => Number(m[1])))]; } catch { f94 = null; }
  R.checks.M5 = { verdict: typed && desc ? 'PASS' : 'FAIL', count: items.length, typed, newestFirst: desc, topKeys: Object.keys(r1), pageInfo, newestNumbers: items.slice(0, 5).map((i) => [i.number, i.created_at]), oldestOnPage: items.at(-1) && [items.at(-1).number, items.at(-1).created_at], page2, since: sinceTest, f94PageNumbersKnown: f94 && f94.length, overlapWithF94: f94 ? items.filter((i) => f94.includes(i.number)).map((i) => i.number) : null };
} catch (e) { R.checks.M5 = { verdict: 'FAIL', error: errShape(e) }; }
finally { if (b2) { try { await b2.close(); } catch (e) { R.closeErr2 = errShape(e); } } }

// --- M6
const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
const banned = ['make' + 'Provider', 'DEEP' + 'SEEK', 'bare-agent/prov', 'Loop('];
R.checks.M6 = { sourceHasProviderCode: banned.filter((w) => src.includes(w)), verdictSourcePart: banned.every((w) => !src.includes(w)) ? 'PASS' : 'FAIL' };
R.dockerAfter = dockerIds(); R.totalMs = Date.now() - t0;
writeFileSync(join(OUT, 'results.json'), JSON.stringify(R, null, 1));
console.log(JSON.stringify({ M1: R.checks.M1?.verdict, M2: R.checks.M2?.verdict, M3: R.checks.M3?.verdict, M4: R.checks.M4?.verdict, M5: R.checks.M5?.verdict, error: R.error, totalMs: R.totalMs, dockerBefore: R.dockerBefore, dockerAfter: R.dockerAfter }));
