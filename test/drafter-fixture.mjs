// M6a drafter test helpers (ported from poc/m6a/fixture.mjs): a fake provider (bare-agent's generate() contract),
// a tmp input dir, and the job #2 prose pointed at it. Test-only.
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { SHAPE_SYSTEM } from '../src/shapelook.js';

export const RATES = { in: 0.0003, out: 0.0012 };
export const MODEL = 'deepseek-flash';

/** The signed job #2 prose with both sources pointed at tmp .md files. */
export function job2Fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m6a-'));
  const resume = path.join(dir, 'resume.md');
  const jd = path.join(dir, 'jd.md');
  writeFileSync(resume, '# Jo Doe\n\nSenior engineer, ten years.\n');
  writeFileSync(jd, '# About the role\n\nBuild things.\n\n## Responsibilities\n\nShip.\n');
  const prose = readFileSync(new URL('./fixtures/job2-m6a.prose.txt', import.meta.url), 'utf8')
    .replace('@RESUME@', resume).replace('@JD@', jd);
  // `proseG`: the same job with its line-3 guardrail (M10 am16: the default `prose` carries none, since a shape guardrail is settled by the person's pick); tests of a guardrail's own words use it
  const proseG = prose.replace('\n4. ask 30m', '\n   guardrail: 3 sections, all under 600 words\n4. ask 30m');
  return { dir, prose, proseG, resume, jd };
}

/** The known-valid target: test/fixtures/job2.m1.declaration.json minus the
 *  harness-supplied inputFacts, with the resume read as text (the tmp resume
 *  is markdown). */
export function validArgs() {
  const d = JSON.parse(readFileSync(new URL('./fixtures/job2.m1.declaration.json', import.meta.url), 'utf8'));
  delete d.inputFacts;
  d.steps[0].primitives = ['read'];
  // M10 am16: a line-3 guardrail is settled by the person's pick, so the fixture job carries none and the drafter's plan carries no check of its own
  delete d.guardrailClasses['3'];
  d.steps[2].close = { class: 'hitl' };
  return d;
}

const usage = (o = 200) => ({ inputTokens: 1000, outputTokens: o });

export const toolReply = (args) => ({
  text: '', toolCalls: [{ id: 't1', name: 'emit_declaration', arguments: args }], usage: usage(), stopReason: 'tool_calls', model: MODEL,
});
export const textReply = (text = 'sure') => ({ text, toolCalls: [], usage: usage(50), stopReason: 'stop', model: MODEL });
export const truncatedReply = () => ({ text: '{"steps":[', toolCalls: [], usage: usage(16000), stopReason: 'max_tokens', model: MODEL });
export const malformedReply = () => ({ text: '', toolCalls: [], usage: usage(80), stopReason: 'tool_use', model: MODEL, malformedToolCall: { name: 'emit_declaration', rawArguments: '{"steps":[}', error: 'bad json at 9' } });

/**
 * M17 am2 item 2: the AI suggests sheet checks on the row-edit reply (`sheetChecks`, each with its job line), never in the declaration. A test still writes its sheet checks as a step's `close.sheet` in the script;
 * this fixture moves them, as the AI now would: the declaration reply loses them (unless the reply has `carrySheet: true`, a draft that carries the field), the row-edit reply gets them with the step's line.
 * @param {any[]} replies @returns {any[]}
 */
const sheetSuggestionsOf = (replies) => {
  for (const r of replies) {
    const steps = r?.toolCalls?.[0]?.arguments?.steps;
    const out = (Array.isArray(steps) ? steps : []).flatMap((st) => (Array.isArray(st?.close?.sheet) ? st.close.sheet.map((c) => ({ ...c, line: st.fromLine })) : []));
    if (out.length) return out;
  }
  return [];
};
const withoutSheet = (r) => {
  if (r?.carrySheet === true || !Array.isArray(r?.toolCalls?.[0]?.arguments?.steps)) return r;
  const args = { ...r.toolCalls[0].arguments, steps: r.toolCalls[0].arguments.steps.map((st) => { if (!st?.close || st.close.sheet === undefined) return st; const { sheet: _s, ...close } = st.close; return { ...st, close }; }) };
  return { ...r, toolCalls: [{ ...r.toolCalls[0], arguments: args }, ...r.toolCalls.slice(1)] };
};

