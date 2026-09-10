// Part 0 — SCOUT. Runs BEFORE the drafter (PRD §3.5, borrowed verbatim from
// bareloop src/authorscout.js:4 — "the scout LOOKS, the drafter WRITES, neither
// acts"). Bounded read-only pass over the real inputs (fixtures/ar-aging.csv,
// fixtures/message.txt) so the drafter proposes steps against what is actually
// there instead of inventing a column name.
//
// Two halves, deliberately different in how "read-only" is enforced:
//   1. THE LOOK (`lookFixtures`) — mechanical, $0, deterministic. It IS
//      catalogue.mjs's `read`/`addressCells` primitives (via mechanical.gather),
//      so the CSV's real header and the message's real lines never pass through
//      a model at all. This is what makes a column name IMPOSSIBLE to invent,
//      not merely unlikely.
//   2. THE MODEL ROUND (`runScoutRound`) — ONE bounded round (SCOUT_ROUND_BOUND,
//      fixed in code, not spec-authorable — PRD §3.5: "at job-creation time no
//      signed ceiling exists yet to derive one from, the same arbiter line, one
//      step earlier than usual") that reports facts about the data it was
//      handed. It gets exactly ONE tool (`report_facts`) — no write/store
//      primitive is ever wired as a callable tool, so a write attempt is
//      IMPOSSIBLE, not merely refused (M0a negative scenario v). `SCOUT_MENU`
//      (catalogue.mjs's `menu({classes:['read']})`) is surfaced to the model as
//      context only, proving by construction that the grant it was told about
//      excludes every write/store verb.
//
// Whatever the model reports is then mechanically GROUNDED (`groundFacts`)
// against the real header from step 1 — a reported column not in the real file
// is dropped and flagged in `invented`, never silently trusted. F11 (DeepSeek
// silently ignores `max_completion_tokens`, honours only legacy `max_tokens`)
// applies here exactly as it does to the drafter: the model is reached ONLY
// through provider.mjs's makeProvider, never a hand-rolled client, so
// `legacyMaxTokens` is never a call-site decision.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop } from 'bare-agent';
import { gather } from './mechanical.mjs';
import { makeArtifact } from './artifacts.mjs';
import { menu } from './catalogue.mjs';
import { makeProvider } from './provider.mjs';
import {
  assertUnderGlobalCap, appendSpendRow, sumMeterings, RUN_CAP_USD,
} from './spend.mjs';
import { renderCsvArtifact, renderTextArtifact } from './runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SPEND_PATH = join(OUT_DIR, 'spend.jsonl');

/** The scout's grant, computed from the catalogue — never hand-rolled. Write-class and
 *  store-class primitives are ABSENT here, not refused (negative scenario v): a read-only
 *  menu filter is catalogue.mjs's job, this is the scout's own call site for it. */
export const SCOUT_MENU = menu({ classes: ['read'] });

/** Fixed in code, not spec-authorable (PRD §3.5). One model round: the scout looks once and
 *  reports; it does not get to revise or re-look. Enforced in `makeReportFactsTool` below,
 *  not merely documented — a second `report_facts` call throws. */
export const SCOUT_ROUND_BOUND = 1;

/** Fixed in code, not spec-authorable. A facts report is small; this is far below the
 *  drafter's 16000 on purpose — the scout reports shape, it does not write prose. */
export const SCOUT_MAX_TOKENS = 2000;

const FACTS_SCHEMA = {
  type: 'object',
  properties: {
    csvColumns: {
      type: 'array',
      items: { type: 'string' },
      description: 'the CSV header, exactly as it appears in the text you were given — never invent a column name',
    },
    customerMentioned: {
      type: 'string',
      description: 'the customer name literally present in the message text, if any',
    },
    notes: {
      type: 'string',
      description: 'one line: anything else about the SHAPE of these inputs the drafter needs — never a judgment call',
    },
  },
  required: ['csvColumns'],
};

/**
 * THE LOOK — mechanical, $0, deterministic. Reads the two real fixtures via
 * mechanical.gather (catalogue.mjs's `read` and `addressCells` primitives) and
 * wraps them as artifacts.mjs artifacts. Never touches the network.
 */
export function lookFixtures(csvPath, textPath) {
  const csvRaw = gather('scout-csv', csvPath, 'csv');
  const textRaw = gather('scout-text', textPath, 'text');
  const csvArtifact = makeArtifact('scout-csv', 'csv', csvRaw);
  const textArtifact = makeArtifact('scout-text', 'text', textRaw);
  return { csvArtifact, textArtifact };
}

/**
 * Ground a model-reported facts object against the mechanically-read truth.
 * A reported CSV column that is not in the REAL header is dropped and named in
 * `invented` — never silently kept. When the model reports nothing usable, the
 * mechanical truth is used directly (still never invented, never empty). Pure
 * function: no IO, no model — this is what the exit-criterion test runs against.
 */
export function groundFacts(rawFacts, { csvArtifact, textArtifact }) {
  const realColumns = csvArtifact.header;
  const reportedColumns = Array.isArray(rawFacts?.csvColumns) ? rawFacts.csvColumns : [];
  const invented = reportedColumns.filter((c) => !realColumns.includes(c));
  const groundedColumns = reportedColumns.filter((c) => realColumns.includes(c));
  return {
    csv: {
      artifactId: csvArtifact.id,
      sha256: csvArtifact.sha256,
      rowCount: csvArtifact.rows.length,
      columns: groundedColumns.length > 0 ? groundedColumns : realColumns,
    },
    text: {
      artifactId: textArtifact.id,
      sha256: textArtifact.sha256,
      lineCount: textArtifact.lines.length,
      lines: textArtifact.lines,
    },
    customerMentioned: typeof rawFacts?.customerMentioned === 'string' ? rawFacts.customerMentioned : null,
    notes: typeof rawFacts?.notes === 'string' ? rawFacts.notes : null,
    invented,
  };
}

