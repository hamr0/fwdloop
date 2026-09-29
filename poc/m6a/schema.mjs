// M6a POC — the forced tool call's schema, DERIVED, never hand-copied.
//
// Riskiest assumption (docs/wiki/the-module-ladder.md, M6a): a forced
// tool call whose schema comes from src/catalogue.json (WIRED verbs only)
// plus the src declaration shape makes the model emit a declaration that
// src/declaration.js's validateDeclaration accepts, with no converter.
//
// Every list here is read from src/, so it cannot drift:
//   primitives enum   <- src/catalogue.json  filtered by  src/primitives.js WIRED_VERBS
//   shape keys        <- src/declaration.js SHAPE_KEYS
//   close class enum  <- the three classes validateDeclaration accepts
// POC code: never shipped; the product build rewrites it into src/.

import { readFileSync } from 'node:fs';
import { loadCatalogue } from '../../src/catalogue.js';
import { WIRED_VERBS } from '../../src/primitives.js';
import { SHAPE_KEYS } from '../../src/declaration.js';
import { readDocxText } from '../../src/docx.js';

export const CLASSES = Object.freeze(['green', 'softgreen', 'hitl']);

/** The drafter's menu: catalogue entries that are WIRED and in a signed
 *  skill. Absence, not refusal — an unwired verb is not on the list at all. */
export function wiredMenu(skills) {
  const cat = loadCatalogue();
  if (!cat.ok) throw new Error(`catalogue unreadable: ${cat.reds.join('; ')}`);
  return cat.primitives.filter((e) => WIRED_VERBS.has(e.verb) && skills.includes(e.skill));
}

const SHAPE_PROPS = Object.freeze({
  maxWords: { type: 'integer', minimum: 1, description: "the whole output's word ceiling" },
  sections: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: 'required section headings, in order' },
  linesPerInvoice: { type: 'integer', minimum: 1, description: 'lines the output must carry per invoice' },
  mustCarry: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: 'named fields every line must carry' },
});

/** The forced tool's parameter schema. `menu` = wiredMenu(). */
export function buildDeclarationSchema(menu) {
  const shapeProps = {};
  for (const key of SHAPE_KEYS) {
    if (!SHAPE_PROPS[key]) throw new Error(`schema: SHAPE_KEYS gained "${key}" — add its type to SHAPE_PROPS`);
    shapeProps[key] = SHAPE_PROPS[key];
  }
  return {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            goal: { type: 'string', minLength: 1, description: 'one line: what this step is for' },
            primitives: {
              type: 'array',
              items: { type: 'string', enum: menu.map((e) => e.verb) },
              description: 'verbs this step is granted, from the menu only; [] for a pure stop',
            },
            reads: { type: 'array', items: { type: 'string' }, description: 'artifact ids emitted by EARLIER steps only' },
            emits: { type: 'string', minLength: 1, description: 'the ONE new artifact id this step declares (unique)' },
            fromLine: { type: ['integer', 'null'], description: 'the ONE numbered job line this step serves' },
            close: {
              type: 'object',
              properties: {
                class: { type: 'string', enum: [...CLASSES], description: "MUST equal the class of fromLine's guardrail in guardrailClasses; hitl when that line has no guardrail" },
                shape: {
                  type: 'object',
                  properties: shapeProps,
                  additionalProperties: false,
                  description: `only when class is softgreen; keys limited to ${SHAPE_KEYS.join(', ')}`,
                },
              },
              required: ['class'],
              additionalProperties: false,
            },
          },
          required: ['goal', 'primitives', 'reads', 'emits', 'fromLine', 'close'],
          additionalProperties: false,
        },
      },
      guardrailClasses: {
        type: 'object',
        additionalProperties: { type: 'string', enum: [...CLASSES] },
        description: 'one class per job line that HAS a guardrail, keyed by line number as a string',
      },
      unjudgeable: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'line number -> reason, only for a guardrail whose wording resisted judgment (its class stays hitl); {} if none',
      },
      refused: {
        type: 'array',
        items: {
          type: 'object',
          properties: { line: { type: 'integer' }, reason: { type: 'string', minLength: 1 } },
          required: ['line', 'reason'],
          additionalProperties: false,
        },
        description: 'job lines that cannot be served at all, with a reason; [] if none',
      },
    },
    required: ['steps', 'guardrailClasses', 'unjudgeable', 'refused'],
    additionalProperties: false,
  };
}

/**
 * Mechanical input facts at $0 — no model. One entry per signed file source:
 * `listing` is what `declaration.inputFacts[role]` carries (markdown
 * headings; a .docx has no heading reader in src/ yet, so its listing is []),
 * `info` is the prompt text. A source that cannot be read is a named red.
 */
export function readInputFacts(sources) {
  const inputFacts = {};
  const info = [];
  const reds = [];
  for (const s of sources ?? []) {
    if (s.kind !== 'file') continue;
    if (String(s.path).toLowerCase().endsWith('.docx')) {
      const r = readDocxText(s.path);
      if (!r.ok) { reds.push(`input "${s.role}": ${r.red}`); continue; }
      const words = r.text.trim() === '' ? 0 : r.text.trim().split(/\s+/).length;
      inputFacts[s.role] = [];
      info.push(`- ${s.role}: a .docx file, ${r.paragraphs} paragraphs, ~${words} words (read it with "readDocx")`);
    } else {
      let raw;
      try { raw = readFileSync(s.path, 'utf8'); } catch (e) { reds.push(`input "${s.role}": cannot read file: ${e.message}`); continue; }
      if (raw.trim() === '') { reds.push(`input "${s.role}": "${s.path}" is empty`); continue; }
      const headings = raw.split(/\r?\n/).filter((l) => /^#{1,6}\s+\S/.test(l)).map((l) => l.replace(/^#{1,6}\s*/, '').trim());
      inputFacts[s.role] = headings;
      info.push(`- ${s.role}: a text/markdown file, ~${raw.trim().split(/\s+/).length} words, headings: ${headings.join(', ') || '(none)'} (read it with "read")`);
    }
  }
  return { ok: reds.length === 0, inputFacts, info, reds };
}
