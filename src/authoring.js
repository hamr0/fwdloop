// M6a — authoring backend: `fwdloop draft` and `fwdloop sign` (docs/wiki/the-module-ladder.md,
// "M6a — authoring backend", scope items 4 and 5).
//
// borrowed-from: fwdloop poc/m6a/batch.mjs@867c25b (literal key scrub + end-of-run sweep).
//
// draftToDir  — paid step: run the drafter, write a draft dir. Never writes a flow.
// signDraft   — the human step, $0: re-check, then writeFlow with a human `signedBy`.
//
// The spec hash (`specHash`, the ONE function; draft prints it, sign recomputes it) covers
// exactly what the human reads and signs: prose + declaration + input facts + readout, each
// canonicalised (signature.js canonicalBytes: CRLF -> LF for text, sorted-key JSON).
// target.json (root + name: where the flow lands) is covered too, so editing it after draft
// cannot sign under a different name/dir than the readout showed. It does NOT cover log.json /
// spend.jsonl (a record of how the draft was made, not of what is signed).

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { draft } from './drafter.js';
import { parseSignedText, unsignedAskTtls } from './signed-text.js';
import { validateDeclaration } from './declaration.js';
import { loadCatalogue } from './catalogue.js';
import { WIRED_VERBS } from './primitives.js';
import { canonicalBytes } from './signature.js';
import { writeFlow, readFileInside, readdirInside, checkFlowName } from './flow.js';
import { checkSendDestination } from './runner.js';
import { PROVIDER_SLOTS, checkKeyPreflight, appendSpendRow } from './provider.js';

export const DRAFT_BUDGET_USD = 0.10;
export const SPEC_HASH_FILE = 'spec.hash';
/** Written when the end sweep finds a key in the draft dir; sign refuses a dir that has it. */
export const LEAK_MARKER_FILE = 'scrub-leak.red';
export const SIGN_LINE = (dir, hash) => `DRAFTED — NOT SIGNED. To sign: fwdloop sign ${dir} --approve ${hash}`;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The one spec hash. sha256 over the four canonical parts, JSON-array framed so no part can
 * bleed into the next. Never throws.
 * @param {{proseText:string, declarationText:string, inputFactsText:string, readoutText:string, targetText:string}} p
 * @returns {{ok:true, hash:string}|{ok:false, red:string}}
 */
export function specHash({
  proseText, declarationText, inputFactsText, readoutText, targetText,
}) {
  const prose = canonicalBytes('prose.txt', proseText);
  if (!prose.ok) return { ok: false, red: prose.red };
  const decl = canonicalBytes('declaration.json', declarationText);
  if (!decl.ok) return { ok: false, red: decl.red };
  // canonicalBytes' 'declaration.json' kind is the generic sorted-key JSON canonicaliser.
  const facts = canonicalBytes('declaration.json', inputFactsText);
  if (!facts.ok) return { ok: false, red: 'input-facts.json: is not valid JSON' };
  const readout = canonicalBytes('prose.txt', readoutText);
  if (!readout.ok) return { ok: false, red: readout.red };
  const target = canonicalBytes('declaration.json', targetText);
  if (!target.ok) return { ok: false, red: 'target.json: is not valid JSON' };
  const framed = JSON.stringify([sha(prose.bytes), sha(decl.bytes), sha(facts.bytes), sha(readout.bytes), sha(target.bytes)]);
  return { ok: true, hash: sha(Buffer.from(framed, 'utf8')) };
}

/** Literal (never RegExp) key scrub; a secret under 8 chars is skipped so it can't blank ordinary text. */
export function scrub(text, secrets) {
  let out = text;
  for (const s of secrets) if (typeof s === 'string' && s.length >= 8) out = out.split(s).join('[redacted-key]');
  return out;
}

/** Count files directly inside `dir` that contain a secret literally. */
export function sweepForSecrets(dir, secrets) {
  const live = secrets.filter((s) => typeof s === 'string' && s.length >= 8);
  if (live.length === 0) return 0;
  let leaks = 0;
  for (const name of readdirInside(dir, '.')) {
    const r = readFileInside(dir, name);
    if (r.ok && live.some((s) => r.text.includes(s))) leaks += 1;
  }
  return leaks;
}

