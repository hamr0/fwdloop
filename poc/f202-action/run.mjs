// F202 harness ($0): real writeFlow / runFlow / resumeRun / makeParkingAskStep / answerAsk / sendViaPrimitive; fake modelStep. POC only.
// usage: node poc/f202-action/run.mjs   (writes JSON results to .claude/scratch/f202/results.json)
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFlow } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../../src/runner.js';
import { answerAsk, serializeArtifact, sha256Hex } from '../../src/ask.js';
import { sendViaPrimitive } from '../../src/send.js';
import { parseJobBox } from '../../src/panel/authorcard.js';
import { addEnd } from '../../src/added-end.js';
import { decideSend } from './decide.mjs';

const cat = loadCatalogue();
if (!cat.ok) throw new Error(cat.reds.join('\n'));
const CATALOGUE = cat.primitives;
const OUT = {};
const tmp = (p) => mkdtempSync(join(tmpdir(), `f202-${p}-`));

// ---- (a) addEnd on the card's parsed job
{
  const job = 'Read the notes,\nwrite 3 lines about the garden,\nand once I accept, write it out.';
  const { steps, added } = addEnd(parseJobBox(job).steps, '/some/folder');
  OUT.a = { typed: parseJobBox(job).steps.length, afterAddEnd: steps.map((s) => `${s.n}. ${s.text}`), added };
}

const decl = (steps, extra = {}) => ({ guardrailClasses: {}, unjudgeable: {}, refused: [], inputFacts: {}, steps, ...extra });
const step = (n, goal, reads, emits, primitives = [], close = { class: 'hitl' }) => ({ goal, primitives, reads, emits, fromLine: n, close });
const sign = (root, name, prose, declaration) => writeFlow({ root, name, proseText: prose, declaration, signedBy: 'hamr', signedAt: '2026-11-16T12:00:00Z', catalogue: CATALOGUE });
const arbiter = (sendLine, dir) => `\nArbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):\nguardrail: cap $0.25 per run\n${sendLine == null ? '' : `guardrail: send at line ${sendLine} to file:${dir}\n`}`;

// ---- (b) no Ask anywhere
{
  const root = tmp('b'); const dir = tmp('b-out');
  const prose = `1. write a short note about the garden,\n2. and once I accept, write it out.\n${arbiter(2, dir)}`;
  const d = decl([step(1, 'write a short note', [], 'note', ['read']), step(2, 'write it out', ['note'], 'note-out', ['write'])]);
  const r = sign(root, 'b1', prose, d);
  OUT.b1_signed_send_no_ask = { ok: r.ok, reds: r.reds ?? null };
  // b2: no send slot at all, last step just granted write, no ask
  const prose2 = `1. write a short note about the garden,\n2. write it out.\n${arbiter(null, dir)}`;
  const r2 = sign(root, 'b2', prose2, decl([step(1, 'write a short note', [], 'note', ['read']), step(2, 'write it out', ['note'], 'note-out', ['write'])]));
  OUT.b2_no_slot_write_step_no_ask = { ok: r2.ok, reds: r2.reds ?? null };
  if (r2.ok) {
    const run = await runFlow({ root, name: 'b2', runId: 'run-1', sources: [], catalogue: CATALOGUE, businessDate: '2026-06-01', primitives: {},
      modelStep: async () => ({ ok: true, costUsd: 0, artifact: { text: 'hello', done: true } }),
      sendStep: async () => { throw new Error('sendStep must not be called'); } });
    OUT.b2_run = { outcome: run.outcome, red: run.red ?? null, outDirFiles: readdirSync(dir) };
  }
}

