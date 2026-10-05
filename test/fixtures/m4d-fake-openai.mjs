// Test-only (M4d piece 2): replace the network call of bare-agent's OpenAI provider with a scripted reply that
// reports a fixed `usage`, so a REAL `makeProvider` -> `Loop` path (the price lookup, the rates, the booking) runs at $0.
// `install(usage)` patches `OpenAI.prototype.generate` and returns a restore function. The reply depends on the
// tool offered: `emit_declaration` (the drafter) gets the known-valid declaration once; `emit_artifact` (a model
// step) gets one artifact, then a plain stop on the next round.
import { OpenAI } from 'bare-agent/providers';
import { validArgs } from '../drafter-fixture.mjs';

export function install(usage) {
  const orig = OpenAI.prototype.generate;
  OpenAI.prototype.generate = async function fake(messages, tools = []) {
    const names = tools.map((t) => t.name);
    const answered = messages.some((m) => m.role === 'tool');
    const base = { usage, model: 'deepseek-flash' };
    if (names.includes('emit_declaration')) {
      return {
        ...base, text: '', toolCalls: [{ id: 'd1', name: 'emit_declaration', arguments: validArgs() }], stopReason: 'tool_calls',
      };
    }
    if (names.includes('emit_artifact') && !answered) {
      const text = '## summary of work history blurb\nworked.\n## professional skills\nskills.\n## soft skills\nsoft.';
      return {
        ...base, text: '', toolCalls: [{ id: 'a1', name: 'emit_artifact', arguments: { text, done: true, blocker: null } }], stopReason: 'tool_calls',
      };
    }
    return {
      ...base, text: 'done', toolCalls: [], stopReason: 'stop',
    };
  };
  return () => { OpenAI.prototype.generate = orig; };
}
