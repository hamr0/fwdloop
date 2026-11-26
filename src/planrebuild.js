// borrowed-from: bareloop src/panel/authorroutes.js@v0.56.0 (3383cce) (the row-edit route: op drop|add and a row key, the choice goes through the block's own rowChoice; the live session is replaced by the rebuild below)
// borrowed-from: bareloop src/panel/authorsession.js@v0.56.0 (3383cce) (rowEdit: the refusal words are the block's own, the choices are kept as rowChoices in the picks record)
// M16 P4 item 3 (docs/wiki/the-module-ladder.md, "M16" am3 (4)): Drop and Add on the plan card. fwd drafts in a child process, so no live check block outlives a draft: the panel REBUILDS the list at $0
// from what the draft saved (its prose, the frozen page copies and the document inputs, page-look.json, picks-record.json, and the AI's edit replies in log.json), applies the person's choice through
// the block's own `rowChoice`, assembles the checks again and hands back the files of a NEW plan. It makes no provider call, builds no provider, spawns nothing. The rebuild is only trusted when,
// before the choice, it reproduces the saved plan's list exactly; if an input changed since the draft the person is told so and nothing is written.
// What this throws away: nothing of the old plan (it is never rewritten, records are write-once).
import path from 'node:path';
import { parseSignedText } from './signed-text.js';
import { readFileInside, readdirInside, readDraftLog, readJsonFile } from './flow.js';
import { readInputFacts } from './input-facts.js';
import { blockJobLines } from './blocklines.js';
import { setUpBlock, ticketLeaveOut, pickEdits, ledgerEdits } from './blockdraft.js';
import { assembleFromBlock } from './blockassemble.js';
import { cardOfBlock, cardOfPlanBlock } from './cardlist.js';
import { ledgerRowsOf } from './checkrows.js';
import { editsOf } from './rowedit.js';
import { NOTE_KIND } from './noteask.js';
import { offerRules, rowsFromAnswer, codeScope } from './checkpick.js';
import { matchRecord, readRowChoices, RECORD_FILE } from './pickrecord.js';
import { listLinesOf, cardLinesOf } from './checklistsign.js';
import { csvRolesOf } from './sheetblock.js';
import { withTicketRows } from './ticketrows.js';
import { isSheetKey, sheetRowsOf, withSheetRows, withSheetCard } from './sheetrows.js';
import { validateDeclaration } from './declaration.js';
import { loadCatalogue } from './catalogue.js';
import { WIRED_VERBS } from './primitives.js';
import { ticketSourcesOf } from './ticket-draft.js';
import { docRolesOf } from './drafter.js';
import { buildShapes } from './shapebuild.js';
import { parseShapeAnswer, SHAPE_CALL_LABEL } from './shapelook.js';
import { lineRules } from './pagebits.js';
import { buildReadout, specHash, PAGES_DIR, NOT_CHECKED_FILE, SPEC_HASH_FILE } from './authoring.js';
import { readNotCheckedFile } from './draftfiles.js';

