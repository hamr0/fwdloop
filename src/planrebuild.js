// borrowed-from: bareloop src/panel/authorroutes.js@v0.56.0 (3383cce) (the row-edit route: op drop|add and a row key, the choice goes through the block's own rowChoice; the live session is replaced by the rebuild below)
// borrowed-from: bareloop src/panel/authorsession.js@v0.56.0 (3383cce) (rowEdit: the refusal words are the block's own, the choices are kept as rowChoices in the picks record)
// M16 P4 item 3 (docs/wiki/the-module-ladder.md, "M16" am3 (4)): Drop and Add on the plan card. fwd drafts in a child process, so no live check block outlives a draft: the panel REBUILDS the list at $0
// from what the draft saved (its prose, the frozen page copies and the document inputs, page-look.json, picks-record.json, and the AI's edit replies in log.json), applies the person's choice through
// the block's own `rowChoice`, assembles the checks again and hands back the files of a NEW plan. It makes no provider call, builds no provider, spawns nothing. The rebuild is only trusted when,
// before the choice, it reproduces the saved plan's list exactly; if an input changed since the draft the person is told so and nothing is written.
// What this throws away: nothing of the old plan (it is never rewritten, records are write-once).
import path from 'node:path';
import { parseSignedText } from './signed-text.js';
import { readFileInside, readdirInside } from './flow.js';
import { readInputFacts } from './input-facts.js';
import { blockJobLines } from './blocklines.js';
import { setUpBlock, pickEdits, ledgerEdits } from './blockdraft.js';
import { assembleFromBlock } from './blockassemble.js';
import { cardOfBlock } from './cardlist.js';
import { editsOf } from './rowedit.js';
import { offerRules, rowsFromAnswer, codeScope } from './checkpick.js';
import { matchRecord, readRowChoices, RECORD_FILE } from './pickrecord.js';
import { listLinesOf } from './checklistsign.js';
import { validateDeclaration } from './declaration.js';
import { loadCatalogue } from './catalogue.js';
import { WIRED_VERBS } from './primitives.js';
import { ticketSourcesOf } from './ticket-draft.js';
import { docRolesOf } from './drafter.js';
import { buildReadout, specHash, PAGES_DIR, NOT_CHECKED_FILE } from './authoring.js';

/** what a person is told when the saved inputs no longer give the saved list: nothing is written */
export const REBUILD_CHANGED_SAY = 'The inputs of this plan have changed since it was drafted, so its checks cannot be changed here. Draft again from the card. Nothing was changed.';
/** a plan that has no list (drafted before M16) */
export const NO_LIST_SAY = 'This plan has no list of checks to change. Nothing was changed.';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const readJson = (/** @type {string} */ dir, /** @type {string} */ rel) => { const r = readFileInside(dir, rel); if (!r.ok) return null; try { return JSON.parse(r.text); } catch { return null; } };

/**
 * Rebuild the block of a saved plan at $0. `choices` = the Drop/Add choices the plan was made with (its record's `rowChoices`).
 * @param {{planDir: string, asks: boolean}} o
 * @returns {{ok: true, block: import('./checkblock.js').CheckBlock, declaration: any, lines: any[], lineSet: Set<number>, parsed: any, texts: Record<string, string>, look: {facts: any[], dropped: any[]}, record: any, log: any, proseText: string}|{ok: false, say: string}}
 */
