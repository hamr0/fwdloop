// F189 (never ships). Paid POC, cap $0.03: does deepseek-flash accept bareguard #82 claimSchema boxes as a forced tool's parameters?
// Usage: DEEPSEEK_API_KEY="$(pass amr/deepseek_api | head -n1 | tr -d '\r\n')" timeout 300 node poc/f189-claims/run.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Loop, HaltError } from 'bare-agent';
import { parseSignedText } from '../../src/signed-text.js';
import { bareguardChecks } from '../../src/sheetchecks.js';
import { makeProvider, sumMeterings } from '../../src/provider.js';
import { LIVE_PROVIDER_OPTIONS } from '../../src/model-step.js';

if (!(process.env.DEEPSEEK_API_KEY ?? '').trim()) { console.error('DEEPSEEK_API_KEY is empty: refusing to start, no call made'); process.exit(2); }
const CAP = 0.03;
const here = path.dirname(fileURLToPath(import.meta.url));
const BG = '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/3ce0f482-5c76-4fdf-a7f3-a80f5a98d7a7/scratchpad/bg82b';
const { claimSchema } = await import(pathToFileURL(path.join(BG, 'src/index.js')).href);
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const logs = []; const log = (s) => { logs.push(s); console.log(s); };

function validate(s, v) {
  if (s.anyOf && !s.anyOf.some((x) => validate(x, v))) return false;
  if (s.enum && !s.enum.some((e) => e === v)) return false;
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const ok = types.some((t) => (t === 'string' ? typeof v === 'string' : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : t === 'boolean' ? typeof v === 'boolean' : t === 'array' ? Array.isArray(v) : t === 'object' ? isRec(v) : false));
    if (!ok) return false;
  }
  if (typeof v === 'string') { if (s.minLength !== undefined && v.length < s.minLength) return false; if (s.maxLength !== undefined && v.length > s.maxLength) return false; }
  if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) return false;
  if (Array.isArray(v)) { if (s.minItems !== undefined && v.length < s.minItems) return false; if (s.items && !v.every((x) => validate(s.items, x))) return false; }
  if (isRec(v) && s.minProperties !== undefined && Object.keys(v).length < s.minProperties) return false;
  if (isRec(v)) {
    for (const r of s.required ?? []) if (!(r in v)) return false;
    if (s.propertyNames?.pattern && !Object.keys(v).every((k) => new RegExp(s.propertyNames.pattern).test(k))) return false;
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) { if (!validate(s.properties[k], x)) return false; }
      else if (isRec(s.additionalProperties)) { if (!validate(s.additionalProperties, x)) return false; }
      else if (s.additionalProperties === false) return false;
    }
  }
  return true;
}
const kwOf = (s) => {
  const k = new Set(); const walk = (x) => { if (!isRec(x)) { if (Array.isArray(x)) x.forEach(walk); return; }
    if (x.propertyNames?.pattern) k.add('propertyNames.pattern'); if (isRec(x.additionalProperties)) k.add('additionalProperties:schema');
    if (x.minProperties !== undefined) k.add('minProperties'); if (x.anyOf) k.add('anyOf'); Object.values(x).forEach(walk); };
  walk(s); return k.size ? [...k].sort().join('+') : 'plain';
};

// collect the saved cells checks as run2.mjs does
const root = path.join(os.homedir(), '.config/fwdloop/flows');
const shapes = new Map();
let nChecks = 0;
for (const name of fs.readdirSync(root).sort()) {
  const d = path.join(root, name);
  if (!fs.existsSync(path.join(d, 'declaration.json')) || !fs.existsSync(path.join(d, 'signature.json'))) continue;
  let decl; try { decl = JSON.parse(fs.readFileSync(path.join(d, 'declaration.json'), 'utf8')); parseSignedText(fs.readFileSync(path.join(d, 'prose.txt'), 'utf8')); } catch { continue; }
  for (const st of Array.isArray(decl.steps) ? decl.steps : []) {
    const sheet = st?.close?.sheet;
    if (!(st?.close?.class === 'green' && Array.isArray(sheet))) continue;
    for (const c of sheet.filter(isRec)) {
      if (c.rule !== 'cells') continue;
      const cs = claimSchema(bareguardChecks([c])[0]);
      if (!cs) continue;
      nChecks++;
      const s = JSON.parse(JSON.stringify(cs));
      if (!s.anyOf && !s.required && isRec(s.properties) && Object.keys(s.properties).length === 1) s.required = Object.keys(s.properties); // the only addition
      const sig = JSON.stringify(s);
      const e = shapes.get(sig) ?? { schema: s, ops: new Set(), n: 0 }; e.ops.add(c.op); e.n += 1; shapes.set(sig, e);
    }
  }
}
log(`cells checks ${nChecks}; distinct claimSchema shapes ${shapes.size}`);

const { provider, rates, modelId } = makeProvider('DEEPSEEK_API_KEY', { model: 'deepseek-flash', env: process.env, ...LIVE_PROVIDER_OPTIONS });
log(`model ${modelId}; thinkingMode off per call; maxTokens 2000`);
const meterings = []; let unmetered = 0; let i = 0;
for (const { schema, ops, n } of shapes.values()) {
  i += 1;
  const spent = sumMeterings(meterings).costUsd ?? 0;
  if (spent > CAP - 0.005) { log(`STOP: spend ${spent} too near cap`); break; }
  let captured; let threw = null; const events = [];
  const tool = { name: 'answer', description: 'Give the answer.', parameters: { type: 'object', properties: { claim: schema }, required: ['claim'] }, execute: async (a) => { captured = a; throw new HaltError('captured', { rule: 'captured' }); } };
  const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); meterings.push(ev); } });
  const user = `Table has rows 2-6 with Amount 12, 30, 7, 45, 18 and Ids a, b, a, c, d. Report the result for ${[...ops].join('/')} using made-up but plausible numbers; use row numbers 2-6 only. Call answer.`;
  try { await loop.run([{ role: 'system', content: 'You answer only by calling the tool.' }, { role: 'user', content: user }], [tool], { maxTokens: 2000, thinkingMode: 'off', toolChoice: { name: 'answer' } }); } catch (err) { threw = err; if (events.length === 0) unmetered += 1; }
  let verdict;
  if (captured !== undefined) verdict = validate(tool.parameters, captured) ? 'accepted, valid' : 'accepted, ANSWERED-BUT-INVALID';
  else if (threw && !(threw instanceof HaltError)) verdict = `REJECTED/ERROR: ${String(threw.message).slice(0, 300)}`;
  else verdict = 'no tool call';
  log(`shape ${i} [${kwOf(schema)}] ops ${[...ops].join(',')} (${n} checks): ${verdict}`);
  log(`  schema ${JSON.stringify(schema)}`);
  if (captured !== undefined) log(`  reply ${JSON.stringify(captured).slice(0, 300)}`);
}
const m = sumMeterings(meterings);
log(`unmetered ${unmetered}; rounds ${m.rounds}; cost ${m.costUsd}; tokens ${JSON.stringify(m.tokens)}`);
fs.writeFileSync(path.join(here, 'result-1.log'), logs.join('\n') + '\n');
