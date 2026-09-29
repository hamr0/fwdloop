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
// It does NOT cover log.json / spend.jsonl (a record of how the draft was made, not of what
// is signed) or target.json (where the flow lands, chosen by the human at draft time).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { draft } from './drafter.js';
import { parseSignedText } from './signed-text.js';
import { validateDeclaration } from './declaration.js';
import { loadCatalogue } from './catalogue.js';
import { WIRED_VERBS } from './primitives.js';
import { canonicalBytes } from './signature.js';
import { writeFlow, readFileInside, readdirInside, checkFlowName } from './flow.js';
import { checkSendDestination } from './runner.js';
import { PROVIDER_SLOTS, checkKeyPreflight, appendSpendRow } from './provider.js';

export const DRAFT_BUDGET_USD = 0.10;
export const SPEC_HASH_FILE = 'spec.hash';
export const SIGN_LINE = (dir, hash) => `DRAFTED — NOT SIGNED. To sign: fwdloop sign ${dir} --approve ${hash}`;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The one spec hash. sha256 over the four canonical parts, JSON-array framed so no part can
 * bleed into the next. Never throws.
 * @param {{proseText:string, declarationText:string, inputFactsText:string, readoutText:string}} p
 * @returns {{ok:true, hash:string}|{ok:false, red:string}}
 */
export function specHash({ proseText, declarationText, inputFactsText, readoutText }) {
  const prose = canonicalBytes('prose.txt', proseText);
  if (!prose.ok) return { ok: false, red: prose.red };
  const decl = canonicalBytes('declaration.json', declarationText);
  if (!decl.ok) return { ok: false, red: decl.red };
  // canonicalBytes' 'declaration.json' kind is the generic sorted-key JSON canonicaliser.
  const facts = canonicalBytes('declaration.json', inputFactsText);
  if (!facts.ok) return { ok: false, red: 'input-facts.json: is not valid JSON' };
  const readout = canonicalBytes('prose.txt', readoutText);
  if (!readout.ok) return { ok: false, red: readout.red };
  const framed = JSON.stringify([sha(prose.bytes), sha(decl.bytes), sha(facts.bytes), sha(readout.bytes)]);
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

const usd = (n) => (n == null ? 'UNKNOWN (unpriced round)' : `$${n.toFixed(4)}`);

/** Plain-text readout of what the human is about to sign. Pure. */
export function buildReadout({ declaration, arbiter, lines, name, modelId, costUsd, rounds }) {
  const out = [];
  out.push(`DRAFT READOUT — NOT SIGNED — flow "${name}"`, '');
  out.push(`Drafted by: ${modelId ?? '?'} in ${rounds} round(s), cost ${usd(costUsd)}`);
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
  for (const a of arbiter.asks) out.push(`  line ${a.line}: "${a.question}" (ttl ${Math.round(a.ttlMs / 60000)} min)`);
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
  if (existsSync(dir)) return refuse([`draft: "${dir}" already exists — never overwritten, use a new dir`]);

  const result = await draft({
    proseText: prose.text, slot, model, budgetUsd, provider, rates, modelId,
  });
  if (result.stop === 'pre-flight') return refuse(result.reds);

  const parsed = parseSignedText(prose.text); // the drafter already proved it parses
  if (!parsed.ok) return refuse(parsed.reds);
  const dj = (o) => `${JSON.stringify(o, null, 2)}\n`;
  const files = {};
  files['prose.txt'] = prose.text; // verbatim
  files['target.json'] = dj({ root, name });
  files['log.json'] = scrub(dj({
    ok: result.ok, stop: result.stop, reds: result.reds, rounds: result.rounds, costUsd: result.costUsd,
    modelId: result.modelId, modelReturned: result.modelReturned, structureRetries: result.structureRetries,
    revisions: result.revisions, log: result.log,
  }), secrets);
  let hash = null;
  if (result.ok) {
    const declarationText = scrub(dj(result.declaration), secrets);
    const inputFactsText = scrub(dj(result.declaration.inputFacts), secrets);
    const readoutText = scrub(buildReadout({
      declaration: result.declaration, arbiter: parsed.arbiter, lines: parsed.lines, name, modelId: result.modelId, costUsd: result.costUsd, rounds: result.rounds,
    }), secrets);
    files['declaration.json'] = declarationText;
    files['input-facts.json'] = inputFactsText;
    files['readout.txt'] = readoutText;
    const h = specHash({ proseText: prose.text, declarationText, inputFactsText, readoutText });
    if (!h.ok) return { ok: false, wrote: false, reds: [h.red], costUsd: result.costUsd };
    hash = h.hash;
    files[SPEC_HASH_FILE] = `${hash}\n`;
  } else if (result.declaration) {
    files['declaration.rejected.json'] = scrub(dj(result.declaration), secrets);
  }

  mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
  mkdirSync(dir);
  for (const [f, text] of Object.entries(files)) writeFileSync(path.join(dir, f), text);
  appendSpendRow(path.join(dir, 'spend.jsonl'), {
    kind: 'draft',
    model: result.modelId ?? modelId ?? null,
    modelReturned: result.modelReturned,
    tokens: result.tokens ?? null,
    costUsd: result.costUsd, // null when any round was unpriced — never 0
    rounds: result.rounds,
    stop: result.stop,
    budgetUsd,
  });
  const leaks = sweepForSecrets(dir, secrets);
  if (leaks > 0) return { ok: false, wrote: true, reds: [`scrub: ${leaks} file(s) in the draft dir contain a key value`], costUsd: result.costUsd, leaks };
  return {
    ok: result.ok, wrote: true, dir, hash, reds: result.reds, costUsd: result.costUsd, stop: result.stop, rounds: result.rounds, leaks: 0,
  };
}

/**
 * The human step, $0. Every refusal returns reds and writes NO flow.
 * `signedBy` must come from the human's own invocation (the CLI's --signed-by/username).
 */
export function signDraft({ dir, approve, signedBy, signedAt = new Date().toISOString() }) {
  const refuse = (...reds) => ({ ok: false, reds });
  if (typeof approve !== 'string' || approve === '') return refuse('sign: --approve <hash> is required');
  const read = (f) => readFileInside(dir, f);
  const parts = {};
  for (const f of ['prose.txt', 'declaration.json', 'input-facts.json', 'readout.txt', SPEC_HASH_FILE, 'target.json']) {
    const r = read(f);
    if (!r.ok) return refuse(`sign: "${dir}" is not a green draft — ${f} ${r.missing ? 'is missing' : `is refused (${r.red})`}`);
    parts[f] = r.text;
  }
  const h = specHash({
    proseText: parts['prose.txt'], declarationText: parts['declaration.json'], inputFactsText: parts['input-facts.json'], readoutText: parts['readout.txt'],
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