export function rebuildBlock({ planDir, asks }) {
  const no = (/** @type {string} */ say) => ({ ok: /** @type {const} */ (false), say });
  const prose = readFileInside(planDir, 'prose.txt');
  const parsed = prose.ok ? parseSignedText(prose.text) : null;
  const declaration = readJson(planDir, 'declaration.json');
  if (!prose.ok || !parsed || !parsed.ok || !isRec(declaration)) return no('This plan could not be read. Nothing was changed.');
  const lineSet = listLinesOf(declaration);
  if (lineSet.size === 0) return no(NO_LIST_SAY);
  const log = readJson(planDir, 'log.json');
  const pageLook = readJson(planDir, 'page-look.json');
  const look = isRec(pageLook?.look) ? { facts: Array.isArray(pageLook.look.facts) ? pageLook.look.facts : [], dropped: Array.isArray(pageLook.look.dropped) ? pageLook.look.dropped : [] } : { facts: [], dropped: [] };
  const record = readJson(planDir, RECORD_FILE) ?? {};
  // the frozen copies of the page inputs, then the document inputs as the draft read them (they are not copied into the folder: an input that changed is caught below)
  /** @type {Record<string, {text: string}>} */
  const pages = {};
  for (const p of Array.isArray(pageLook?.pages) ? pageLook.pages : []) {
    const f = readFileInside(planDir, path.join(PAGES_DIR, String(p.frozen)));
    if (f.ok && typeof p.role === 'string') pages[p.role] = { text: f.text };
  }
  const ticketSources = declaration.flowType === 'tickets' ? ticketSourcesOf(parsed.arbiter.sources) : [];
  const facts = readInputFacts((parsed.arbiter.sources ?? []).filter((/** @type {any} */ s) => !ticketSources.includes(s)), { pages });
  if (!facts.ok) return no(REBUILD_CHANGED_SAY);
  const texts = { ...(facts.docs ?? {}), ...Object.fromEntries(Object.entries(pages).map(([role, pg]) => [role, pg.text])) };
  // the lines the block was given are the lines the saved list has rows on
  const all = blockJobLines(prose.text, undefined, []);
  if (!all.ok) return no('This plan could not be read. Nothing was changed.');
  const tied = all.jobLines.filter((l) => !lineSet.has(l.n)).map((l) => l.n);
  const plan = blockJobLines(prose.text, undefined, tied);
  if (!plan.ok) return no('This plan could not be read. Nothing was changed.');
  const blockLineNums = new Set(plan.jobLines.map((l) => l.n));
  const inBlock = (/** @type {{line: number}} */ x) => blockLineNums.has(x.line);
  const lines = parsed.lines;
  const allShape = offerRules(lines, parsed.arbiter, look.facts);
  const matched = matchRecord(Array.isArray(record.picks) ? record.picks : [], lines, allShape);
  const keptKeys = new Set((Array.isArray(record.kept) ? record.kept : []).map((/** @type {any} */ k) => `${k.line}:${k.rule}`));
  const isKept = (/** @type {{line: number, rule: number}} */ x) => keptKeys.has(`${x.line}:${x.rule}`);
  const block = setUpBlock({
    texts, jobLines: plan.jobLines, look,
    kept: { picks: matched.picks.filter(inBlock).filter(isKept), left: matched.left.filter(inBlock).filter(isKept), askRules: matched.askRules.filter(inBlock) },
    fresh: { picks: matched.picks.filter(inBlock).filter((x) => !isKept(x)), left: matched.left.filter(inBlock).filter((x) => !isKept(x)) },
    asks, countScope: (t) => codeScope(parsed.arbiter.sources, t) === 'in', scoped: allShape.filter(inBlock),
  });
  // the AI's replies, in the order the draft took them (log.json keeps each reply as sent)
  const askRules = allShape.filter((r) => !isKept(r));
  for (const e of Array.isArray(log?.log) ? log.log : []) {
    if (!isRec(e) || e.outcome !== 'answered' || !isRec(e.args)) continue;
    if (e.kind === 'check-suggest') block.applyDelta({ label: 'pre:check-suggest', pre: true, edits: pickEdits(rowsFromAnswer(askRules, e.args), blockLineNums) });
    else if (e.kind === 'ledger-suggest') block.applyDelta({ label: 'pre:ledger-suggest', pre: true, edits: ledgerEdits(e.args.extra) });
    else if (e.kind === 'row-edit' || e.kind === 'row-edit-revision') block.applyDelta({ label: `${e.kind}-${e.round}`, edits: editsOf(e.args) });
    else continue;
    block.reconcile();
  }
  // the choices the plan was made with (a Drop or an Add of an earlier edit), judged by the block again
  const choices = readRowChoices(path.join(planDir, RECORD_FILE));
  if (choices) block.carryChoices(choices);
  block.reconcile();
  return { ok: true, block, declaration, lines, lineSet, parsed, texts, look, record, log, proseText: prose.text };
}

