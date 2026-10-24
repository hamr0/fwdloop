// M4d am29 items 4-8: the Audit step fold, the Run summary's two lines and the step card's one line, all derived HERE from the run's files on disk
// (audit.jsonl's try rows + the three diaries in src/diary.js). Nothing here calls a model ($0 replay), and the page only draws what this returns,
// so the Audit rows, the summary and the cards can only agree. A run from before am29 has no diaries: no fold, `—` on the new lines, nothing made up.
import { readCalls, readTools, readChecks } from './diary.js';
import { readStepLearnings } from './flowmodel.js';

/** A Stop's notes are not tries: the asked/not-honoured rows, and a `stopped` row that cut no try (no attempt number). @param {any} r */
export function isTryRow(r) {
  return r.verdict !== 'stop-asked' && r.verdict !== 'stop-not-honoured' && !(r.verdict === 'stopped' && !Number.isInteger(r.attempt));
}

/** @param {string} runDir */
export function loadDiaries(runDir) {
  const calls = readCalls(runDir);
  const tools = readTools(runDir);
  const checks = readChecks(runDir);
  // a diary file only ever exists with a row in it, so "this run has diaries" is "a diary holds a row" (read through the safe gateway, no fs here)
  return {
    present: calls.length + tools.length + checks.length > 0, calls, tools, checks,
    // M8 am7 item 4: what each step try was handed from earlier runs (write-once per try, src/flowmodel.js); not part of "has diaries"
    hints: readStepLearnings(runDir),
  };
}

const money = (n) => (typeof n === 'number' ? `$${n.toFixed(4)}` : 'cost unknown');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The Decision words of a model call row. @param {any} c */
function callDecision(c) {
  const bits = [money(c.costUsd)];
  if (c.tokens) bits.push(`${c.tokens.in + c.tokens.out + c.tokens.cache} tokens`);
  if (typeof c.ms === 'number') bits.push(`${(c.ms / 1000).toFixed(1)}s`);
  return bits.join(' · ');
}

/** The Decision words of a tool row: allow, deny and the rule that said so, or `no check`. @param {any} t */
const toolDecision = (t) => (t.decision === 'deny' ? `deny (${t.rule ?? 'no rule recorded'})` : t.decision);

/** The Decision words of a try's check row. @param {Array<{n:number, ok:boolean}>} checks */
function checkDecision(checks) {
  const failed = checks.filter((c) => !c.ok);
  return failed.length === 0 ? `✓ all ${checks.length} passed` : `✗ ${failed.map((c) => `#${c.n}`).join(' ')} failed`;
}

/** What the human did, in the signed words, from the ask step's own audit row; `null` for a row that is not an answer. @param {any} r */
export function humanWords(r) {
  if (r.verdict === 'paused') return 'paused for you';
  if (r.verdict === 'green') return 'you accepted';
  if (r.verdict === 'red') return `you said redo: "${r.gap ?? ''}"`;
  if (r.verdict === 'stopped') return 'you cancelled';
  if (r.verdict === 'refused') return String(r.gap ?? 'refused');
  if (r.verdict === 'ask-timeout') return 'the ask timed out';
  if (r.verdict === 'ask-expired') return 'the ask expired';
  return null;
}

/** The short answer for a card: `accepted`, `redo: "<text>"`, `cancelled`. @param {any} r */
function answerShort(r) {
  const w = humanWords(r);
  return w === null ? null : w.replace(/^you said /, '').replace(/^you /, '');
}

/**
 * The fold of one step, or `null` for a step with nothing new to show (an old run, or a step that is neither a model step with records nor an ask).
 * @param {{rows:any[], tryMarks:string[], closeClass:string|null}} group `deriveAuditGroups`' group for the step
 * @param {ReturnType<typeof loadDiaries>} d
 * @param {{about?: string|null}} [info] `about`: the file an ask is about
 */
