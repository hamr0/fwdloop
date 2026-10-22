// Test-only draft provider for bin/fwdloop's NODE_ENV=test + FWDLOOP_TEST_DRAFT_PROVIDER gate.
// FWDLOOP_TEST_DRAFT_MODE=timeout -> a validator-red round, then the provider throws ETIMEDOUT (an unpriced call).
// FWDLOOP_TEST_DRAFT_MODE=hang -> a validator-red round, then the second call never returns (a draft a test kills mid-way, M4e).
// FWDLOOP_TEST_DRAFT_MODE=greedy -> the model tries to author the cap, a send target, an ask TTL and an input path (M4e (xii)): a red draft.
// FWDLOOP_TEST_DRAFT_MODE=echo-key-die -> the provider prints $DEEPSEEK_API_KEY to stdout and stderr, then the process dies (M4e (ix)).
// FWDLOOP_TEST_DRAFT_MODE=echo-key-red -> the provider throws an error whose message carries $DEEPSEEK_API_KEY (M4e (ix)).
// M4e amendment 14: a revise is a plain fresh draft of the edited card, so there is no revise mode. Per-card test switches, read from the
// SYSTEM prompt (the job lines are in it):
//   a line containing REDMARK -> the model grants an unwired verb (a red plan); HANGMARK -> the call never returns (a draft a test watches in flight).
// FWDLOOP_TEST_DRAFT_LOG=<file> -> every provider call's messages are appended there as one JSON line (what the model was actually sent).
// M4e amendments 24/25: a line containing QMARK -> the model fails tries 1 and 2 (an unwired verb) and, on the try whose schema OFFERS `questions`,
//   returns a valid plan plus questions (default: two about line 3; FWDLOOP_TEST_DRAFT_QUESTIONS=<json array> replaces them). Once the prompt carries
//   ANSMARK (an answer, which the panel adds as a guardrail line) it returns a valid plan and asks nothing.
//   FWDLOOP_TEST_DRAFT_OFFERED_LOG=<file> -> one line per provider call: "offered" or "not-offered" (was `questions` in the tool schema).
// FWDLOOP_TEST_DRAFT_THINKING_STATUS=<applied|unsupported|ignored|unknown> -> every reply carries that bareagent `thinkingStatus` (M4d am7).
// FWDLOOP_TEST_DRAFT_RETRY=<n> -> the first n provider calls return a validator-red plan, the next is valid (M4d am10: a draft with retries).
// FWDLOOP_TEST_DRAFT_MAP=<json> -> the page-map call answers that map (default: every ~ rule tied to its own word of the default page, so nothing is asked).
// FWDLOOP_TEST_DRAFT_SHEET=<json> -> the sheet-word call (M10 piece 5; a CSV job with a ~ rule) answers that (default: no word, so nothing is asked).
// FWDLOOP_TEST_DRAFT_PAGE=<file> -> the fetched page's text (default: a small Boston-Chicago results page).
// FWDLOOP_TEST_DRAFT_MODE=bad -> the model always grants an unwired verb (a red draft).
import { appendFileSync, readFileSync } from 'node:fs';
import { RATES, MODEL, validArgs, fakeProvider, toolReply, textReply } from '../drafter-fixture.mjs';
import { pageText } from './m10-page-server.mjs';
import { MAP_SYSTEM } from '../../src/pagemap.js';
import { SHEET_MARK } from '../../src/sheetlook.js';

// M10: a job that signs a web page is fetched at drafting. The test provider hands the drafter a fetch seam (any address -> a fixed results page, no network)
// and answers the page-map call (recognised by its system words) with an empty map: no word kept, none dropped.
const fetchPage = async (url) => ({ ok: true, text: process.env.FWDLOOP_TEST_DRAFT_PAGE ? readFileSync(process.env.FWDLOOP_TEST_DRAFT_PAGE, 'utf8') : pageText(), url }); // FWDLOOP_TEST_DRAFT_PAGE=<file> -> that text is the fetched page

// The default page-map answer ties EVERY ~ rule of the job to its own word of the default page ("Flight A0", "Flight A1", ...), so a job with a page input drafts
// without the look's asks (M10 piece 3: a rule no kept word serves is asked about). FWDLOOP_TEST_DRAFT_MAP replaces it.
const tiedMap = (content) => {
  let line = 0;
  let i = 0;
  const facts = [];
  for (const l of String(content).split('\n')) {
    const a = /^LINE (\d+): /.exec(l);
    if (a) { line = Number(a[1]); continue; }
    const b = /^~ rule (\d+): /.exec(l);
    if (b) { facts.push({ name: `rule ${String.fromCharCode(97 + i)}`, from: `line ${line} rule ${b[1]}`, shape: 'phrase', words: [`Flight A${i}`] }); i += 1; }
  }
  return JSON.stringify({ facts });
};