/**
 * The checks of a rebuilt block put back into the saved plan's declaration (the same assembly the draft used), re-proved by the validator.
 * @param {any} b
 * @returns {{ok: true, declaration: any, notChecked: string[], notCheckedBy: Record<string, string>}|{ok: false, say: string}}
 */
function assembleAgain(b) {
  const { checkList: _c, pickedLines: _p, ...saved } = b.declaration;
  // a document input is listed in a step's reads only by the step that quotes it, and the assembly put it there: take it out first, the assembly adds it again while the fact is still built
  const docs = new Set(docRolesOf(b.parsed.arbiter.sources));
  const rest = { ...saved, steps: (saved.steps ?? []).map((/** @type {any} */ st) => {
    const src = b.lineSet.has(st?.fromLine) && isRec(st.close) && isRec(st.close.cited) ? st.close.cited.source : undefined;
    return typeof src === 'string' && docs.has(src) && Array.isArray(st.reads) ? { ...st, reads: st.reads.filter((/** @type {string} */ r) => r !== src) } : st;
  }) };
  const a = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet });
  const cat = loadCatalogue();
  if (!cat.ok) return { ok: false, say: 'The catalogue could not be read. Nothing was changed.' };
  const inPlan = new Set(b.block.rows.filter((r) => r.state === 'built').flatMap((r) => (r.factNames ?? []).map((/** @type {string} */ nm) => `${r.line}:${nm}`)));
  const planFacts = b.look.facts.filter((f) => !b.lineSet.has(f.line) || inPlan.has(`${f.line}:${f.name}`));
  const pageSources = (b.parsed.arbiter.sources ?? []).some((/** @type {any} */ s) => s.kind === 'page');
  const verdict = validateDeclaration(a.declaration, {
    arbiter: b.parsed.arbiter, lines: b.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
    pageWords: { texts: b.texts, look: pageSources ? { facts: planFacts, dropped: b.look.dropped } : null, docs: docRolesOf(b.parsed.arbiter.sources) },
  });
  if (!verdict.ok) return { ok: false, say: `The changed list did not pass the plan's checks (${String(verdict.reds[0])}). Nothing was changed.` };
  return { ok: true, declaration: a.declaration, notChecked: a.notChecked, notCheckedBy: a.notCheckedBy };
}

/** the plan's list and the closes it checks, as one comparable string (the proof that the rebuild is the saved plan) @param {any} d */
const fingerprint = (d) => JSON.stringify([d.checkList ?? null, (d.steps ?? []).map((/** @type {any} */ s) => [s?.fromLine, s?.close])]);

/**
 * Drop or Add a row of a saved plan, at $0. Returns the files of the NEW plan folder (the caller writes them once); the old plan is never touched.
 * @param {{planDir: string, op: 'drop'|'add', key: string, asks?: boolean}} o
 * @returns {{ok: true, files: Record<string, string>, pages: Record<string, string>, logRow: Record<string, any>, hash: string}|{ok: false, say: string, refused?: string}}
 */