/** Exact signed TTL with its unit, never rounded: 2h / 30m / 20s / 1500ms (the largest unit that divides it exactly). */
export function fmtTtl(ms) {
  if (!Number.isFinite(ms)) return String(ms);
  if (ms % 3600000 === 0 && ms > 0) return `${ms / 3600000}h`;
  if (ms % 60000 === 0 && ms > 0) return `${ms / 60000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

/** One cost renderer: an incomplete total is "at least", never a bare number. */
export const costText = (n, spendComplete = true) => {
  if (n == null) return 'UNKNOWN (unpriced round)';
  return spendComplete === false ? `at least $${n.toFixed(4)} (incomplete: a provider call is unpriced)` : `$${n.toFixed(4)}`;
};
const usd = costText;

/** Plain-text readout of what the human is about to sign. Pure. */
export function buildReadout({
  declaration, arbiter, lines, name, modelId, costUsd, rounds, spendComplete, root,
}) {
  const out = [];
  out.push(`DRAFT READOUT — NOT SIGNED — flow "${name}"`, '');
  out.push(`Drafted by: ${modelId ?? '?'} in ${rounds} round(s), cost ${usd(costUsd, spendComplete)}`);
  if (typeof root === 'string') out.push(`Flows root: ${root}  (the flow is written to <flows root>/${name} when you sign)`);
  out.push(`Cap per run (signed by you in the prose): $${arbiter.capUsd}`, '');
  out.push('INPUTS');
  for (const s of arbiter.sources) {
    const h = declaration.inputFacts?.[s.role];
    out.push(`  ${s.role} = ${s.path}${h ? `  [headings: ${h.join(' | ') || 'none'}]` : ''}`);
  }
  out.push('', 'STEPS');
  declaration.steps.forEach((st, i) => {
    out.push(`  ${i + 1}. (line ${st.fromLine}) ${st.goal}`);
    out.push(`     grants: ${st.primitives?.length ? st.primitives.join(', ') : 'none (pure stop)'}`
      + ` | reads: ${st.reads?.length ? st.reads.join(', ') : '-'} | emits: ${st.emits} | check: ${st.close?.class}`);
  });
  out.push('', 'ASKS (human stops)');
  for (const a of arbiter.asks) out.push(`  line ${a.line}: "${a.question}" (ttl ${fmtTtl(a.ttlMs)})`);
  if (arbiter.asks.length === 0) out.push('  none');
  out.push('', 'SEND TARGET (nothing leaves before an accepted ask)');
  for (const s of arbiter.sends) out.push(`  line ${s.line} -> ${s.target.kind}:${s.target.path}`);
  if (arbiter.sends.length === 0) out.push('  none');
  const refused = declaration.refused ?? [];
  if (refused.length) {
    out.push('', 'REFUSED LINES');
    for (const r of refused) out.push(`  line ${r.line}: ${r.reason}`);
  }
  out.push('', 'JOB LINES', ...lines.map((l) => `  ${l.n}. ${l.text}`));
  return `${out.join('\n')}\n`;
}

/** realpath of a path that may not exist yet: the real path of its nearest existing ancestor plus the rest. */
function realpathOfNew(p) {
  const rest = [];
  let cur = path.resolve(p);
  for (;;) {
    try { return path.join(realpathSync(cur), ...rest.reverse()); } catch (e) {
      const up = path.dirname(cur);
      if (up === cur || e.code === 'EACCES') return path.resolve(p);
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}

/** Read the prose file. Refuses (a red, never a throw) on unreadable or blank. */
export function readProseFile(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { return { ok: false, red: `prose: cannot read "${file}": ${e.code ?? e.message}` }; }
  if (text.trim() === '') return { ok: false, red: `prose: "${file}" is empty` };
  return { ok: true, text };
}

/**
 * Draft into `dir`. $0 refusals (return {ok:false, wrote:false}, nothing on disk): bad key,
 * unreadable/blank prose, prose that contains the key, missing inputs / bad signed text, dir
 * already exists. After a paid round the dir is ALWAYS written — green (spec.hash present) or
 * red (reds, no spec.hash). Spend is booked in `<dir>/spend.jsonl` with the runner's own
 * writer (appendSpendRow); an unpriced round books null, never 0.
 *
 * Test seam: `provider`/`rates`/`modelId` are injected; without them a live provider is built.
 */
export async function draftToDir({
  proseFile, dir, root, name, slot = 'deepseek', model, budgetUsd = DRAFT_BUDGET_USD, env = process.env, provider, rates, modelId,
}) {
  const refuse = (reds) => ({ ok: false, wrote: false, reds, costUsd: 0 });
  const nameCheck = checkFlowName(name);
  if (!nameCheck.ok) return refuse([nameCheck.red]);
  if (typeof root !== 'string' || root === '') return refuse(['draft: --root <flows dir> is required']);
  if (!(budgetUsd > 0)) return refuse(['draft: budget must be a positive number']);
  // An unsigned draft folder inside the flows root would list as a flow in the panel and Inbox (checked by realpath, at use time).
  const realRoot = realpathOfNew(root);
  const realDir = realpathOfNew(dir);
  const rel = path.relative(realRoot, realDir);
  if (rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))) {
    return refuse([`draft: "${dir}" is inside the flows root "${root}" — an unsigned draft would show as a flow; use a --out outside the flows root`]);
  }
  const read = readProseFile(proseFile);
  if (!read.ok) return refuse([String(read.red)]);
  const prose = { text: String(read.text) };
  const injected = provider != null;
  const secretVar = PROVIDER_SLOTS[slot]?.envVar;
  if (!injected) {
    const key = checkKeyPreflight(slot, env);
    if (!key.ok) return refuse([key.message]);
  }
  const secrets = secretVar && env[secretVar] ? [env[secretVar]] : [];
  if (secrets.some((s) => s.length >= 8 && prose.text.includes(s))) return refuse(['prose: contains an API key value — refused']);
  // Claim the dir BEFORE the paid round (exclusive mkdir: a race or an existing path refuses at $0).
  const exists = () => refuse([`draft: "${dir}" already exists — never overwritten, use a new dir`]);
  if (existsSync(dir)) return exists();
  try {
    mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
    mkdirSync(dir);
  } catch (e) {
    return e.code === 'EEXIST' ? exists() : refuse([`draft: cannot create "${dir}": ${e.code ?? e.message}`]);
  }

  const result = await draft({
    proseText: prose.text, slot, model, budgetUsd, provider, rates, modelId,
  });
  if (result.stop === 'pre-flight') {
    try { rmdirSync(dir); } catch { /* the claimed dir is still empty; leave it rather than mask the refusal */ }
    return refuse(result.reds);
  }

  // After a paid round: never a silent throw. The cost is returned so the caller prints it; the dir is claimed and stays.
  const paidFail = (red) => ({
    ok: false, wrote: true, dir, reds: [red], costUsd: result.costUsd, spendComplete: result.spendComplete, stop: 'write', rounds: result.rounds, calls: result.calls, leaks: 0,
  });
  const parsed = parseSignedText(prose.text); // the drafter already proved it parses
  if (!parsed.ok) return paidFail(`parse: ${parsed.reds.join('; ')}`);
  const dj = (o) => `${JSON.stringify(o, null, 2)}\n`;
  const files = {};
  files['prose.txt'] = prose.text; // verbatim
  const targetText = dj({ root, name });
  files['target.json'] = targetText;
  files['log.json'] = scrub(dj({
    ok: result.ok, stop: result.stop, reds: result.reds, rounds: result.rounds, calls: result.calls, costUsd: result.costUsd, spendComplete: result.spendComplete,
    modelId: result.modelId, modelReturned: result.modelReturned, structureRetries: result.structureRetries,
    revisions: result.revisions, log: result.log,
  }), secrets);
  let hash = null;
  if (result.ok) {
    const declarationText = scrub(dj(result.declaration), secrets);
    const inputFactsText = scrub(dj(result.declaration.inputFacts), secrets);
    const readoutText = scrub(buildReadout({
      declaration: result.declaration, arbiter: parsed.arbiter, lines: parsed.lines, name, modelId: result.modelId, costUsd: result.costUsd, rounds: result.rounds, spendComplete: result.spendComplete, root,
    }), secrets);
    files['declaration.json'] = declarationText;
    files['input-facts.json'] = inputFactsText;
    files['readout.txt'] = readoutText;
    const h = specHash({
      proseText: prose.text, declarationText, inputFactsText, readoutText, targetText,
    });
    if (!h.ok) return paidFail(`hash: ${h.red}`);
    hash = h.hash; // spec.hash is written only after a clean sweep, below
  } else if (result.declaration) {
    files['declaration.rejected.json'] = scrub(dj(result.declaration), secrets);
  }

  // The spend is booked FIRST, so a later write failure cannot leave a paid round unbooked.
  let leaks;
  try {
    appendSpendRow(path.join(dir, 'spend.jsonl'), {
      kind: 'draft',
      model: result.modelId ?? modelId ?? null,
      modelReturned: result.modelReturned,
      tokens: result.tokens ?? null,
      costUsd: result.costUsd, // null when any round was unpriced — never 0
      rounds: result.rounds,
      calls: result.calls,
      spendComplete: result.spendComplete,
      stop: result.stop,
      budgetUsd,
    });
    for (const [f, text] of Object.entries(files)) writeFileSync(path.join(dir, f), text);
    leaks = sweepForSecrets(dir, secrets);
    if (leaks > 0) {
      const red = `scrub: ${leaks} file(s) in the draft dir contain a key value`;
      writeFileSync(path.join(dir, LEAK_MARKER_FILE), `${red}\n`); // no spec.hash; sign also refuses on this marker
      return { ok: false, wrote: true, reds: [red], costUsd: result.costUsd, spendComplete: result.spendComplete, leaks };
    }
    if (hash) writeFileSync(path.join(dir, SPEC_HASH_FILE), `${hash}\n`);
  } catch (e) {
    return paidFail(`write failed after the paid round (${e.code ?? e.message}); the draft dir is incomplete and never signable`);
  }
  return {
    ok: result.ok, wrote: true, dir, hash, reds: result.reds, costUsd: result.costUsd, spendComplete: result.spendComplete, stop: result.stop, rounds: result.rounds, calls: result.calls, leaks: 0,
  };
}

/**
 * The human step, $0. Every refusal returns reds and writes NO flow.
 * `signedBy` must come from the human's own invocation (the CLI's --signed-by/username).
 */
export function signDraft({
  dir, approve, signedBy, signedAt = new Date().toISOString(), env = process.env,
}) {
  const refuse = (...reds) => ({ ok: false, reds });
  if (readFileInside(dir, LEAK_MARKER_FILE).ok) return refuse(`sign: "${dir}" carries a key-leak marker (${LEAK_MARKER_FILE}) — never signed`);
  // Sign is $0 and takes no key, so it can only sweep for keys present in ITS env (any provider slot's).
  // With none set the sweep is skipped: the marker above and the missing spec.hash are then the guard.
  const keys = Object.values(PROVIDER_SLOTS).map((p) => env[p.envVar]).filter(Boolean);
  if (sweepForSecrets(dir, keys) > 0) return refuse(`sign: "${dir}" contains a key value — nothing signed`);
  if (typeof approve !== 'string' || approve === '') return refuse('sign: --approve <hash> is required');
  const read = (f) => readFileInside(dir, f);
  const parts = {};
  for (const f of ['prose.txt', 'declaration.json', 'input-facts.json', 'readout.txt', SPEC_HASH_FILE, 'target.json']) {
    const r = read(f);
    if (!r.ok) return refuse(`sign: "${dir}" is not a green draft — ${f} ${r.missing ? 'is missing' : `is refused (${r.red})`}`);
    parts[f] = r.text;
  }
  const h = specHash({
    proseText: parts['prose.txt'], declarationText: parts['declaration.json'], inputFactsText: parts['input-facts.json'], readoutText: parts['readout.txt'], targetText: parts['target.json'],
  });
  if (!h.ok) return refuse(`sign: ${h.red}`);
  if (approve !== h.hash) return refuse('sign: --approve does not match the draft as it is now (edited since it was drafted, or the wrong hash) — nothing signed');
  if (parts[SPEC_HASH_FILE].trim() !== h.hash) return refuse('sign: spec.hash was not written by the draft for these files — nothing signed');

  let target;
  let declaration;
  try {
    target = JSON.parse(parts['target.json']);
    declaration = JSON.parse(parts['declaration.json']);
  } catch (e) {
    return refuse(`sign: draft file is not valid JSON — ${e.message}`);
  }
  const signed = parseSignedText(parts['prose.txt']);
  if (!signed.ok) return { ok: false, reds: signed.reds };
  const ttlReds = unsignedAskTtls(signed.arbiter);
  if (ttlReds.length) return { ok: false, reds: ttlReds };
  const cat = loadCatalogue();
  if (!cat.ok) return refuse(`sign: catalogue: ${cat.reds.join('; ')}`);
  const verdict = validateDeclaration(declaration, {
    arbiter: signed.arbiter, lines: signed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true,
  });
  if (!verdict.ok) return { ok: false, reds: verdict.reds };

  const reds = [];
  for (const s of signed.arbiter.sources) {
    if (s.kind === 'file' && !existsSync(s.path)) reds.push(`sign: input source "${s.role}" is missing at ${s.path}`);
  }
  for (const s of signed.arbiter.sends) {
    const d = checkSendDestination(`${s.target.kind}:${s.target.path}`);
    if (!d.ok) reds.push(`sign: ${d.red}`);
  }
  if (reds.length) return { ok: false, reds };

  const written = writeFlow({
    root: target.root, name: target.name, proseText: parts['prose.txt'], declaration, signedBy, signedAt, catalogue: cat.primitives,
  });
  if (!written.ok) return { ok: false, reds: written.reds };
  return { ok: true, flowDir: written.dir, signature: written.signature };
}