// ---- (c) and (d): ask, then (d only) a changing step, then the send. file: is the labelled stand-in for "outside".
async function ask_then_send({ label, changeAfterAsk }) {
  const root = tmp(label); const dir = tmp(`${label}-out`);
  const lines = changeAfterAsk
    ? ['write a short note about the garden,', 'ask: check it with me,', 'add a footer line to the note,', 'and then send it out.']
    : ['write a short note about the garden,', 'ask: check it with me,', 'and once I accept, send it out.'];
  const prose = `${lines.map((t, i) => `${i + 1}. ${t}${changeAfterAsk && i === 2 ? '\n   guardrail: under 100 words, one section called note' : ''}`).join('\n')}\n${arbiter(lines.length, dir)}`;
  const steps = changeAfterAsk
    ? [step(1, 'write a short note', [], 'note', ['read']), step(2, 'check it with me', ['note'], 'note-ok'), step(3, 'add a footer line to the note', ['note-ok'], 'note2', ['read'], { class: 'softgreen', shape: { sections: ['note'], maxWords: 100 } }),
      step(4, 'send it out', ['note-ok', 'note2'], 'sent', ['write'])]
    : [step(1, 'write a short note', [], 'note', ['read']), step(2, 'check it with me', ['note'], 'note-ok'), step(3, 'send it out', ['note-ok'], 'sent', ['write'])];
  const signed = sign(root, label, prose, decl(steps, changeAfterAsk ? { guardrailClasses: { 3: 'softgreen' } } : {}));
  if (!signed.ok) return { signed: false, reds: signed.reds };
  const calls = { model: [], sends: [] };
  const modelStep = async (ctx) => {
    calls.model.push(ctx.goal);
    return { ok: true, costUsd: 0, artifact: { text: ctx.goal.includes('footer') ? '## note\na note about the garden FOOTER ADDED AFTER ACCEPT' : 'a note about the garden', done: true } };
  };
  const sendStep = async (target, filename, content, acceptedSha, ctx) => {
    const r = await sendViaPrimitive(target, filename, content, acceptedSha, ctx);
    calls.sends.push({ acceptedSha, contentSha: sha256Hex(serializeArtifact(content)), ok: r.ok, red: r.red ?? null });
    return r;
  };
  const base = { root, name: label, catalogue: CATALOGUE, modelStep, sendStep, primitives: {}, businessDate: '2026-06-01' };
  const parked = await runFlow({ ...base, runId: 'run-1', sources: [], askStep: makeParkingAskStep() });
  const stops = [];
  let cur = parked;
  const trace = [];
  while (cur.outcome === 'paused') {
    stops.push({ askId: cur.askId });
    const acc = answerAsk({ runDir: parked.runDir, askId: cur.askId, decision: 'accept' });
    if (!acc.ok) { trace.push(acc.red); break; }
    cur = await resumeRun({ ...base, runId: 'run-1' });
  }
  return { signed: true, stops: stops.length, final: cur.outcome, red: cur.red ?? null, calls, runDir: parked.runDir, outDir: dir, outFiles: readdirSync(dir), trace };
}
OUT.c = await ask_then_send({ label: 'c', changeAfterAsk: false });
OUT.d = await ask_then_send({ label: 'd', changeAfterAsk: true });

// ---- run records: accept sha (answer.<askId>.consumed.json .artifactSha256, joined by asks/<askId>.json .emits) and the artifact files
function records(runDir) {
  const asks = readdirSync(join(runDir, 'asks')).filter((f) => f.endsWith('.json'));
  const accepted = [];
  for (const f of asks) {
    const askId = f.slice(0, -5);
    const archive = JSON.parse(readFileSync(join(runDir, 'asks', f), 'utf8'));
    const mp = join(runDir, `answer.${askId}.consumed.json`);
    if (!existsSync(mp)) continue;
    const m = JSON.parse(readFileSync(mp, 'utf8'));
    if (m.decision === 'accept') accepted.push({ askId, emits: archive.emits, acceptedSha: m.artifactSha256 });
  }
  const art = {};
  for (const f of readdirSync(join(runDir, 'artifacts'))) art[f.replace(/\.json$/, '')] = sha256Hex(readFileSync(join(runDir, 'artifacts', f), 'utf8'));
  const files = readdirSync(runDir);
  return { accepted, artifactShas: art, runFiles: files };
}
// "outgoing" = what the action step would ship: the last artifact it reads. c: note-ok (the accepted one). d: note2 (the later one).
console.log(JSON.stringify({a:OUT.a,b1:OUT.b1_signed_send_no_ask,b2:OUT.b2_no_slot_write_step_no_ask,b2run:OUT.b2_run,c:OUT.c,d:OUT.d},null,1));
OUT.c.records = records(OUT.c.runDir);
OUT.d.records = records(OUT.d.runDir);
const lastAccept = (rec) => rec.accepted.at(-1)?.acceptedSha ?? null;
OUT.c.decide = decideSend({ destinationLeavesMachine: true, acceptedSha: lastAccept(OUT.c.records), outgoingSha: OUT.c.records.artifactShas['note-ok'] });
OUT.d.decide = decideSend({ destinationLeavesMachine: true, acceptedSha: lastAccept(OUT.d.records), outgoingSha: OUT.d.records.artifactShas['note2'] });
// and the same artifact's hash in d if the action had shipped the accepted one:
OUT.d.decide_if_ships_accepted = decideSend({ destinationLeavesMachine: true, acceptedSha: lastAccept(OUT.d.records), outgoingSha: OUT.d.records.artifactShas['note-ok'] });

mkdirSync(new URL('../../.claude/scratch/f202/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../.claude/scratch/f202/results.json', import.meta.url), JSON.stringify(OUT, null, 2));
console.log(JSON.stringify(OUT, null, 2));