export function rowEditPlan({ planDir, op, key, asks = true }) {
  const b = rebuildBlock({ planDir, asks });
  if (!b.ok) return { ok: false, say: b.say, refused: 'no-list' };
  const before = assembleAgain(b);
  if (!before.ok) return { ok: false, say: before.say, refused: 'rebuild' };
  if (fingerprint(before.declaration) !== fingerprint(b.declaration)) return { ok: false, say: REBUILD_CHANGED_SAY, refused: 'changed' };
  const done = b.block.rowChoice(key, op);
  if (!done.ok) return { ok: false, say: `${done.why[0].toUpperCase()}${done.why.slice(1)}${/[.!?]$/.test(done.why) ? '' : '.'} Nothing was changed.`, refused: 'bad-row' };
  const after = assembleAgain(b);
  if (!after.ok) return { ok: false, say: after.say, refused: 'rebuild' };
  const target = readJson(planDir, 'target.json');
  const inputFactsText = readFileInside(planDir, 'input-facts.json');
  const targetText = readFileInside(planDir, 'target.json');
  if (!targetText.ok || !inputFactsText.ok || !isRec(target)) return { ok: false, say: 'This plan could not be read. Nothing was changed.', refused: 'rebuild' };
  const dj = (/** @type {unknown} */ o) => `${JSON.stringify(o, null, 2)}\n`;
  const declarationText = dj(after.declaration);
  const readoutText = buildReadout({
    declaration: after.declaration, arbiter: b.parsed.arbiter, lines: b.lines, name: target.name, modelId: b.log?.modelId, costUsd: b.log?.costUsd ?? null, rounds: b.log?.rounds ?? 0, spendComplete: b.log?.spendComplete !== false, root: target.root,
  });
  const h = specHash({ proseText: b.proseText, declarationText, inputFactsText: inputFactsText.text, readoutText, targetText: targetText.text });
  if (!h.ok) return { ok: false, say: 'The changed plan could not be hashed. Nothing was changed.', refused: 'rebuild' };
  // the "Not checked" list: what the old plan listed, less what the old list made, plus what the changed list makes (the AI's own list stays)
  const oldNc = readJson(planDir, NOT_CHECKED_FILE)?.notChecked;
  const oldList = Array.isArray(oldNc) ? oldNc.filter((x) => typeof x === 'string') : [];
  const was = new Set(before.notChecked);
  const notChecked = [...oldList.filter((x) => !was.has(x)), ...after.notChecked.filter((x) => !oldList.includes(x) || !was.has(x))];
  const oldBy = isRec(readJson(planDir, NOT_CHECKED_FILE)?.by) ? readJson(planDir, NOT_CHECKED_FILE).by : {};
  const by = { ...Object.fromEntries(Object.entries(oldBy).filter(([t]) => !was.has(t))), ...after.notCheckedBy };
  const record = isRec(b.record) ? b.record : {};
  const logRow = { round: (Array.isArray(b.log?.log) ? b.log.log.length : 0) + 1, kind: 'row-edit-human', op, key, outcome: 'answered', at: new Date().toISOString() };
  // the files the new plan keeps as they were (read through the gateway), then the ones it changes; `spec.hash` last, so a folder with one is whole
  /** @type {Record<string, string>} */
  const kept = {};
  for (const f of ['prose.txt', 'target.json', 'input-facts.json', 'page-look.json', 'model.json', 'learnings.json']) {
    const r = readFileInside(planDir, f);
    if (r.ok) kept[f] = r.text;
  }
  /** @type {Record<string, string>} */
  const pages = {};
  for (const f of readdirInside(planDir, PAGES_DIR)) {
    const r = readFileInside(planDir, path.join(PAGES_DIR, f));
    if (r.ok) pages[path.join(PAGES_DIR, f)] = r.text;
  }
  return {
    ok: true,
    hash: h.hash,
    logRow,
    pages,
    files: {
      ...kept,
      'declaration.json': declarationText,
      'readout.txt': readoutText,
      [NOT_CHECKED_FILE]: dj({ notChecked, ...(Object.keys(by).length ? { by } : {}) }),
      [RECORD_FILE]: dj({ ...record, rowChoices: b.block.choicesRecord() }),
      'log.json': dj({ ...(isRec(b.log) ? b.log : {}), log: [...(Array.isArray(b.log?.log) ? b.log.log : []), logRow], checkCard: cardOfBlock(b.block) }),
      'spec.hash': `${h.hash}\n`,
    },
  };
}