export function deriveFold(group, d, info = {}) {
  const step = group.rows[0]?.step ?? null;
  const human = group.rows.some((r) => Object.prototype.hasOwnProperty.call(r, 'unjudgedCount'));
  const calls = d.calls.filter((r) => r.step === step);
  const tools = d.tools.filter((r) => r.step === step);
  const checkRows = d.checks.filter((r) => r.step === step);
  if (human ? !d.present : (calls.length + tools.length + checkRows.length === 0)) return null;

  const tryRows = group.rows.filter(isTryRow);
  const tries = [];
  const rows = [];
  if (human) {
    // a try is a pause and the answer that followed it; an ask answered on the spot (no pause row) is one try per answer. A refusal is a re-ask, not an answer.
    /** @type {any} */
    let open = null;
    for (const r of tryRows) {
      if (r.verdict === 'paused') {
        open = {
          n: r.attempt, mark: '·', thinking: null, gap: null, answer: null, about: info.about ?? null, checks: [], output: null,
        };
        tries.push(open);
      } else if (r.verdict !== 'refused' && humanWords(r) !== null) {
        if (open === null || open.answer !== null) {
          open = {
            n: r.attempt, mark: '·', thinking: null, gap: null, answer: null, about: info.about ?? null, checks: [], output: null,
          };
          tries.push(open);
        }
        open.answer = humanWords(r);
        open.mark = r.verdict === 'green' ? '✓' : (r.verdict === 'red' || r.verdict === 'stopped' ? '✗' : '·');
      }
    }
    for (const r of group.rows) {
      const words = r.verdict === 'paused' || isTryRow(r) ? humanWords(r) : null;
      if (words === null) continue;
      rows.push({
        round: null, try: Number.isInteger(r.attempt) ? r.attempt : null, action: 'human', path: r.verdict === 'paused' ? (info.about ?? null) : null, decision: words, at: r.at ?? null,
      });
    }
  } else {
    // M4d am30: a try's checks are the check row with ITS number. A number is used once per step, so that is exact. A run from before am30 may repeat a number
    // (the old Redo restarted it): those tries are paired in order only when every one of them saved (as many check rows as try rows); otherwise none is guessed.
    const seen = new Map();
    tryRows.forEach((r, i) => {
      const k = seen.get(r.attempt) ?? 0;
      seen.set(r.attempt, k + 1);
      const saved = checkRows.filter((c) => c.try === r.attempt);
      const alike = tryRows.filter((t) => t.attempt === r.attempt).length;
      const rec = saved.length === alike ? saved[k] : null;
      tries.push({
        n: r.attempt, mark: group.tryMarks[i] ?? '·', thinking: r.thinkingPhrase ?? null, gap: r.gap || null, answer: null, about: null, checks: rec?.checks ?? [], output: rec?.output ?? null,
        // M8 am7 item 4: the exact text this try was handed, from its own record; null (no line) when nothing was handed
        hints: (() => { const h = (d.hints ?? []).find((x) => x.step === step && x.try === r.attempt); return h ? { n: h.ids.length, text: h.text } : null; })(),
      });
    });
    // rounds count on through all of a step's tries, so they order the calls and tool calls; a try's check row goes after the last round it saw
    const items = [];
    calls.forEach((c, i) => items.push({ k: c.round * 2, i, row: { round: c.round, try: c.try, action: 'model call', path: null, decision: callDecision(c), at: c.at } }));
    tools.forEach((t, i) => items.push({ k: t.round * 2 + 1, i: 1e6 + i, row: { round: t.round, try: t.try, action: `model · ${t.tool}`, path: t.path ?? null, decision: toolDecision(t), at: t.at } }));
    checkRows.forEach((c, i) => items.push({ k: (c.lastRound ?? 0) * 2 + 1.5, i: 2e6 + i, row: { round: null, try: c.try, action: 'check', path: c.output?.file ?? null, decision: checkDecision(c.checks), at: c.at } }));
    items.sort((a, b) => a.k - b.k || a.i - b.i);
    for (const it of items) rows.push(it.row);
  }

  const tally = {};
  for (const t of tools) tally[t.tool] = (tally[t.tool] ?? 0) + 1;
  const tallyWords = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ');
  const lastChecks = checkRows.length ? checkRows[checkRows.length - 1].checks : null;
  const answered = human ? group.rows.filter((r) => r.verdict !== 'paused' && isTryRow(r) && humanWords(r) !== null) : [];
  const lastAnswerRow = answered.length ? answered[answered.length - 1] : null;
  return {
    who: human ? 'human' : 'model',
    tally: tallyWords || null,
    tries,
    rows,
    counts: {
      rounds: calls.length,
      tools: tools.length,
      denied: tools.filter((t) => t.decision === 'deny').length,
      checksRun: checkRows.reduce((n, c) => n + c.checks.length, 0),
      checksFailed: checkRows.reduce((n, c) => n + c.checks.filter((x) => !x.ok).length, 0),
      lastTry: lastChecks ? { run: lastChecks.length, passed: lastChecks.filter((x) => x.ok).length } : null,
    },
    lastAnswer: lastAnswerRow ? { words: answerShort(lastAnswerRow), at: lastAnswerRow.at ?? null } : null,
  };
}

/** The step card's one new line (item 6) minus the human step's time (the page formats that); `—` when there is no record. @param {ReturnType<typeof deriveFold>} fold */
export function cardLine(fold) {
  if (fold === null) return '—';
  if (fold.who === 'human') return fold.lastAnswer ? `last answer: ${fold.lastAnswer.words}` : '—';
  const lt = fold.counts.lastTry;
  const checks = lt ? `${lt.passed}/${lt.run} ${lt.passed === lt.run ? '✓' : '✗'}` : '—';
  return `${plural(fold.counts.rounds, 'round', 'rounds')} · checks on the last try ${checks}`;
}

/**
 * The Run summary's two new lines (item 5), from the same diary rows the folds read; `—` for a run with no diaries.
 * @param {ReturnType<typeof loadDiaries>} d
 */
export function summaryLines(d) {
  if (!d.present) return { calls: '—', checks: '—' };
  const denied = d.tools.filter((t) => t.decision === 'deny').length;
  const run = d.checks.reduce((n, c) => n + c.checks.length, 0);
  const failed = d.checks.reduce((n, c) => n + c.checks.filter((x) => !x.ok).length, 0);
  const byStep = new Map();
  for (const c of d.checks) {
    if (c.checks.every((x) => x.ok)) continue;
    if (!byStep.has(c.step)) byStep.set(c.step, []);
    byStep.get(c.step).push(c.try);
  }
  const list = (ns) => (ns.length === 1 ? `try ${ns[0]}` : `tries ${ns.length === 2 ? ns.join(' and ') : `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`}`);
  const where = [...byStep].map(([step, ns]) => `${step} ${list(ns)}`).join('; ');
  return {
    calls: `${d.calls.length} model · ${d.tools.length} tool · ${denied} denied`,
    checks: `${run} run · ${run - failed} passed · ${failed} failed${where ? ` (${where})` : ''}`,
  };
}