/** The last numbered line of the job listing an action question carries (what a default fake AI names as the action). */
const lastListedLine = (messages) => {
  const nums = [...String(messages[messages.length - 1]?.content ?? '').matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  return nums.length ? nums[nums.length - 1] : null;
};

/** A scripted provider: replies[i] answers call i (the last repeats). Records every call. */
export function fakeProvider(replies) {
  const calls = [];
  const blockCalls = [];
  const shapeCalls = [];
  const blockTurns = []; // M17 am2: each list turn's tool schema and messages, for tests that read what the AI is offered and told
  const provider = {
    recognise: /** @type {number|null|undefined} */ (process.env.FWDLOOP_TEST_DRAFT_ACTION === 'none' ? null : undefined), // undefined = the AI names the job's last line; null = none; a number = that line
    suggest: /** @type {string|undefined} */ (process.env.FWDLOOP_TEST_DRAFT_ACTION_LINE),
    lastMalformedToolCall: null,
    calls,
    blockCalls,
    shapeCalls,
    blockTurns,
    async generate(messages, tools, options) {
      // M16 (a) missing stub: the check block's own turns (ledger-suggest, row-edit) get an empty answer and take no place in the declaration queue these scripts are about
      // M17 p2e: the note question (one more turn of the list, when a line is facts-only) is answered "no" for every line it names, so it too stays out of the declaration queue
      const noteLines = tools[0]?.name === 'answer_note_question' ? [...String(messages.find((m) => /^LINE \d+:/m.test(String(m.content)))?.content ?? '').matchAll(/^LINE (\d+):/gm)].map((m) => ({ line: Number(m[1]), writtenWords: 'no' })) : null;
      // M19 S2: the shape look (one call, no tool, asked when a `~` rule is still Not checked) is answered "no shape" and takes no place in the declaration queue these scripts are about (tests of the look itself: test/m19-s2-shapelook.test.js)
      if (tools.length === 0 && messages[0]?.content === SHAPE_SYSTEM) { shapeCalls.push(messages.length); return { text: process.env.FWDLOOP_TEST_DRAFT_SHAPE ?? '{"shapes":[]}', toolCalls: [], usage: usage(), stopReason: 'stop', model: MODEL }; }
      const blockTurn = { suggest_extra_checks: process.env.FWDLOOP_TEST_DRAFT_LEDGER ? JSON.parse(process.env.FWDLOOP_TEST_DRAFT_LEDGER) : { extra: [] }, submit_edits: { edits: [], ...(tools[0]?.parameters?.properties?.sheetChecks ? { sheetChecks: sheetSuggestionsOf(replies) } : {}) }, answer_note_question: noteLines ? { lines: noteLines } : undefined }[tools[0]?.name]; // FWDLOOP_TEST_DRAFT_LEDGER=<json> is the list's ledger-suggest answer
      if (blockTurn) { blockCalls.push(tools[0].name); blockTurns.push({ name: tools[0].name, schema: tools[0].parameters, messages: JSON.parse(JSON.stringify(messages)) }); return { text: '', toolCalls: [{ id: 'b1', name: tools[0].name, arguments: blockTurn }], usage: usage(), stopReason: 'tool_calls', model: MODEL }; }
      calls.push({ messages: JSON.parse(JSON.stringify(messages)), tools: tools.map((t) => t.name), schemas: tools.map((t) => t.parameters), options });
      // M13 am11: the two action questions are answered from `provider.recognise` (the line the AI names, or null) and `provider.suggest` (its one line); they take no place in the declaration queue
      if (tools[0]?.name === 'record_action') return { text: '', toolCalls: [{ id: 'a1', name: 'record_action', arguments: { action: { line: provider.recognise === undefined ? lastListedLine(messages) : provider.recognise } } }], usage: usage(), stopReason: 'tool_calls', model: MODEL };
      if (tools[0]?.name === 'suggest_action') return { text: '', toolCalls: [{ id: 'a2', name: 'suggest_action', arguments: { text: provider.suggest ?? 'Write it out to the Destination.' } }], usage: usage(), stopReason: 'tool_calls', model: MODEL };
      const asked = calls.filter((c) => c.tools[0] !== 'record_action' && c.tools[0] !== 'suggest_action').length;
      const r = withoutSheet(replies[Math.min(asked - 1, replies.length - 1)]);
      this.lastMalformedToolCall = r.malformedToolCall ?? null;
      return r;
    },
  };
  return provider;
}
