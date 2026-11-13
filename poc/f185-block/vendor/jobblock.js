// borrowed-from: bareloop src/jobblock.js@v0.56.0 (3383cce)
// The "job" block's parser (P7, docs/product/PANEL-BUILD.md "Addendum 2026-10-10"): ONE owner of how the person's
// own multi-line words become numbered job lines and numbered inputs. The panel server AND the CLI interview both
// call these two functions, so the two doors can never read the same text two ways.
//
// Both are pure and $0: a malformed block is a named red `{ok: false, error}`, never a throw and never a guess.

/** @typedef {{verdict: 'PASS'|'FAIL', text: string}} JobExample a `~ PASS:` / `~ FAIL:` line (rubric only), kept with its job line */
/** @typedef {{n: number, text: string, rule: string, rules: string[], examples: JobExample[]}} JobLine one numbered job line; `rule` = its `~` lines joined with '; ' ('' when none), `rules` = those same `~` lines one by one (so an example's own '; ' survives) */
/** @typedef {{n: number, label: string, value: string}} JobInput one numbered `label: value` input line */

/** the joiner for consecutive `~` lines (fwd's joinGuardrails) */
export const RULE_JOINER = '; ';

/**
 * Parse "The job" box. A plain line is a numbered job line (1, 2, 3...). A line starting `~` has no number and belongs
 * to the numbered line above; consecutive `~` lines become ONE rule joined with `'; '`. A `~` line starting `PASS:` or
 * `FAIL:` is also a judge example (kept with its line number); any other `~` line is a guardrail. Empty lines are
 * ignored. A `~` before line 1 is a red.
 * @param {unknown} text the box's raw text
 * @returns {{ok: true, lines: JobLine[]}|{ok: false, error: string}}
 */
export function parseJobBlock(text) {
  if (typeof text !== 'string') return { ok: false, error: 'The job is required' };
  /** @type {JobLine[]} */
  const lines = [];
  /** @type {string[]} */
  let rule = [];
  const flush = () => { if (lines.length) { lines[lines.length - 1].rule = rule.join(RULE_JOINER); lines[lines.length - 1].rules = rule; } rule = []; };
  let row = 0;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (t === '') continue;
    row += 1;
    if (t.startsWith('~')) {
      if (lines.length === 0) return { ok: false, error: `The job, line ${row}: a "~" line belongs to the numbered line above it, and there is none yet` };
      const body = t.slice(1).trim();
      if (body === '') continue;
      rule.push(body);
      const m = /^(PASS|FAIL):\s*(.*)$/i.exec(body);
      if (m) {
        if (m[2].trim() === '') return { ok: false, error: `The job, line ${row}: "${m[1].toUpperCase()}:" needs an example after it` };
        lines[lines.length - 1].examples.push({ verdict: /** @type {'PASS'|'FAIL'} */ (m[1].toUpperCase()), text: m[2].trim() });
      }
      continue;
    }
    flush();
    lines.push({ n: lines.length + 1, text: t, rule: '', rules: [], examples: [] });
  }
  flush();
  if (lines.length === 0) return { ok: false, error: 'The job is required' };
  return { ok: true, lines };
}

/** a label: a word or two, no colon */
const LABEL_RE = /^[A-Za-z][A-Za-z0-9_ -]{0,39}$/;

/**
 * Parse the "Inputs" box: one `label: value` per line, numbered 1, 2, 3 in the order written. Empty lines are ignored.
 * This only checks the SHAPE — what a value must point at (line 1 an absolute repo, lines 2+ tracked files inside it)
 * is proven by the panel at $0.
 * @param {unknown} text
 * @returns {{ok: true, inputs: JobInput[]}|{ok: false, error: string}}
 */
export function parseInputs(text) {
  if (typeof text !== 'string') return { ok: false, error: 'Inputs is required' };
  /** @type {JobInput[]} */
  const inputs = [];
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (t === '') continue;
    const n = inputs.length + 1;
    const i = t.indexOf(':');
    const label = i < 0 ? '' : t.slice(0, i).trim();
    const value = i < 0 ? '' : t.slice(i + 1).trim();
    if (!LABEL_RE.test(label) || value === '') return { ok: false, error: `Inputs, line ${n}: write it as "label: value"` };
    inputs.push({ n, label, value });
  }
  if (inputs.length === 0) return { ok: false, error: 'Inputs is required' };
  return { ok: true, inputs };
}