export default function make() {
  const args = validArgs();
  if (process.env.FWDLOOP_TEST_DRAFT_NOTCHECKED) args.notChecked = JSON.parse(process.env.FWDLOOP_TEST_DRAFT_NOTCHECKED); // the drafter's own "not checked" list on every plan
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'bad') args.steps[2].primitives = ['forget'];
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'greedy') {
    Object.assign(args, { capUsd: 99, sends: [{ line: 1, target: 'file:/etc' }], asks: [{ line: 4, ttlMs: 1 }], sources: [{ role: 'x', path: '/etc/passwd' }] });
  }
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'echo-key-die' || process.env.FWDLOOP_TEST_DRAFT_MODE === 'echo-key-red') {
    const provider = fakeProvider([toolReply(args)]);
    provider.generate = async () => {
      const key = process.env.DEEPSEEK_API_KEY;
      if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'echo-key-red') throw new Error(`upstream rejected key ${key}`);
      process.stdout.write(`PROVIDER-ECHO key=${key}\n`);
      process.stderr.write(`PROVIDER-ECHO key=${key}\n`);
      process.exit(3);
    };
    return { provider, rates: RATES, modelId: MODEL };
  }
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'hang') {
    args.steps[2].primitives = ['forget'];
    const provider = fakeProvider([toolReply(args)]);
    const gen = provider.generate.bind(provider);
    provider.generate = async (...a) => {
      if (provider.calls.length >= 1) return new Promise((r) => { setTimeout(r, 3_600_000); });
      return gen(...a);
    };
    return { provider, rates: RATES, modelId: MODEL };
  }
  if (process.env.FWDLOOP_TEST_DRAFT_MODE === 'timeout') {
    args.steps[2].primitives = ['forget'];
    const provider = fakeProvider([toolReply(args)]);
    const gen = provider.generate.bind(provider);
    provider.generate = async (...a) => {
      if (provider.calls.length >= 1) throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
      return gen(...a);
    };
    return { provider, rates: RATES, modelId: MODEL };
  }
  const redArgs = validArgs();
  for (const i of (process.env.FWDLOOP_TEST_DRAFT_REDSTEP ?? '2').split(',').map(Number)) redArgs.steps[i].primitives = ['forget']; // FWDLOOP_TEST_DRAFT_REDSTEP=0,1 -> which steps of a QMARK/REDMARK red plan fail
  const provider = fakeProvider([toolReply(args)]);
  const gen = provider.generate.bind(provider);
  let retriesDone = 0;
  provider.generate = async (messages, ...rest) => {
    if (messages.find((m) => m.role === 'system')?.content === MAP_SYSTEM && String(messages.find((m) => m.role === 'user')?.content).includes(SHEET_MARK)) return { ...textReply(process.env.FWDLOOP_TEST_DRAFT_SHEET ?? '{"facts":[]}'), usage: { inputTokens: 1000, outputTokens: 20 } }; // the sheet-word call
    if (messages.find((m) => m.role === 'system')?.content === MAP_SYSTEM) return { ...textReply(process.env.FWDLOOP_TEST_DRAFT_MAP ?? tiedMap(messages.find((m) => m.role === 'user')?.content)), usage: { inputTokens: 1000, outputTokens: 20 } }; // the page-map call, not a drafting round (FWDLOOP_TEST_DRAFT_MAP=<json> replaces the empty map)
    const offered = !!rest[0]?.[0]?.parameters?.properties?.questions;
    if (process.env.FWDLOOP_TEST_DRAFT_OFFERED_LOG) appendFileSync(process.env.FWDLOOP_TEST_DRAFT_OFFERED_LOG, `${offered ? 'offered' : 'not-offered'}\n`);
    if (process.env.FWDLOOP_TEST_DRAFT_LOG) appendFileSync(process.env.FWDLOOP_TEST_DRAFT_LOG, `${JSON.stringify(messages)}\n`);
    const system = String(messages.find((m) => m.role === 'system')?.content ?? '');
    if (Number(process.env.FWDLOOP_TEST_DRAFT_RETRY ?? 0) > retriesDone) { retriesDone += 1; return toolReply(redArgs); }
    if (system.includes('HANGMARK')) return new Promise((r) => { setTimeout(r, 3_600_000); });
    if (system.includes('REDMARK')) return toolReply(redArgs);
    if (system.includes('QMARK') && !system.includes('ANSMARK')) {
      const qs = process.env.FWDLOOP_TEST_DRAFT_QUESTIONS
        ? JSON.parse(process.env.FWDLOOP_TEST_DRAFT_QUESTIONS)
        : [{ line: 3, question: 'What does "3 sections" mean here?' }, { line: 3, question: 'Which words count toward the limit?' }];
      return toolReply(offered ? { ...(process.env.FWDLOOP_TEST_DRAFT_QRED ? redArgs : args), questions: qs, notChecked: ['whether the tone suits the role'] } : redArgs); // QRED=1: the asking try's own plan is red too
    }
    // an answer adds a guardrail line under job line 1 and/or 2: classify them (hitl) like the model would, so the plan stays valid
    if (system.includes('ANSMARK')) return toolReply({ ...args, guardrailClasses: { ...args.guardrailClasses, 1: 'hitl', 2: 'hitl' } });
    return gen(messages, ...rest);
  };
  const status = process.env.FWDLOOP_TEST_DRAFT_THINKING_STATUS;
  if (status) {
    const inner = provider.generate.bind(provider);
    provider.generate = async (...a) => ({ ...(await inner(...a)), thinkingStatus: status });
  }
  return { provider, rates: RATES, modelId: MODEL, fetchPage };
}
