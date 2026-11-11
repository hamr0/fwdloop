// F167 (POC, NOT the product). $0: FAKE provider, no network, no keys. Candidate = a pure filter on what is SENT to the AI (count guardrails removed from the prose lines before the real draft()).
// usage: node run.mjs <f165-2 scratch dir> <f162 scratch parent dir>
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const root = process.cwd();
const { draft } = await import(path.join(root, 'src/drafter.js'));
const { fakeProvider, toolReply, textReply, RATES, MODEL } = await import(path.join(root, 'test/drafter-fixture.mjs'));
const { parseSignedText } = await import(path.join(root, 'src/signed-text.js'));
const { isCountGuardrail } = await import(path.join(root, 'src/declaration.js'));
const { lineRules } = await import(path.join(root, 'src/pagebits.js'));
const { offerRules } = await import(path.join(root, 'src/checkpick.js'));
const { askableFromLook } = await import(path.join(root, 'src/pageask.js'));
const { makeLiveModelStep } = await import(path.join(root, 'src/model-step.js'));
const [S, S162] = process.argv.slice(2);
const out = []; const say = (s) => { out.push(s); console.log(s); };
const rd = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');

// ---- the candidate filter ------------------------------------------------------------------------------------------------------------
const hideProse = (prose) => prose.split('\n').map((ln) => {
  const m = /^(\s*guardrail:\s*)(.*)$/.exec(ln); if (!m) return ln;
  const kept = m[2].split('; ').filter((r) => !isCountGuardrail(r));
  return kept.length ? m[1] + kept.join('; ') : null;
}).filter((x) => x !== null).join('\n');
const countRules = (prose) => { const p = parseSignedText(prose); return p.ok ? p.lines.flatMap((l) => lineRules({ rule: l.guardrail }).map((t, i) => ({ line: l.n, rule: i + 1, text: t }))).filter((r) => isCountGuardrail(r.text)) : []; };
const hideMapping = (mapping, counts) => ({ ...mapping, facts: mapping.facts.filter((f) => !counts.some((c) => new RegExp(`^line ${c.line} rule ${c.rule}$`).test(String(f.from).trim()))) });