/** what a person is told when the saved inputs no longer give the saved list: nothing is written */
export const REBUILD_CHANGED_SAY = 'The inputs of this plan have changed since it was drafted, so its checks cannot be changed here. Draft again from the card. Nothing was changed.';
/** a plan that has no list (drafted before M16) */
export const NO_LIST_SAY = 'This plan has no list of checks to change. Nothing was changed.';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Rebuild the block of a saved plan at $0. `choices` = the Drop/Add choices the plan was made with (its record's `rowChoices`).
 * @param {{planDir: string, asks: boolean}} o
 * @returns {{ok: true, block: import('./checkblock.js').CheckBlock, declaration: any, lines: any[], lineSet: Set<number>, parsed: any, texts: Record<string, string>, look: {facts: any[], dropped: any[]}, record: any, log: any, proseText: string}|{ok: false, say: string}}
 */
export function rebuildBlock({ planDir, asks }) {
  const no = (/** @type {string} */ say) => ({ ok: /** @type {const} */ (false), say });
  const prose = readFileInside(planDir, 'prose.txt');
  const parsed = prose.ok ? parseSignedText(prose.text) : null;
  const declaration = readJsonFile(planDir, 'declaration.json');
  if (!prose.ok || !parsed || !parsed.ok || !isRec(declaration)) return no('This plan could not be read. Nothing was changed.');
  // the lines the block was given; a CSV job's sheet lines (M16 am4) have rows on the list too, but the block never had them
  const lineSet = listLinesOf(declaration);
  if (cardLinesOf(declaration).size === 0) return no(NO_LIST_SAY);
  const log = readDraftLog(planDir);
  const pageLook = readJsonFile(planDir, 'page-look.json');
  const look = isRec(pageLook?.look) ? { facts: Array.isArray(pageLook.look.facts) ? pageLook.look.facts : [], dropped: Array.isArray(pageLook.look.dropped) ? pageLook.look.dropped : [] } : { facts: [], dropped: [] };
  const record = readJsonFile(planDir, RECORD_FILE) ?? {};
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
  // M19 S3: a sheet line is the block's too; the draft saved what code built from the AI's sheet suggestions (log.json `sheetBuilt`), so the block holds its sheet rows again without a call. A plan that has sheet checks
  // and no such record was drafted before this and cannot be rebuilt: the same sentence as an input that changed
  const sheetBuilt = isRec(log?.sheetBuilt) && isRec(log.sheetBuilt.built) ? log.sheetBuilt : null;
  if (sheetBuilt === null && (declaration.steps ?? []).some((/** @type {any} */ st) => isRec(st?.close) && Array.isArray(st.close.sheet))) return no(REBUILD_CHANGED_SAY);
  const sheetLineNums = sheetBuilt === null ? [] : Object.keys(sheetBuilt.built).map(Number).filter((n) => tied.includes(n));
  const notSheet = (/** @type {{line: number}} */ x) => !sheetLineNums.includes(x.line);
  const lines = parsed.lines;
  const allShape = offerRules(lines, parsed.arbiter, look.facts);
  const matched = matchRecord(Array.isArray(record.picks) ? record.picks : [], lines, allShape);
  const keptKeys = new Set((Array.isArray(record.kept) ? record.kept : []).map((/** @type {any} */ k) => `${k.line}:${k.rule}`));
  const isKept = (/** @type {{line: number, rule: number}} */ x) => keptKeys.has(`${x.line}:${x.rule}`);
  // a rule the person answered Drop it: the draft was told it as `leftRules` and saved it as a `person-left` drop in page-look.json (its record holds no entry for a rule the look served);
  // the rebuild reads that same saved drop, so the rule is the block's own `left` row again and its note keeps the person's words
  const leftSaved = look.dropped.filter((/** @type {any} */ d) => d?.reason === 'person-left' && Number.isInteger(d.line) && Number.isInteger(d.rule)).map((/** @type {any} */ d) => ({ line: d.line, rule: d.rule }));
  const leftFresh = [...matched.left.filter((x) => !isKept(x)), ...leftSaved.filter((x) => !matched.left.some((m) => m.line === x.line && m.rule === x.rule))].filter(inBlock);
  const block = setUpBlock({
    texts, jobLines: [...plan.jobLines, ...all.jobLines.filter((l) => sheetLineNums.includes(l.n))].sort((a, b) => a.n - b.n), look: { facts: look.facts.filter(notSheet), dropped: look.dropped.filter(notSheet) },
    kept: { picks: matched.picks.filter(inBlock).filter(isKept), left: matched.left.filter(inBlock).filter(isKept), askRules: matched.askRules.filter(inBlock) },
    fresh: { picks: matched.picks.filter(inBlock).filter((x) => !isKept(x)), left: leftFresh },
    asks, countScope: (t) => codeScope(parsed.arbiter.sources, t) === 'in', leaveOut: ticketLeaveOut(declaration.flowType, plan.jobLines), sheetLines: sheetLineNums,
  });
  // the AI's replies, in the order the draft took them (log.json keeps each reply as sent)
  const askRules = allShape.filter((r) => !isKept(r));
  let shapeSet = false;
  for (const e of Array.isArray(log?.log) ? log.log : []) {
    // the note question's answers ride its entry, a failed turn's too (a `failed` answer is a Not checked row, so it must replay)
    if (isRec(e) && e.kind === NOTE_KIND) { block.setNotes(notesOfEntry(e)); continue; }
    // M19 S9: the shape look's answer, as the draft saved it (log.json keeps the raw text of the one call it made). It is read again through the same parser and the same builder, so the block holds its shape rows
    // without a call; the first answer that reads is the one the draft used (an unreadable first answer was asked once more). A plan with shape rows and no such entry does not rebuild (the list differs below)
    if (isRec(e) && e.kind === SHAPE_CALL_LABEL) {
      const got = e.outcome === 'answered' && typeof e.rawText === 'string' && !shapeSet ? parseShapeAnswer(e.rawText) : null;
      if (got !== null && got.ok && got.shapes.length > 0) {
        shapeSet = true;
        block.setShape(buildShapes({ lines: plan.jobLines.filter((l) => lineRules(l).length > 0 && !block.isSheetLine(l.n)), labels: block.labels, suggestions: got.shapes }));
        block.reconcile();
      }
      continue;
    }
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
  // the sheet checks the draft built, in the draft's own order (after the AI's edits), and the Drops the plan was made with
  if (sheetBuilt !== null) { block.setSheet(sheetBuilt); block.carrySheetDropped(Array.isArray(record.sheetDropped) ? record.sheetDropped : []); }
  if (Array.isArray(record.shapeDropped) && record.shapeDropped.length) block.carryShapeDropped(record.shapeDropped);
  block.reconcile();
  return { ok: true, block, declaration, lines, lineSet, parsed, texts, look, record, log, proseText: prose.text };
}

/**
 * The checks of a rebuilt block put back into the saved plan's declaration (the same assembly the draft used), re-proved by the validator.
 * @param {any} b @param {any} [from] the declaration to assemble over (a sheet Drop or Add changes its `close.sheet`); the saved one by default
 * @returns {{ok: true, declaration: any, notChecked: string[], notCheckedBy: Record<string, string>, sheet: ReturnType<typeof withSheetRows>['sheet'], tickets: ReturnType<typeof withTicketRows>['tickets']}|{ok: false, say: string}}
 */
function assembleAgain(b, from = b.declaration) {
  const { checkList: _c, pickedLines: _p, ...saved } = from;
  // a document input is listed in a step's reads only by the step that quotes it, and the assembly put it there: take it out first, the assembly adds it again while the fact is still built
  const docs = new Set(docRolesOf(b.parsed.arbiter.sources));
  const rest = { ...saved, steps: (saved.steps ?? []).map((/** @type {any} */ st) => {
    const src = b.lineSet.has(st?.fromLine) && isRec(st.close) && isRec(st.close.cited) ? st.close.cited.source : undefined;
    return typeof src === 'string' && docs.has(src) && Array.isArray(st.reads) ? { ...st, reads: st.reads.filter((/** @type {string} */ r) => r !== src) } : st;
  }) };
  const built = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines: new Set(b.parsed.arbiter.asks.map((/** @type {any} */ a) => a.line)), sheetRoles: csvRolesOf(b.parsed.arbiter) });
  // M16 am4: the sheet checks are rows on the list too, read from the steps the same way the draft read them
  const withSheet = withSheetRows({ declaration: built.declaration, lines: b.lines, csvRoles: csvRolesOf(b.parsed.arbiter) });
  // M17 am6: the Tickets filter and watch are rows on the list too, read from the declaration's fields the same way the draft read them
  const withTickets = withTicketRows({ declaration: withSheet.declaration, lines: b.lines });
  const ticketLines = withTickets.tickets.notChecked.map((t) => `not checked · "${t.rule}" — ${t.reason}`);
  const a = { ...built, declaration: withTickets.declaration, notChecked: [...built.notChecked, ...ticketLines], notCheckedBy: { ...built.notCheckedBy, ...Object.fromEntries(ticketLines.map((t) => [t, 'you'])) } };
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
  return { ok: true, declaration: a.declaration, notChecked: a.notChecked, notCheckedBy: a.notCheckedBy, sheet: withSheet.sheet, tickets: withTickets.tickets };
}

