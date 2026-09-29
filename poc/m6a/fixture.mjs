// M6a POC test helpers: a fake provider (bare-agent's generate() contract),
// a tmp input dir, and the job #2 prose pointed at it. Test-only.
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';

export const RATES = { in: 0.0003, out: 0.0012 };
export const MODEL = 'deepseek-flash';

/** The signed job #2 prose with both sources pointed at tmp .md files. */
export function job2Fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m6a-'));
  const resume = path.join(dir, 'resume.md');
  const jd = path.join(dir, 'jd.md');
  writeFileSync(resume, '# Jo Doe\n\nSenior engineer, ten years.\n');
  writeFileSync(jd, '# About the role\n\nBuild things.\n\n## Responsibilities\n\nShip.\n');
  const prose = readFileSync(new URL('./job2.prose.txt', import.meta.url), 'utf8')
    .replace('@RESUME@', resume).replace('@JD@', jd);
  return { dir, prose, resume, jd };
}

/** The known-valid target: test/fixtures/job2.m1.declaration.json minus the
 *  harness-supplied inputFacts, with the resume read as text (the tmp resume
 *  is markdown). */
export function validArgs() {
  const d = JSON.parse(readFileSync(new URL('../../test/fixtures/job2.m1.declaration.json', import.meta.url), 'utf8'));
  delete d.inputFacts;
  d.steps[0].primitives = ['read'];
  return d;
}

const usage = (o = 200) => ({ inputTokens: 1000, outputTokens: o });

export const toolReply = (args) => ({
  text: '', toolCalls: [{ id: 't1', name: 'emit_declaration', arguments: args }], usage: usage(), stopReason: 'tool_calls', model: MODEL,
});
export const textReply = (text = 'sure') => ({ text, toolCalls: [], usage: usage(50), stopReason: 'stop', model: MODEL });
export const truncatedReply = () => ({ text: '{"steps":[', toolCalls: [], usage: usage(16000), stopReason: 'max_tokens', model: MODEL });
export const malformedReply = () => ({ text: '', toolCalls: [], usage: usage(80), stopReason: 'tool_use', model: MODEL, malformedToolCall: { name: 'emit_declaration', rawArguments: '{"steps":[}', error: 'bad json at 9' } });

/** A scripted provider: replies[i] answers call i (the last repeats). Records every call. */
export function fakeProvider(replies) {
  const calls = [];
  const provider = {
    lastMalformedToolCall: null,
    calls,
    async generate(messages, tools, options) {
      calls.push({ messages: JSON.parse(JSON.stringify(messages)), tools: tools.map((t) => t.name), options });
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      this.lastMalformedToolCall = r.malformedToolCall ?? null;
      return r;
    },
  };
  return provider;
}