async function rebuild(dd, prose, hide, carry) {
  const page = rd(dd, 'pages/flights.txt');
  let mapping = JSON.parse(rd(dd, 'page-look.json')).pages[0].mapping;
  const counts = countRules(prose);
  if (hide) { prose = hideProse(prose); mapping = hideMapping(mapping, counts); }
  const carriedPicks = carry ? JSON.parse(rd(dd, 'picks-record.json')).picks : [];
  const stub = { steps: [], guardrailClasses: {}, unjudgeable: {}, refused: [], notChecked: [] };
  const prov = fakeProvider([{ ...textReply(JSON.stringify(mapping)), usage: { inputTokens: 1000, outputTokens: 200 } }, toolReply(stub), toolReply(stub), toolReply(stub)]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f167-'));
  try { await draft({ proseText: prose, provider: prov, rates: RATES, modelId: MODEL, draftDir: path.join(tmp, 'd'), fetchPage: async (url) => ({ ok: true, text: page, url }), offerQuestions: false, carriedPicks }); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const mi = prov.calls.findIndex((c) => !c.tools.length); const di = prov.calls.findIndex((c) => c.tools.includes('emit_declaration'));
  return { map: mi >= 0 ? prov.calls[mi].messages.map((m) => m.content).join('\n') : '', sys: di >= 0 ? prov.calls[di].messages[0].content : '' };
}

// ---- (a) and (b) ---------------------------------------------------------------------------------------------------------------------
const rs = fs.readFileSync(`${S}/results.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
let aOk = true; let aN = 0; let aBytes = 0; let bBytes = 0; let aIdent = 0; let a1;
const diffs = [];
for (const r of rs) {
  const base = `${S}/flows/.drafts/${r.draftId}`;
  for (const sub of ['draft', 'draft-1']) {
    const dd = path.join(base, sub); if (!fs.existsSync(dd) || !fs.existsSync(path.join(dd, 'pages/flights.txt'))) continue;
    const prose = rd(dd, 'prose.txt'); const carry = sub === 'draft-1';
    const today = await rebuild(dd, prose, false, carry); const cand = await rebuild(dd, prose, true, carry);
    const counts = countRules(prose);
    if (r.arm === 'A') {
      const same = today.map === cand.map && today.sys === cand.sys; aIdent += same ? 1 : 0; aBytes += 1; if (!same) { aOk = false; say(`(a) A ${r.flowName}/${sub}: NOT byte-identical`); }
      if (r.i === 1 && sub === 'draft') a1 = cand.sys;
    } else {
      bBytes += 1;
      const leaks = [];
      for (const c of counts) for (const [nm, txt] of [['map', cand.map], ['drafter', cand.sys]]) if (txt.toLowerCase().includes(c.text.toLowerCase())) leaks.push(`${nm}:"${c.text}"`);
      const stillToday = counts.every((c) => today.map.toLowerCase().includes(c.text.toLowerCase()) || today.sys.toLowerCase().includes(c.text.toLowerCase()));
      say(`(a) B ${r.flowName}/${sub}: counts hidden [${counts.map((c) => c.text).join(' | ')}]; leaks in candidate: ${leaks.length ? leaks.join(',') : 'none'}; today shows them: ${stillToday}`);
      if (leaks.length || !stillToday) aOk = false;
      diffs.push({ n: `${r.flowName}/${sub}`, cand });
    }
  }
}
say(`(a) A prompts byte-identical (map + drafter): ${aIdent}/${aBytes}; B prompts checked: ${bBytes} => ${aOk ? 'ok' : 'FAIL'}`);
// (b) reported
const aLines = new Set((a1 ?? '').split('\n'));
for (const d of diffs.filter((x) => x.n.endsWith('draft-1')).slice(0, 10)) {
  const extra = d.cand.sys.split('\n').filter((l) => !aLines.has(l));
  say(`(b) ${d.n}: ${extra.length} drafter-prompt line(s) not in A1's prompt${extra.length ? `: ${extra.map((l) => l.slice(0, 140)).join(' || ')}` : ''}`);
}

// ---- (c) run-time brief --------------------------------------------------------------------------------------------------------------
{
  const dd = `${S}/flows/.drafts/${rs.find((r) => r.arm === 'B' && fs.existsSync(`${S}/flows/.drafts/${r.draftId}/draft-1/declaration.json`)).draftId}/draft-1`;
  const decl = JSON.parse(rd(dd, 'declaration.json')); const st = decl.steps.find((s) => s.fromLine === 2);
  const sent = [];
  const provider = { generate: async (messages, tools) => { sent.push(messages); return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { results: [], done: true, text: 'x' } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash' }; } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f167c-'));
  try {
    const step = makeLiveModelStep({ spendPath: path.join(tmp, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
    await step({ goal: st.goal, primitives: st.primitives ?? [], reads: {}, gap: null }, {}, { class: st.close.class, cited: st.close.cited ?? null, withText: Array.isArray(st.close.picked) && st.close.picked.length > 0 });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const all = sent[0].map((m) => m.content).join('\n').toLowerCase();
  const b = all.includes('exactly 3 bullets'); const w = all.includes('under 80 words');
  say(`(c) step 2 goal "${st.goal}"; brief contains "exactly 3 bullets": ${b}; "under 80 words": ${w} => ${b && w ? 'ok' : 'FAIL'}`);
  say(`(c) full user brief: ${sent[0].find((m) => m.role === 'user').content.slice(0, 400)}`);
}

// ---- (d) 41 looks + F162 -------------------------------------------------------------------------------------------------------------
{
  const dirs = [];
  const drafts = path.join(os.homedir(), '.config/fwdloop/flows/.drafts');
  for (const d of fs.readdirSync(drafts).sort()) { const b = path.join(drafts, d); if (!fs.statSync(b).isDirectory()) continue; for (const s of fs.readdirSync(b).sort()) if (/^draft(-\d+)?$/.test(s)) dirs.push(path.join(b, s)); }
  const f162 = []; for (const n of ['f162-1', 'f162-2', 'f162-3b', 'f162-cmp', 'f162-old']) { try { const r = path.join(S162, n, 'flows/.drafts'); for (const id of fs.readdirSync(r)) { const dd = path.join(r, id, 'draft'); if (fs.existsSync(path.join(dd, 'page-look.json'))) f162.push(dd); } } catch { /* none */ } }
  let n = 0; let same = 0; let n162 = 0; let same162 = 0; const bad = [];
  const one = (dd) => {
    let look; let prose; try { look = JSON.parse(rd(dd, 'page-look.json')); prose = rd(dd, 'prose.txt'); } catch { return null; }
    const p = parseSignedText(prose); if (!p.ok) return null;
    const counts = countRules(prose);
    const facts = [...(look.look?.facts ?? []), ...(look.sheets ?? []).flatMap((x) => x.facts ?? [])];
    const cfacts = facts.filter((f) => !counts.some((c) => c.line === f.line && c.rule === f.forRule));
    const askLines = new Set(p.arbiter.asks.map((a) => a.line));
    const jl = p.lines.map((l) => ({ n: l.n, text: l.text, ...(l.guardrail ? { rule: l.guardrail } : {}) })).filter((l) => !askLines.has(l.n));
    const sig = (fs_) => JSON.stringify([offerRules(p.lines, p.arbiter, fs_).map((r) => `${r.line}.${r.rule}.${r.text}`), askableFromLook({ facts: fs_ }, jl).map((a) => a.question)]);
    return sig(facts) === sig(cfacts) ? true : sig(facts) + ' != ' + sig(cfacts);
  };
  for (const dd of dirs) { const r = one(dd); if (r === null) continue; n++; if (r === true) same++; else bad.push(`${dd}: ${r}`); }
  for (const dd of f162) { const r = one(dd); if (r === null) continue; n162++; if (r === true) same162++; else bad.push(`${dd}: ${r}`); }
  for (const b of bad) say(`(d) CHANGED ${b}`);
  say(`(d) saved looks replayed ${n} (expect 41): offer+questions unchanged ${same}; F162 drafts ${n162}: unchanged ${same162} => ${n === 41 && !bad.length ? 'ok' : 'FAIL'}`);
}
fs.writeFileSync(new URL('./out.txt', import.meta.url), out.join('\n') + '\n');
