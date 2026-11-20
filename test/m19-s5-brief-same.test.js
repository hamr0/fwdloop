// M19 S5, amendment B ("a step with no shape part gets a changed brief" is a Must fail): every step of every declaration fixture of the repo is briefed (the user message and the emit_artifact schema one call sends) and compared with
// a snapshot taken on the code BEFORE S5 (commit 70c8c9e7, `test/fixtures/m19-s5-brief-snapshot.json`). Regenerate only on code with no shape part: WRITE_BRIEF_SNAPSHOT=1. $0, fake provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { makeLiveModelStep } from '../src/model-step.js';

const ROOT = new URL('./fixtures/', import.meta.url).pathname;
const SNAP = path.join(ROOT, 'm19-s5-brief-snapshot.json');
const walk = (/** @type {string} */ d) => readdirSync(d).flatMap((e) => { const q = path.join(d, e); return statSync(q).isDirectory() ? walk(q) : [q]; });
const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** every step of every declaration fixture: `{id, step}` */
function stepsOfFixtures() {
  /** @type {{id: string, step: any}[]} */ const out = [];
  for (const f of walk(ROOT).filter((x) => x.endsWith('.json') && !x.includes('m19-block-snapshot') && !x.includes('m19-s5-brief'))) {
    let j; try { j = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    if (!isRec(j) || !Array.isArray(j.steps)) continue;
    j.steps.forEach((/** @type {any} */ st, /** @type {number} */ i) => { if (isRec(st) && isRec(st.close)) out.push({ id: `${path.relative(ROOT, f)}#${i}`, step: st }); });
  }
  return out;
}

/** the runner's own `stepMeta` (src/runner.js, the line where it is frozen), then the one call's user message and tool schema */
async function briefOf(/** @type {any} */ step) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-s5brief-'));
  try {
    /** @type {any[]} */ const seen = [];
    const provider = {
      generate: async (/** @type {any} */ messages, /** @type {any} */ tools) => {
        seen.push({ messages: JSON.parse(JSON.stringify(messages)), tools: JSON.parse(JSON.stringify(tools ?? [])) });
        return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
      },
    };
    const run = makeLiveModelStep({ spendPath: path.join(dir, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
    const c = step.close;
    const stepMeta = {
      class: c?.class ?? null, cited: c?.class === 'green' && c.cited ? c.cited : null, sheet: c?.class === 'green' && Array.isArray(c.sheet) ? c.sheet : null,
      withText: c?.class === 'green' && Array.isArray(c.picked) && c.picked.length > 0, picked: c?.class === 'green' && Array.isArray(c.picked) ? c.picked : null, attempt: 1, step: step.emits ?? step.goal ?? null,
      itemShape: isRec(c?.itemShape) ? c.itemShape : null, line: step.fromLine ?? null,
    };
    // a signed close the live step cannot answer (the retired cell cite) throws before any call: that is its brief too
    try { await run({ goal: step.goal, primitives: [], reads: { page: { kind: 'text', text: 'the saved page' } }, gap: null }, {}, stepMeta); } catch (/** @type {any} */ e) { return { threw: String(e.message) }; }
    return { user: seen[0].messages.find((/** @type {any} */ m) => m.role === 'user').content, system: seen[0].messages.find((/** @type {any} */ m) => m.role === 'system').content, tools: seen[0].tools };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('every step of every declaration fixture is briefed byte-for-byte as before S5 (user message, system message, emit_artifact schema)', async () => {
  const all = {};
  for (const { id, step } of stepsOfFixtures()) all[id] = await briefOf(step);
  if (process.env.WRITE_BRIEF_SNAPSHOT === '1') { writeFileSync(SNAP, `${JSON.stringify(all, null, 1)}\n`); return; }
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  assert.deepEqual(Object.keys(all).sort(), Object.keys(snap).sort(), 'the same steps');
  assert.ok(Object.keys(all).length >= 20, `a real set of steps (${Object.keys(all).length})`);
  for (const id of Object.keys(snap)) assert.deepEqual(all[id], snap[id], id);
});
