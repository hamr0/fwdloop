// The deterministic close: PRD §5 citation schema + rules, and the three check
// tiers (shape / evidence / human-at-the-ask). $0, no model calls. Rules are
// fixed here so a red cannot be "fixed" by widening them (PRD §5).
//
// borrowed-from: bareloop src/declaredclose.js@c661d3d — "first red wins, the
// deciding stage names itself" and the gap-header style
// (`<stage>: <what failed>`), adapted to fwdloop's step/citation shape.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { colIndex } from './csv.mjs';

/** sha256 of a file's current bytes, re-read from disk — never trusted from the artifact object alone. */
export function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Re-hash the artifact's source file and compare to the hash recorded at gather time. Mismatch = input drift. */
export function verifyArtifactHash(artifact) {
  const actual = hashFile(artifact.path);
  return { ok: actual === artifact.sha256, expected: artifact.sha256, actual };
}

/** Parse a cell ref like "E2" into { col: 'E', row: 2 }. */
function parseCellRef(cell) {
  const m = /^([A-Z]+)(\d+)$/.exec(cell);
  if (!m) throw new Error(`bad cell ref "${cell}"`);
  return { col: m[1], row: Number(m[2]) };
}

/** Raw cell text for a csv artifact + cell ref, or null if the row/col doesn't exist. */
function getCellRaw(artifact, cell) {
  const { col, row } = parseCellRef(cell);
  if (colIndex(col) < 0) return null;
  const found = artifact.rows.find((r) => r.rowNumber === row);
  if (!found) return null;
  return found.cells[col] ?? null;
}

/** Strip thousands separators / currency symbols; report the value and the source's own decimal precision. */
export function parseNumeric(raw) {
  const cleaned = String(raw).replace(/[$,]/g, '').trim();
  const value = Number(cleaned);
  const dot = cleaned.indexOf('.');
  const decimals = dot === -1 ? 0 : cleaned.length - dot - 1;
  return { value, decimals };
}