/** the answers a note-question entry of the draft's log recorded; only well-formed ones (a line, yes|no|failed) @param {any} e @returns {{line: number, answer: 'yes'|'no'|'failed'}[]} */
const notesOfEntry = (e) => (Array.isArray(e.notes) ? e.notes.filter((/** @type {any} */ a) => isRec(a) && Number.isInteger(a.line) && (a.answer === 'yes' || a.answer === 'no' || a.answer === 'failed')) : []);

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
  // M19 S3: a sheet check is a row of the block like any other (its Drop or Add is the block's `rowChoice`). A `[you]` sheet row is drawn with the key of its check (src/sheetrows.js), which is no row of the block: the
  // refusals for it are the words the plan card has always given
  /** @type {string|null} */
  let sheetKeyWhy = null;
  if (isSheetKey(key) && !b.block.rows.some((r) => r.key === key)) {
    const card = sheetRowsOf({ declaration: b.declaration, lines: b.lines, csvRoles: csvRolesOf(b.parsed.arbiter) }).card.find((r) => r.key === key);
    sheetKeyWhy = op === 'drop' ? (card?.by === 'you' ? 'that check comes from a rule you wrote; edit the job to change it' : 'there is no such check on the list') : 'only a suggested check can be added';
  }
  const done = sheetKeyWhy !== null ? { ok: /** @type {const} */ (false), why: sheetKeyWhy } : b.block.rowChoice(key, op);
  if (!done.ok) return { ok: false, say: `${done.why[0].toUpperCase()}${done.why.slice(1)}${/[.!?]$/.test(done.why) ? '' : '.'} Nothing was changed.`, refused: 'bad-row' };
  const droppedNow = b.block.sheetDroppedRecord();
  const shapeDroppedNow = b.block.shapeDroppedRecord();
  const after = assembleAgain(b);
  if (!after.ok) return { ok: false, say: after.say, refused: 'rebuild' };
  const target = readJsonFile(planDir, 'target.json');
  const inputFactsText = readFileInside(planDir, 'input-facts.json');
  const targetText = readFileInside(planDir, 'target.json');
  if (!targetText.ok || !inputFactsText.ok || !isRec(target)) return { ok: false, say: 'This plan could not be read. Nothing was changed.', refused: 'rebuild' };
  const dj = (/** @type {unknown} */ o) => `${JSON.stringify(o, null, 2)}\n`;
  const declarationText = dj(after.declaration);
  // the "Not checked" list: what the old plan listed, less what the old list made, plus what the changed list makes (the AI's own list stays)
  const oldNcFile = readNotCheckedFile(planDir);
  const oldNc = oldNcFile.notChecked;
  const oldList = Array.isArray(oldNc) ? oldNc.filter((x) => typeof x === 'string') : [];
  const was = new Set(before.notChecked);
  const notChecked = [...new Set([...oldList.filter((x) => !was.has(x)), ...after.notChecked])];
  const oldBy = oldNcFile.by ?? {};
  const by = { ...Object.fromEntries(Object.entries(oldBy).filter(([t]) => !was.has(t))), ...after.notCheckedBy };
  // M19 am4: the plan card the new plan saves is the one its readout reads (one model)
  // M19 am8 item 1, am9 item 5: the new plan's ledger rows, one per Not checked row, in its own log; the card is read from the new plan (am6)
  const ledger = ledgerRowsOf(after.declaration, b.lines, Object.fromEntries(b.block.rows.filter((/** @type {any} */ r) => r.kind !== 'rule').map((/** @type {any} */ r) => [r.key, r.name ? [r.name] : r.words ?? []])));
  const card = (() => { const c = withSheetCard(cardOfBlock(b.block), after.sheet); return cardOfPlanBlock(b.block, after.tickets.card.length ? withSheetCard(c, { card: after.tickets.card }) : c, { declaration: after.declaration, lines: b.lines, csvRoles: csvRolesOf(b.parsed.arbiter), log: [...(Array.isArray(b.log?.log) ? b.log.log : []), ...ledger] }); })();
  const readoutText = buildReadout({
    declaration: after.declaration, arbiter: b.parsed.arbiter, lines: b.lines, name: target.name, modelId: b.log?.modelId, costUsd: b.log?.costUsd ?? null, rounds: b.log?.rounds ?? 0, spendComplete: b.log?.spendComplete !== false, root: target.root,
    notChecked, notCheckedBy: by, suggested: card.suggested, checkCard: card,
  });
  const h = specHash({ proseText: b.proseText, declarationText, inputFactsText: inputFactsText.text, readoutText, targetText: targetText.text });
  if (!h.ok) return { ok: false, say: 'The changed plan could not be hashed. Nothing was changed.', refused: 'rebuild' };
  const { sheetDropped: _sd, shapeDropped: _shd, ...record } = isRec(b.record) ? b.record : {};
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
      [RECORD_FILE]: dj({ ...record, rowChoices: b.block.choicesRecord(), ...(droppedNow.length ? { sheetDropped: droppedNow } : {}), ...(shapeDroppedNow.length ? { shapeDropped: shapeDroppedNow } : {}) }),
      'log.json': dj({ ...(isRec(b.log) ? b.log : {}), log: [...(Array.isArray(b.log?.log) ? b.log.log : []), logRow, ...ledger], checkCard: card }),
      [SPEC_HASH_FILE]: `${h.hash}\n`,
    },
  };
}
