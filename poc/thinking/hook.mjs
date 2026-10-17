// POC (throwaway, never shipped): called from the engine copy's model-step. Picks the arm's thinkingMode for this
// call and records, per provider.generate call, what mode REACHED the provider and the thinkingStatus it reported.
// Env: FWDLOOP_POC_ARM (today|on|retry), FWDLOOP_POC_CALLS (a jsonl path; one line per generate call).
import { appendFileSync } from 'node:fs';
import { thinkingModeFor } from './arm.mjs';

let current = { step: null, attempt: null };
const SEEN = Symbol.for('fwdloop.poc.instrumented');

/** @param {any} provider @param {{attempt?:number, stepId?:string|null}} stepMeta @returns {{opts: {thinkingMode?: 'on'|'off'}}} */
export function pocBegin(provider, stepMeta = {}) {
  const arm = process.env.FWDLOOP_POC_ARM;
  if (!arm) throw new Error('POC engine: FWDLOOP_POC_ARM is not set (today|on|retry)');
  current = { step: stepMeta.stepId ?? null, attempt: stepMeta.attempt ?? null };
  const out = process.env.FWDLOOP_POC_CALLS;
  if (out && provider && typeof provider.generate === 'function' && !provider[SEEN]) {
    const orig = provider.generate;
    provider[SEEN] = true;
    provider.generate = async function pocGenerate(messages, tools, options) {
      const t0 = Date.now();
      const rec = { step: current.step, attempt: current.attempt, arm, modeSent: options && 'thinkingMode' in options ? options.thinkingMode : null, hasKey: !!(options && 'thinkingMode' in options) };
      try {
        const res = await orig.call(this, messages, tools, options);
        appendFileSync(out, `${JSON.stringify({ ...rec, thinkingStatus: res?.thinkingStatus ?? null, toolCalls: (res?.toolCalls ?? []).map((c) => c.name), stopReason: res?.stopReason ?? null, wallMs: Date.now() - t0 })}\n`);
        return res;
      } catch (err) {
        appendFileSync(out, `${JSON.stringify({ ...rec, thinkingStatus: null, toolCalls: [], error: String(err?.message ?? err).slice(0, 200), wallMs: Date.now() - t0 })}\n`);
        throw err;
      }
    };
  }
  const mode = thinkingModeFor(arm, stepMeta.attempt);
  return { opts: mode === undefined ? {} : { thinkingMode: mode } };
}

/** Fake ($0) runs only: FWDLOOP_POC_SEND_DIR redirects the send into a sink so a fake run never writes the signed real destination. Unset on live runs. */
export function pocSendTarget(target) {
  const d = process.env.FWDLOOP_POC_SEND_DIR;
  return d ? `file:${d}` : target;
}