function roundTo(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** ISO-date days between two "YYYY-MM-DD" strings (b - a), UTC, whole days. Closed grammar's `daysBetween`. */
export function daysBetween(aIso, bIso) {
  const a = Date.parse(`${aIso}T00:00:00Z`);
  const b = Date.parse(`${bIso}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

const FORMULAS = {
  sum: (vals) => vals.reduce((s, v) => s + v, 0),
  count: (vals) => vals.length,
  min: (vals) => Math.min(...vals),
  max: (vals) => Math.max(...vals),
  sub: (vals) => vals[0] - vals[1],
};

/**
 * Resolve and check ONE citation against its source artifacts. Returns
 * { ok, red } where `red` is the exact gap-style text on failure, or null on
 * ok. Does not throw on a malformed citation — that is INSTRUMENT, not
 * red — but here it renders as a red "shape" failure, since a malformed
 * citation cannot be graded and unsure is red (PRD §5).
 *
 * `businessDate` is the run's explicit "as of today" (never the wall clock),
 * needed by `daysBetween` when one side of the pair is implicit "today".
 */
export function checkCitation(citation, artifacts, citationsById, businessDate) {
  if (!citation || typeof citation !== 'object' || !citation.id) {
    return { ok: false, red: `citation missing id or malformed: ${JSON.stringify(citation)}` };
  }

  // Copied figure — one pointer, one value.
  if (citation.source && citation.value !== undefined && !citation.formula) {
    const { source } = citation;
    const artifact = artifacts[source.artifact];
    if (!artifact) return { ok: false, red: `${citation.id}: unknown artifact "${source.artifact}"` };
    const hashCheck = verifyArtifactHash(artifact);
    if (!hashCheck.ok) {
      return { ok: false, red: `${citation.id}: input drift on artifact "${source.artifact}" — expected sha256 ${hashCheck.expected}, got ${hashCheck.actual}` };
    }
    if (source.sha256 && source.sha256 !== artifact.sha256) {
      return { ok: false, red: `${citation.id}: input drift — citation points at sha256 ${source.sha256}, artifact is ${artifact.sha256}` };
    }
    if (source.kind === 'csv') {
      const raw = getCellRaw(artifact, source.cell);
      if (raw === null) return { ok: false, red: `${citation.id}: cell ${source.cell} does not exist in "${source.artifact}"` };
      // Dates compare as ISO strings, not numerically.
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(citation.value))) {
        if (String(citation.value) !== raw) {
          return { ok: false, red: `${citation.id} ${citation.value} ≠ cell ${source.cell} = ${raw}` };
        }
        return { ok: true, red: null };
      }
      const { value: cellVal, decimals } = parseNumeric(raw);
      // A cell that doesn't parse as a number (e.g. the Customer name column) compares
      // as exact text, trimmed — the copied-figure form is not numbers-only (PRD §5's
      // "the row's cell" for a name match is exactly this case).
      if (Number.isNaN(cellVal)) {
        if (String(citation.value).trim() !== String(raw).trim()) {
          return { ok: false, red: `${citation.id} ${citation.value} ≠ cell ${source.cell} = ${raw}` };
        }
        return { ok: true, red: null };
      }
      const statedRounded = roundTo(Number(citation.value), decimals);
      if (statedRounded !== roundTo(cellVal, decimals)) {
        return { ok: false, red: `${citation.id} ${citation.value} ≠ cell ${source.cell} = ${cellVal}` };
      }
      return { ok: true, red: null };
    }
    return { ok: false, red: `${citation.id}: unsupported copied source kind "${source.kind}"` };
  }

  // Derived figure — a formula over cited inputs; the close recomputes it.
  if (citation.formula) {
    const fn = FORMULAS[citation.formula];
    if (citation.formula === 'daysBetween') {
      const inputIds = citation.inputs ?? [];
      if (inputIds.length < 1) return { ok: false, red: `${citation.id}: daysBetween needs at least 1 input` };
      const dateCitation = citationsById[inputIds[0]];
      if (!dateCitation) return { ok: false, red: `${citation.id}: daysBetween input "${inputIds[0]}" not found` };
      const fromDate = dateCitation.value;
      const toDate = inputIds[1] ? citationsById[inputIds[1]]?.value : businessDate;
      const computed = daysBetween(fromDate, toDate);
      if (Number(citation.value) !== computed) {
        return { ok: false, red: `${citation.id} ${citation.value} ≠ daysBetween(${inputIds.join(',')}${inputIds[1] ? '' : ',businessDate'}) = ${computed}` };
      }
      return { ok: true, red: null };
    }
    if (!fn) return { ok: false, red: `${citation.id}: unknown formula "${citation.formula}" (closed grammar: sum,count,min,max,sub,daysBetween)` };
    const inputIds = citation.inputs ?? [];
    const inputCitations = inputIds.map((id) => citationsById[id]);
    if (inputCitations.some((c) => !c)) {
      return { ok: false, red: `${citation.id}: formula input(s) not found among citations (${inputIds.join(',')})` };
    }
    const vals = inputCitations.map((c) => Number(c.value));
    const computed = fn(vals);
    if (Number(citation.value) !== computed) {
      const cellRefs = inputCitations.map((c) => (c.source ? c.source.cell : c.id)).join(',');
      return { ok: false, red: `${citation.id} ${citation.value} ≠ ${citation.formula}(${cellRefs}) = ${computed}` };
    }
    return { ok: true, red: null };
  }

  // Text evidence — a quote that must appear verbatim at the pointer.
  if (citation.quote !== undefined && citation.source) {
    const { source } = citation;
    const artifact = artifacts[source.artifact];
    if (!artifact) return { ok: false, red: `${citation.id}: unknown artifact "${source.artifact}"` };
    const hashCheck = verifyArtifactHash(artifact);
    if (!hashCheck.ok) {
      return { ok: false, red: `${citation.id}: input drift on artifact "${source.artifact}" — expected sha256 ${hashCheck.expected}, got ${hashCheck.actual}` };
    }
    const line = artifact.lines[source.line - 1];
    if (line === undefined) return { ok: false, red: `${citation.id}: line ${source.line} does not exist in "${source.artifact}"` };
    if (!line.includes(citation.quote)) {
      return { ok: false, red: `${citation.id} quote "${citation.quote}" is not a verbatim substring of line ${source.line}: "${line}"` };
    }
    return { ok: true, red: null };
  }

  return { ok: false, red: `${citation.id}: shape invalid — not copied, derived, or quote form` };
}

/**
 * Evidence check over a whole `citations` array: first red wins, in array order.
 * Returns { verdict: 'green'|'red', red: string|null, citationsById }.
 */
export function closeCitations(citations, artifacts, businessDate) {
  const citationsById = Object.fromEntries((citations ?? []).map((c) => [c.id, c]));
  for (const citation of citations ?? []) {
    const { ok, red } = checkCitation(citation, artifacts, citationsById, businessDate);
    if (!ok) return { verdict: 'red', red, citationsById };
  }
  return { verdict: 'green', red: null, citationsById };
}

/**
 * Shape check for any step's output: every field a named `fields` map claims
 * must resolve to a citation actually present, and required top-level keys
 * must exist. $0, every step (PRD §5 tier 1).
 */
export function closeShape(output, requiredKeys) {
  if (!output || typeof output !== 'object') return { verdict: 'red', red: 'output is not an object' };
  for (const key of requiredKeys) {
    if (output[key] === undefined || output[key] === null) return { verdict: 'red', red: `output missing required field "${key}"` };
  }
  return { verdict: 'green', red: null };
}

/**
 * `derive` close: shape, then evidence over every citation, then that every
 * named field in `output.fields` (fieldName -> citationId) points at a
 * citation that actually resolved and exists. Red messages use the field
 * name as the human label (e.g. "total 5850 ≠ sum(E2,E3) = 5700"),
 * matching PRD §7's example style, not the opaque citation id.
 */
export function closeDerive(output, artifacts, businessDate) {
  const shape = closeShape(output, ['citations', 'fields']);
  if (shape.verdict === 'red') return shape;
  const evidence = closeCitations(output.citations, artifacts, businessDate);
  if (evidence.verdict === 'red') {
    // Re-label the red with the field name if this citation is a named figure.
    const failedId = Object.keys(evidence.citationsById).find((id) => evidence.red.startsWith(id + ' '));
    if (failedId) {
      const fieldName = Object.entries(output.fields).find(([, cid]) => cid === failedId)?.[0];
      if (fieldName) {
        return { verdict: 'red', red: evidence.red.replace(new RegExp(`^${failedId}`), fieldName) };
      }
    }
    return evidence;
  }
  for (const [fieldName, citationId] of Object.entries(output.fields)) {
    if (!evidence.citationsById[citationId]) {
      return { verdict: 'red', red: `derive: field "${fieldName}" points at unknown citation "${citationId}"` };
    }
  }
  return { verdict: 'green', red: null };
}

/**
 * `compose` close: shape, evidence over citations, then the text has no bare
 * (uncited) number and every bracketed [cN] id resolves to a real citation.
 *
 * `declaredFields` (optional) is the PRIOR derive step's `fields` map
 * (fieldName -> citationId, e.g. `{ total_owed: 'c7', earliest_due: 'c8' }`)
 * and `declaredCitations` (optional) is that same prior step's `citations`
 * array. Together they gate an ADDITIONAL completeness check, never a
 * loosening of anything above: every field the prior step declared must
 * still appear, cited, in the composed text — either under its original
 * citation id, or under a different id whose resolved value is identical (a
 * model may legitimately re-cite the same figure under a new id when
 * composing). A model that silently omits a promised field (grounded or
 * not) is red here, first-red-wins, named by field.
 */
export function closeCompose(output, artifacts, businessDate, declaredFields, declaredCitations) {
  const shape = closeShape(output, ['citations', 'text']);
  if (shape.verdict === 'red') return shape;
  const evidence = closeCitations(output.citations, artifacts, businessDate);
  if (evidence.verdict === 'red') return evidence;

  const { text } = output;
  const bracketIds = [...text.matchAll(/\[([a-zA-Z0-9_]+)\]/g)].map((m) => m[1]);
  for (const id of bracketIds) {
    if (!evidence.citationsById[id]) return { verdict: 'red', red: `compose: bracket [${id}] does not resolve to a citation` };
  }

  // No bare number outside a citation bracket: strip every "[cN]" bracket AND
  // the figure immediately before it (its citation), strip identifiers that
  // merely contain digits (invoice ids like "INV-1021"), then anything
  // numeric left over is an uncited figure.
  const withoutCitedFigures = text
    // An ISO date (YYYY-MM-DD) immediately before its bracket — checked FIRST so the plain
    // number pattern below (which stops at the first "-") doesn't leave "2026-06-" behind.
    .replace(/\d{4}-\d{2}-\d{2}\s*\[[a-zA-Z0-9_]+\]/g, '')
    .replace(/[\d,]+(\.\d+)?\s*\[[a-zA-Z0-9_]+\]/g, '')
    .replace(/[A-Za-z]+-\d+/g, '');
  const bareNumber = /\d/.test(withoutCitedFigures);
  if (bareNumber) return { verdict: 'red', red: `compose: bare (uncited) number found in text: "${text}"` };

  // Completeness: every field the prior derive step declared must appear,
  // cited, in the reply — omission is invisible to every check above, so a
  // model wins by doing less unless this closes the gap.
  if (declaredFields) {
    const priorById = Object.fromEntries((declaredCitations ?? []).map((c) => [c.id, c]));
    for (const [fieldName, citationId] of Object.entries(declaredFields)) {
      const expectedValue = priorById[citationId]?.value;
      const found = bracketIds.some((id) => {
        if (id === citationId) return true;
        if (expectedValue === undefined) return false;
        const cited = evidence.citationsById[id];
        return cited && cited.value !== undefined && String(cited.value) === String(expectedValue);
      });
      if (!found) {
        const valueLabel = expectedValue !== undefined ? expectedValue : '?';
        return {
          verdict: 'red',
          red: `compose: declared field "${fieldName}" (${valueLabel}, ${citationId}) does not appear cited in the reply`,
        };
      }
    }
  }

  return { verdict: 'green', red: null };
}

/**
 * Mechanically determine customer-name ambiguity from the csv artifact
 * itself (never trusting the model's own judgment on it) — PRD §5: "two
 * rows matching is an ask, never a pick." Case-insensitive substring match
 * of `quote` against each row's Customer cell.
 */
export function matchingCustomers(quote, csvArtifact) {
  const names = new Set();
  for (const row of csvArtifact.rows) {
    const name = row.byName.Customer;
    if (name && name.toLowerCase().includes(quote.toLowerCase())) names.add(name);
  }
  return [...names];
}

/**
 * `derive #1` close (customer-name match). PRD §5: "a name match between a
 * message and a sheet is a quote citation + the row's cell, and two rows
 * matching is an ask, never a pick." The ambiguity a model REPORTS
 * (`output.matches`) is checked against the ambiguity the sheet ACTUALLY
 * has, computed mechanically via `matchingCustomers` from the model's own
 * quote — never trusted from the model's say-so. A model that quietly picks
 * one row when two really match (undercount) is red here, same as a model
 * that hallucinates a match that isn't there (overcount).
 *
 * `output` shape: `{ citations: Citation[], matches: string[] }` where
 * `matches` is the citation id(s) of the copied Customer-cell citation(s)
 * the model believes match. `csvArtifactId` names which key in `artifacts`
 * holds the sheet (so the same close works regardless of the runner's id
 * scheme).
 */
export function closeCustomerMatch(output, artifacts, csvArtifactId) {
  const shape = closeShape(output, ['citations', 'matches']);
  if (shape.verdict === 'red') return { verdict: 'red', red: shape.red, ambiguous: false, groundTruthMatches: [] };

  const evidence = closeCitations(output.citations, artifacts, null);
  if (evidence.verdict === 'red') return { verdict: 'red', red: evidence.red, ambiguous: false, groundTruthMatches: [] };

  const quoteCitation = output.citations.find((c) => c.quote !== undefined);
  if (!quoteCitation) {
    return { verdict: 'red', red: 'cust_match: no quote citation identifying the customer name in the message', ambiguous: false, groundTruthMatches: [] };
  }

  const csvArtifact = artifacts[csvArtifactId];
  const groundTruthMatches = matchingCustomers(quoteCitation.quote, csvArtifact);

  const matchIds = output.matches ?? [];
  const claimedCitations = matchIds.map((id) => evidence.citationsById[id]);
  if (claimedCitations.some((c) => !c)) {
    return { verdict: 'red', red: `cust_match: matches references unknown citation id(s) (${matchIds.join(',')})`, ambiguous: false, groundTruthMatches };
  }
  const claimedNames = [...new Set(claimedCitations.map((c) => c.value))];

  if (groundTruthMatches.length === 0) {
    return { verdict: 'red', red: `cust_match: quote "${quoteCitation.quote}" matches no customer in the sheet`, ambiguous: false, groundTruthMatches };
  }

  const claimedSet = new Set(claimedNames);
  const truthSet = new Set(groundTruthMatches);
  const setsEqual = claimedSet.size === truthSet.size && [...claimedSet].every((n) => truthSet.has(n));
  if (!setsEqual) {
    return {
      verdict: 'red',
      red: `cust_match: ${groundTruthMatches.length} customer(s) match "${quoteCitation.quote}" (${groundTruthMatches.join(', ')}) but ${claimedNames.length} ${claimedNames.length === 1 ? 'was' : 'were'} cited (${claimedNames.join(', ') || 'none'}) — two rows matching is an ask, never a pick`,
      ambiguous: groundTruthMatches.length > 1,
      groundTruthMatches,
    };
  }

  return {
    verdict: 'green', red: null, ambiguous: groundTruthMatches.length > 1, groundTruthMatches,
    matchedCustomer: groundTruthMatches.length === 1 ? groundTruthMatches[0] : null,
  };
}