/**
 * The scout's one tool. A fresh instance per round — `execute` throws past
 * SCOUT_ROUND_BOUND calls, which is the actual (not merely documented)
 * enforcement of "one round, fixed in code". Exported standalone so the round
 * bound is unit-testable without a model or a network call.
 */
export function makeReportFactsTool() {
  let callCount = 0;
  let capturedArgs = null;
  const tool = {
    name: 'report_facts',
    description: 'Report facts about the real inputs you were given — never invent a column name or a fact not grounded in the text below.',
    parameters: FACTS_SCHEMA,
    execute: async (args) => {
      callCount += 1;
      if (callCount > SCOUT_ROUND_BOUND) {
        throw new Error(`scout round bound exceeded (${SCOUT_ROUND_BOUND}) — the scout's grant is fixed in code, not spec-authorable`);
      }
      capturedArgs = args;
      return { ok: true };
    },
  };
  return { tool, getCapturedArgs: () => capturedArgs, getCallCount: () => callCount };
}

function scoutMenuText() {
  return SCOUT_MENU.map((e) => `- ${e.verb} (${e.component}, ${e.package})`).join('\n');
}

/**
 * THE MODEL ROUND. Takes the fixture paths, runs the mechanical look, then one
 * bounded model round asking for facts about what it was shown. `provider`/
 * `rates` are injectable (structure tests pass a fake — no network); when
 * omitted, the REAL provider is built through provider.mjs's makeProvider,
 * exactly like drafter.mjs and never a hand-rolled client (F11).
 */
export async function runScoutRound(modelId, {
  slot = 'deepseek', csvPath, textPath, runLabel = 'scout', provider: injectedProvider, rates: injectedRates,
} = {}) {
  const { csvArtifact, textArtifact } = lookFixtures(csvPath, textPath);

  let provider = injectedProvider;
  let rates = injectedRates;
  const live = injectedProvider == null;
  if (live) {
    assertUnderGlobalCap(SPEND_PATH);
    ({ provider, rates } = makeProvider(slot, { model: modelId }));
  }

  const { tool, getCapturedArgs } = makeReportFactsTool();

  // Every round, not just the last (F15): a tool-calling run has at least two,
  // and keeping only the last recorded the finishing round and dropped the work.
  const meterings = [];
  const loop = new Loop({ provider, rates, onLlmResult: async (event) => { meterings.push(event); } });
  const messages = [
    {
      role: 'system',
      content: `You are the fwdloop scout. You LOOK; you never write, send, or act. You answer ONLY by `
        + `calling report_facts, once. Available read-only primitives (context only — you do not call `
        + `these directly, they are not offered as tools):\n${scoutMenuText()}`,
    },
    {
      role: 'user',
      content: `${renderCsvArtifact(csvArtifact)}\n\n${renderTextArtifact(textArtifact)}\n\nCall report_facts now.`,
    },
  ];

  const startedAt = Date.now();
  await loop.run(messages, [tool], { maxTokens: SCOUT_MAX_TOKENS });
  const wallMs = Date.now() - startedAt;
  const metered = sumMeterings(meterings);

  if (live) {
    appendSpendRow(SPEND_PATH, {
      runId: runLabel, step: 'scout', model: modelId, modelReturned: metered.model,
      tokens: metered.tokens, costUsd: metered.costUsd, rounds: metered.rounds,
      rateSource: metered.rateSource, wallMs,
    });
    if (metered.costUsd != null && metered.costUsd > RUN_CAP_USD) {
      console.error(`WARNING: scout run cost $${metered.costUsd} exceeds the per-run $${RUN_CAP_USD} cap`);
    }
  }

  const rawFacts = getCapturedArgs();
  const facts = groundFacts(rawFacts, { csvArtifact, textArtifact });
  return {
    facts, toolCalled: rawFacts != null, usage: metered.tokens, rounds: metered.rounds,
    costUsd: metered.costUsd, wallMs,
  };
}

// CLI entry point — live, opt-in ONLY (SCOUT_LIVE=1). Never runs under `npm test`:
// node --test never executes this block (import.meta.url check), and no test file imports it.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.SCOUT_LIVE !== '1') {
    console.error('A live scout round costs real money — set SCOUT_LIVE=1 to run it. Refusing.');
    process.exit(1);
  }
  const REPO_ROOT = join(__dirname, '..', '..');
  const modelId = process.argv[2] || 'deepseek-v4-flash';
  const slotIdx = process.argv.indexOf('--slot');
  const slot = slotIdx !== -1 ? process.argv[slotIdx + 1] : 'deepseek';
  const csvPath = join(REPO_ROOT, 'fixtures', 'ar-aging.csv');
  const textPath = join(REPO_ROOT, 'fixtures', 'message.txt');
  const report = await runScoutRound(modelId, {
    slot, csvPath, textPath, runLabel: 'scout-live',
  });
  console.log(JSON.stringify(report, null, 2));
}