/**
 * The person's job lines as the drafter reads them (answer 1 of the interview): each numbered line, then its rule
 * (the `~` lines joined) indented under it. One spelling, so the number the person typed beside a line is the number a
 * stage's `fromLine` names.
 * @param {JobLine[]} lines
 * @returns {string}
 */
export function renderJobLines(lines) {
  return lines.map((l) => `${l.n}. ${l.text}${l.rule ? `\n   rule: ${l.rule}` : ''}`).join('\n');
}

/**
 * The job lines as the job BOX reads them (R10): each line's text, then one `~` line per rule. The inverse of {@link parseJobBlock}, so a card reopened by a Revise holds
 * the `~` lines the person's answers added.
 * @param {{text: string, rules: string[]}[]} lines @returns {string}
 */
export function jobBoxText(lines) {
  return lines.map((l) => [l.text, ...l.rules.map((r) => `~ ${r}`)].join('\n')).join('\n');
}

/**
 * The PASS:/FAIL: examples the person wrote, each kept with its line number (answer 2 of a rubric interview — what the
 * calibration compile reads). Empty string when there are none.
 * @param {JobLine[]} lines
 * @returns {string}
 */
export function renderExamples(lines) {
  return lines.flatMap((l) => l.examples.map((e) => `line ${l.n} ${e.verdict}: ${e.text}`)).join('\n');
}

/**
 * The inputs as the drafter is told about them: "the person pointed at these inputs: N label path".
 * @param {JobInput[]} inputs
 * @returns {string}
 */
export function renderInputs(inputs) {
  return `the person pointed at these inputs: ${inputs.map((i) => `${i.n} ${i.label} ${i.value}`).join(' · ')}`;
}

/**
 * The two cross-checks between a parsed job block and the Check type: a RUBRIC job needs at least one `PASS:` and one
 * `FAIL:` example (the calibration compile reads them); a DETERMINISTIC job has no judge, so an example line would be
 * silently dropped — a red instead.
 * PART 1a (hamr's ruling P1=B, docs/product/ITEM33-BUILD.md "Addendum 2026-10-12"): the examples are required of a rubric
 * job ONLY when it holds a judged part. A rubric job on the person's own local files holds none in this build (its
 * parts are counted or checked against a quote), so the caller says `judged: false` and a block without examples fits.
 * Examples written anyway are never a red there — they simply have no judge to read them yet.
 * @param {JobLine[]} lines
 * @param {boolean} rubric
 * @param {{judged?: boolean}} [o] `judged` (default true): does this job hold a judged part, so that it needs examples?
 * @returns {string|null} the plain red, or null when the block fits the Check type
 */
export function jobBlockFitsCheck(lines, rubric, { judged = true } = {}) {
  const all = lines.flatMap((l) => l.examples.map((e) => ({ n: l.n, ...e })));
  if (!rubric) {
    return all.length ? `The job, line ${all[0].n}: PASS:/FAIL: examples are for a Rubric check — a Deterministic job has no judge to read them` : null;
  }
  if (judged && (!all.some((e) => e.verdict === 'PASS') || !all.some((e) => e.verdict === 'FAIL'))) {
    return 'The job: a Rubric check needs at least one "~ PASS:" line and one "~ FAIL:" line under a job line';
  }
  return null;
}

/**
 * The signed `jobLines` field from parsed lines: the person's own words, `{n, text, rule, rules}` (examples stay inside the
 * rule text, where the person wrote them). `rules` is the same `~` lines as an array, BESIDE the joined `rule` (never
 * replacing it); it is omitted on a line with no `~` line, and an older spec lacks it entirely.
 * @param {JobLine[]} lines
 * @returns {{n: number, text: string, rule: string, rules?: string[]}[]}
 */
export function signedJobLines(lines) {
  return lines.map((l) => ({ n: l.n, text: l.text, rule: l.rule, ...(l.rules.length ? { rules: [...l.rules] } : {}) }));
}
