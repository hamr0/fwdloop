// M20 am3 item 13: each owner named in am3 has a guard that fails when a second reader of its file or fact appears outside its allow-list.
// One file, one `strays` per owner; each allow-list entry carries its reason. Batch 1: items 11, 7, 9, 2, 1, 3. Batch 2: items 5, 6, 8, 10, 12 (4 waits for am3b).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { listRunValues, pickRunValues } from '../src/runvalues.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (n.endsWith('.js') || n.endsWith('.mjs')) out.push(p);
  }
  return out;
}
export const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
/** src-relative path -> text, plus bin/fwdloop as 'bin/fwdloop' */
export function load() {
  const files = {};
  for (const f of walk(SRC)) files[path.relative(SRC, f)] = readFileSync(f, 'utf8');
  files['bin/fwdloop'] = readFileSync(path.join(ROOT, 'bin', 'fwdloop'), 'utf8');
  return files;
}
/** files that match `re` in code and are not on the allow-list @param {Record<string,string>} files @param {RegExp} re @param {Record<string,string>} allow */
export const strays = (files, re, allow) => Object.keys(files).filter((f) => !Object.hasOwn(allow, f) && re.test(code(files[f])));

// item 11: audit.jsonl and state.json are read by one reader each (readAudit, readRunState, both with a named strict mode); halt.<n>.consumed.json is named in one place
const AUDIT = { 'books.js': 'readAudit: the one reader and the appender', 'liveness.js': 'BOOK_FILES: a name in a list whose mtime says the run is alive; reads nothing' };
const STATE = {
  'books.js': 'readRunState: the one reader',
  'liveness.js': 'BOOK_FILES: mtime only; reads nothing',
  'runner.js': 'the parked-state writer (park) and the set-aside rename on stop; neither reads',
};
const HALT_CONSUMED = { 'books.js': 'haltConsumedCount / nextHaltConsumedName: the one place the name is spelled' };

test('item 11: only the listed files name audit.jsonl, state.json, halt.<n>.consumed.json in code', () => {
  const files = load();
  assert.deepEqual(strays(files, /['"`]audit\.jsonl['"`]/, AUDIT), []);
  assert.deepEqual(strays(files, /['"`]state\.json['"`]/, STATE), []);
  assert.deepEqual(strays(files, /halt\\\.\\d|halt\.\$\{[^}]*\}\.consumed/, HALT_CONSUMED), []);
});

// item 7: a run's trigger.json is read by readTriggerRecord (src/books.js) only
const TRIGGER = {
  'trigger-line.js': 'declares the file name',
  'books.js': 'readTriggerRecord: the one reader',
  'panel/authorstart.js': 'the one writer (the start claim, flag wx)',
  'runvalues.js': 'a name in the "folder holds no run yet" list; reads nothing',
  'bin/fwdloop': 'a name in the "folder holds no run yet" list; reads nothing',
};
test('item 7: only the listed files name trigger.json in code', () => {
  assert.deepEqual(strays(load(), /TRIGGER_RECORD_FILE|['"`]trigger\.json['"`]/, TRIGGER), []);
});

// item 9: a run's run.json and diary.jsonl are read through readRunRecord (runfile.js) and the diary readers (diary.js) only
const RUN_DIARY = {
  'runfile.js': 'the run.json writer and readRunRecord, its one reader',
  'diary.js': 'the diary writer and readKind, its one reader',
  'panel/authorflows.js': 'the file\'s mtime only (lstat to order runs); content goes through readRunInputs',
  'mcp-use.js': 'the file\'s mtime only (statSync after readRunRecord accepted it); content goes through readRunRecord and readTools',
};
test('item 9: only the listed files name run.json or diary.jsonl in code', () => {
  assert.deepEqual(strays(load(), /['"`]run\.json['"`]|['"`]diary\.jsonl['"`]|\bRUN_FILE\b|\bDIARY_FILE\b/, RUN_DIARY), []);
});

// item 2: a run's job/ copy (prose.txt, declaration.json, signature.json) is read only inside src/flow.js, through readRunJobCopy (the copier and planForReuse live there too)
const JOB_COPY = { 'flow.js': 'readRunJobCopy: the one reader; writeRunJobCopy / copyRunPlan write and copy it; planForReuse is its caller' };
test('item 2: only src/flow.js names a run\'s job/ files in code', () => {
  assert.deepEqual(strays(load(), /job\/(prose\.txt|declaration\.json|signature\.json)|\bRUN_JOB_DIR\b/, JOB_COPY), []);
});

// item 1 (am3a): "this run ran the job the flow holds now" is sameJob (src/flow.js): the prose-without-trigger-line comparison is spelled there only.
// runJobEdited (panel/data.js) asks a different question (the halt record's signature hash against the run's own job) and does not compare prose, so it is not on this list.
const SAME_JOB = {
  'trigger-line.js': 'declares stripTrigger',
  'flow.js': 'sameJob: the one rule (planForReuse and greenRuns ask it)',
};
test('item 1: only sameJob compares a run\'s prose with the flow\'s (stripTrigger)', () => {
  assert.deepEqual(strays(load(), /\bstripTrigger\b/, SAME_JOB), []);
});

// item 3 (am3a): three questions, three owners; each list of file names is spelled in its owner only
test('item 3: each "folder holds ..." list is spelled once, in its owner', () => {
  const files = load();
  const ONLY = (re, owner, why) => assert.deepEqual(strays(files, re, { [owner]: why }), [], why);
  ONLY(/valuesFileName\(0\)[^\n]*TRIGGER_RECORD_FILE|TRIGGER_RECORD_FILE[^\n]*valuesFileName\(0\)/, 'runvalues.js', 'dropUnstartedValues: may these pre-start files be deleted (2 names)');
  ONLY(/['"]setup\.jsonl['"][\s\S]{0,300}['"]plan\.json['"]|['"]plan\.json['"][\s\S]{0,300}['"]setup\.jsonl['"]/, 'bin/fwdloop', 'the CLI: does this folder hold no run yet (6 names)');
  ONLY(/['"]ask\.json['"]\s*,\s*['"]answer\.json['"]/, 'runner.js', 'checkFreshRunDir: is a stale ask or answer left here (2 names)');
});

// item 5: the consumed-answer name `answer.<askId>.consumed.json` is spelled in src/books.js only (consumedAnswerName, askIdOfConsumedName); the in-process file ask step and its `answer.stale.<n>.json` are gone
const CONSUMED = { 'books.js': 'consumedAnswerName / askIdOfConsumedName: the one place the name is spelled' };
test('item 5: only src/books.js spells the consumed-answer name; makeFileAskStep and answer.stale are gone', () => {
  const files = load();
  assert.deepEqual(strays(files, /\.consumed\.json|consumed\\\.json/, CONSUMED), []);
  assert.deepEqual(strays(files, /makeFileAskStep|\bsafeStamp\b|answer\.stale/, {}), []);
});

// item 6: signed-values files are read by runvalues.js only (pickRunValues for the version in force, listRunValues for the Audit's list: one parser, readValuesFile)
const SIGNED_VALUES = {
  'runvalues.js': 'the writer, readValuesFile (the one parser), listRunValues, pickRunValues',
  'bin/fwdloop': 'a name in the "folder holds no run yet" list (item 3); reads nothing',
};
test('item 6: only runvalues.js names the signed-values files in code', () => {
  assert.deepEqual(strays(load(), /signed-values|VALUES_FILE_RE|\bvaluesFileName\b/, SIGNED_VALUES), []);
});

test('item 6: a version the run refuses is listed as refused with the parser\'s own words, the same as pickRunValues gives', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-a3-values-'));
  writeFileSync(path.join(dir, 'signed-values.json'), JSON.stringify({ version: 0, flow: 'f', flowSignatureHash: 'x', hash: 'not-the-hash', values: { capUsd: 1, destination: null, askWaits: {} } }));
  const [e] = listRunValues(dir);
  assert.equal(e.ok, false);
  assert.match(e.red, /does not match its own hash/);
  assert.deepEqual(pickRunValues(dir), { ok: false, red: e.red });
});

// item 8: "the draft/start child is alive" is childState (src/panel/spawn.js); pid.json and isFwdloopAlive are named there only
const CHILD_PID = {
  'panel/spawn.js': 'writePidFile, childState / childAlive / childRunning: the one writer and the one owner of "is it alive"',
  'panel/authorstart.js': 'presence only: a start folder holding pid.json had a process started (deadStarts); asks no liveness',
};
test('item 8: only spawn.js names pid.json or asks isFwdloopAlive for a panel child', () => {
  const panel = Object.fromEntries(Object.entries(load()).filter(([f]) => f.startsWith('panel/')));
  assert.deepEqual(strays(panel, /['"`]pid\.json['"`]|\bisFwdloopAlive\b/, CHILD_PID), []);
});

// item 12 (draft verdict): a plan folder's verdict is draftVerdict (src/draftfiles.js, since am3b item 2); spec.hash and scrub-leak.red are named there only (the writers use the constants)
const VERDICT = { 'draftfiles.js': 'SPEC_HASH_FILE / LEAK_MARKER_FILE declared, written by writePlanFiles (authoring.js, through the constants), read by draftVerdict' };
test('item 12 (draft verdict): only draftfiles.js names spec.hash or scrub-leak.red in code', () => {
  assert.deepEqual(strays(load(), /['"`/]spec\.hash\b|['"`/]scrub-leak\.red\b/, VERDICT), []);
});

// item 12 (draft spend row, started-over-from): a draft folder's spend rows are readDirSpendRows and started-over-from.json is readStartedOverFrom, both in src/draftspend.js
const DRAFT_SPEND = { 'draftspend.js': 'DRAFT_SPEND_FILE / STARTED_OVER_FILE: the writer, readDraftSpend, readDirSpendRows, readStartedOverFrom' };
test('item 12 (draft spend, started-over): only draftspend.js names draft-spend.json or started-over-from.json, or reads a draft dir\'s spend rows', () => {
  const files = load();
  assert.deepEqual(strays(files, /['"`/]draft-spend\.json|['"`/]started-over-from\.json|\breadDraftSpend\b/, DRAFT_SPEND), []);
  // the draft folder's own spend.jsonl is read through readDirSpendRows (setup.js, monthly.js, draftspend.js); no other file may read `join(<plan folder>, 'spend.jsonl')` itself for a draft
  assert.deepEqual(strays(files, /readSpendRows\(join\(sessionDir/, {}), []);
});

// item 12 (rerun test): "this run began as a rerun" is readRerunWords (src/runfile.js); the run record's `rerun` is read there only
test('item 12 (rerun): only runfile.js reads the run record\'s rerun', () => {
  assert.deepEqual(strays(load(), /\.rec\.rerun\b|\brec\??\.rerun\b/, { 'runfile.js': 'readRerunWords: the one test; writeRunStart writes it' }), []);
});

// item 12 (ledger, tolerant reads): one tolerant JSONL parse, one ledger reader and appender (src/jsonl-append.js), one tolerant JSON-object read (src/flow.js readJsonFile)
test('item 12 (ledger): only jsonl-append.js parses a JSONL text line by line, reads or appends a trigger ledger', () => {
  const files = load();
  assert.deepEqual(strays(files, /flatMap\(\(l\) => \{ try \{ return \[JSON\.parse\(l\)\]/, { 'jsonl-append.js': 'parseJsonl: the one tolerant JSONL parse' }), []);
  assert.deepEqual(strays(files, /\b(readSeen|readRows|appendSeen|appendOnce)\b/, {}), [], 'the old per-ledger names are gone: readTriggerLedger and appendTriggerLedger are the only ones');
});
test('item 12 (tolerant JSON): only flow.js reads one JSON object file tolerantly (readJsonFile); no local readJson', () => {
  const files = load();
  assert.deepEqual(strays(files, /return j !== null && typeof j === 'object' && !Array\.isArray\(j\) \? j : null/, { 'flow.js': 'readJsonFile: the one tolerant JSON-object read; readDraftLog asks it' }), []);
  assert.deepEqual(strays(files, /\bconst readJson\b|\bfunction readJson\b/, {}), []);
});

// item 12 (frozen input path): where a run keeps the frozen copy of an input (`inputs/<name>`) is INPUTS_DIR and frozenRel (src/runfile.js); no other file spells the folder
test('item 12 (frozen input path): only runfile.js spells the run\'s inputs/ folder in a path', () => {
  assert.deepEqual(strays(load(), /['"`]inputs\/|join\([^)\n]*['"`]inputs['"`]/, { 'runfile.js': 'INPUTS_DIR / frozenRel: the one place the folder is spelled' }), []);
});

// item 12 (draft log names): CARD_RE, LOG_TAIL_CHARS, the revise/redraft log names (draftLogName, DRAFT_LOG_RE) are declared in src/draft-steps.js only
test('item 12 (draft log names): only draft-steps.js declares CARD_RE, LOG_TAIL_CHARS, or spells a revise or redraft log name', () => {
  const files = load();
  const own = { 'draft-steps.js': 'CARD_RE, LOG_TAIL_CHARS, draftLogName, DRAFT_LOG_RE: the one place' };
  assert.deepEqual(strays(files, /(const|let)\s+(CARD_RE|LOG_TAIL_CHARS)\b|card-\(\\d\+\)|(revise|redraft)-\$\{[^}]*\}\.log|\(revise\|redraft\)/, own), []);
});

// item 12 (process started): "has a process started on this run" is processStarted (src/books.js); no other file tests the pid rows' length
test('item 12 (process started): only books.js tests whether a run has a pid row', () => {
  assert.deepEqual(strays(load(), /readPidRows\([^)]*\)\.length/, { 'books.js': 'processStarted: the one test' }), []);
});

// item 12 (asks/<id>.json): an archived ask is parsed by readArchivedAsk (src/ask.js) only; no file reads `asks/<entry>` itself, and src/ask.js does it once
test('item 12 (archived ask): only readArchivedAsk reads asks/<entry>', () => {
  const files = load();
  assert.deepEqual(strays(files, /readFileInside\([^)\n]*join\('asks'/, { 'ask.js': 'readArchivedAsk: the one parse' }), []);
  assert.equal((code(files['ask.js']).match(/readFileInside\([^)\n]*join\('asks'/g) ?? []).length, 1, 'one read of asks/<entry> in src/ask.js');
});

// item 12 (start.json): a start folder's start.json is written by writeStartRecord (src/panel/authorstart.js) only: one writeFileSync of it in the file
test('item 12 (start.json): only authorstart.js writes start.json, once', () => {
  const files = load();
  assert.deepEqual(strays(files, /['"`]start\.json['"`]/, { 'panel/authorstart.js': 'writeStartRecord: the one writer; readStart reads it' }), []);
  assert.equal((code(files['panel/authorstart.js']).match(/writeFileSync\(join\(dir, 'start\.json'\)/g) ?? []).length, 1);
});

// am3c item 1: Not checked has two owners, one per question. notCheckedBlock = the drafter's own list kept word for word with its label (setup.js records it); notCheckedView = what the screen shows (card, Job tab, Audit).
// They stay two functions: one for both changes a screen (68 of 228 files differ on the P1 copy). Every other reader goes through one of them.
const NC_BLOCK = {
  'checked.js': 'notCheckedBlock: the recorded list (the view builds on it)',
  'setup.js': 'the recorded list as the drafter made it, label and items, in the draft\'s setup row',
};
const NC_VIEW = {
  'checked.js': 'notCheckedView: what the screen shows',
  'auditchecks.js': 'the Audit\'s Checks fold',
  'authoring.js': 'the card\'s Not checked rows',
  'panel/author.js': 'the card',
  'panel/data.js': 'the Job tab',
};
test('am3c item 1: notCheckedBlock and notCheckedView stay two functions; only the listed files call each', () => {
  const files = load();
  assert.deepEqual(strays(files, /\bnotCheckedBlock\b/, NC_BLOCK), []);
  assert.deepEqual(strays(files, /\bnotCheckedView\b/, NC_VIEW), []);
  const checked = code(files['checked.js']);
  assert.match(checked, /export function notCheckedBlock\(/);
  assert.match(checked, /export function notCheckedView\(/);
});

// am3c items 2 and 3: target.json. The flow name is readTargetName (src/authoring.js) only; the bytes (hash, rebuilt-plan copy) and the object (sign, rebuild) are their own owners on this list.
const TARGET = {
  'authoring.js': 'the writer; the hash\'s bytes (specHash); readTargetName (the name); the sign\'s object read after the hash check',
  'planrebuild.js': 'a rebuilt plan copies the bytes and reads the object for the plan it rebuilds',
};
test('am3c items 2 and 3: only the listed files name target.json; the flow name is read in readTargetName only', () => {
  const files = load();
  assert.deepEqual(strays(files, /['"`/]target\.json/, TARGET), []);
  assert.deepEqual(strays(files, /target\.json[^\n]*\)\??\.name\b/, { 'authoring.js': 'readTargetName: the one reader of the name' }), []);
  assert.equal((code(files['authoring.js']).match(/readJsonFile\([^)\n]*'target\.json'\)\??\.name/g) ?? []).length, 1, 'one name read in authoring.js');
  assert.deepEqual(strays(files, /JSON\.parse\([^)\n]*target[^)\n]*\)\??\.name/, {}), []);
});

// am3b item 1: a run's saved answer.json is read by readSavedAnswer (src/books.js) only; Resume, answerAsk, reopenAsk and the panel read its fields (askId, broken, ...), none parses the file itself
test('am3b item 1: only books.js reads answer.json (readSavedAnswer); the other files only name it to set it aside, rename it or list it', () => {
  const files = load();
  assert.deepEqual(strays(files, /readFileInside\([^)\n]*['"`]answer\.json['"`]|readFileSync\([^)\n]*answer(Path|\.json)|JSON\.parse\([^)\n]*(saved|answer)[A-Za-z]*\.text/, { 'books.js': 'readSavedAnswer: the one reader' }), []);
  assert.deepEqual(strays(files, /\bfunction readSavedAnswer\b/, { 'books.js': 'the one definition' }), []);
});

// am3d: the signature's `.flow` (this flow's signed hash) is read from signature.json by signedHashOf (src/flow.js) only
test('am3d: only signedHashOf parses signature.json for its .flow', () => {
  assert.deepEqual(strays(load(), /JSON\.parse\([^)\n]*\)\??\.flow\b/, { 'flow.js': 'signedHashOf: the one reader (a string that is not empty, else none)' }), []);
});

// am3 item 10 (first half): a plan folder's not-checked.json is read by readNotCheckedFile (src/draftfiles.js) only; the writers (authoring.js, planrebuild.js) use NOT_CHECKED_FILE
test('item 10: only draftfiles.js names not-checked.json or reads NOT_CHECKED_FILE; the writers use the constant', () => {
  const files = load();
  assert.deepEqual(strays(files, /['"`/]not-checked\.json/, { 'draftfiles.js': 'NOT_CHECKED_FILE declared; readNotCheckedFile: the one reader' }), []);
  assert.deepEqual(strays(files, /readJsonFile\([^)\n]*NOT_CHECKED_FILE/, { 'draftfiles.js': 'readNotCheckedFile' }), []);
});

// am3e item 16: run.json's `placeRules` rows are read by readPlaceRows (src/runfile.js) only; the writer writes the section there too
test('am3e item 16: only runfile.js reads the placeRules section of run.json', () => {
  assert.deepEqual(strays(load(), /rec\.placeRules\b/, { 'runfile.js': 'readPlaceRows' }), []);
});

// am3e item 17: a session folder's card files are named and read by cardFileName / readCard (src/draftfiles.js); draftspend.js asks "is there a readable file" (true for a torn card.json, which the money count needs), a different question
test('am3e item 17: only draftfiles.js spells card.json / card-<n>.json (draftspend.js: the readable-file check for the money count)', () => {
  assert.deepEqual(strays(load(), /['"`]card\.json['"`]|card-\$\{/, {
    'draftfiles.js': 'cardFileName / readCard: the one name and the one read',
    'draftspend.js': 'asks only "is there a readable file" (true for a torn card.json) for the money count',
  }), []);
});

// am3e item 18: redraft-<n>.json is named and read by redraftFileName / readRedraftMarker (src/draftfiles.js) only; `rowEdit` is typed there
test('am3e item 18: only draftfiles.js spells redraft-<n>.json', () => {
  assert.deepEqual(strays(load(), /redraft-\$\{[^}]*\}\.json|redraft-\(\\d/, { 'draftfiles.js': 'redraftFileName / readRedraftMarker: the one name and the one read, rowEdit typed' }), []);
});

// am3e item 19: the picks record's `kept` list is read by readKept (src/pickrecord.js) only; planrebuild.js reads the whole record to carry it over and author.js asks only whether a plan folder holds one
test('am3e item 19: only pickrecord.js reads `kept` from the picks record; the whole-record read and the presence check are on the list', () => {
  const files = load();
  assert.deepEqual(strays(files, /\brecord\??\.kept\b|(readJsonFile|JSON\.parse)\([^)\n]*\)\??\.kept\b/, { 'pickrecord.js': 'readKept: the one reader of the list', 'planrebuild.js': 'the whole record, carried over; it takes the kept keys the rebuild already holds from it' }), []);
  assert.deepEqual(strays(files, /readJsonFile\([^)\n]*(?<![A-Z_])RECORD_FILE/, { 'planrebuild.js': 'the whole record, to carry it over into the rebuilt record' }), []);
  assert.deepEqual(strays(files, /readFileInside\([^)\n]*(?<![A-Z_])RECORD_FILE/, { 'pickrecord.js': 'the readers of the record\'s fields', 'panel/author.js': 'presence only: does a plan folder hold a record (--carry)' }), []);
});

// am3e item 20: a draft plan folder's prose.txt and declaration.json are read by readPlanTexts (src/draftfiles.js) only; flow.js is the signed flow folder's (readFlow and its loaders)
test('am3e item 20: only draftfiles.js reads a draft plan folder\'s prose.txt / declaration.json; flow.js, author.js:stepListOf and data.js are on the list', () => {
  assert.deepEqual(strays(load(), /(readFileInside|readJsonFile)\([^)\n]*(prose\.txt|declaration\.json)/, {
    'draftfiles.js': 'readPlanTexts: the one reader of a draft plan folder',
    'flow.js': 'a signed flow folder and its kept copies: readFlow and the loaders verify them (planForReuse / sameJob compare them)',
    'panel/author.js': 'stepListOf: falls back to declaration.rejected.json, a different question',
    'panel/data.js': 'the Audit tag: reads a signed flow\'s declaration even when its signature fails',
  }), []);
  // inside author.js the allow-list is one site: no second read of the plan folder's files
  assert.equal((code(load()['panel/author.js']).match(/(readFileInside|readJsonFile)\([^)\n]*(prose\.txt|declaration\.json)/g) ?? []).length, 1);
});

// am3e item 15: a run's ask.json is read (found as it is) by readAskFile (src/ask.js) only; readAsk adds withReopen; the presence check in authorstart.js asks only "is there a file"
test('am3e item 15: only ask.js reads ask.json; authorstart.js asks only whether the file is there, runner.js writes it and sets it aside', () => {
  assert.deepEqual(strays(load(), /(readFileInside|readJsonFile)\([^)\n]*['"`]ask\.json['"`]/, {
    'ask.js': 'readAskFile: the one reader',
    'panel/authorstart.js': 'presence only: "is there an ask.json" (parked), true for a torn file too',
  }), []);
});

// am3g item 22: why a run is red is redWhyOf (src/books.js); the Run tab and the Result tab ask it, nobody finds the last red audit row for it again
test('am3g item 22: only books.js picks the last red audit row (isRedTry) for a run\'s red reason', () => {
  assert.deepEqual(strays(load(), /findLast\(\(r\) => isRedTry|\bisRedTry\(r\.verdict\)/, { 'books.js': 'redWhyOf: the one rule', 'learnstore.js': 'a red moment per try (learnings), a different question' }), []);
});

// am3g item 23: a step's newest-try checks are newestChecksOf (src/diary.js): no other file reduces the diary's rows to the highest try
test('am3g item 23: only diary.js picks a step\'s newest-try checks row (the highest try, a tie to the later row)', () => {
  assert.deepEqual(strays(load(), /r\.try >= (m|prev|newest)\.try/, { 'diary.js': 'newestChecksOf: the one rule' }), []);
  assert.deepEqual(strays(load(), /\.filter\(\(d\) => d\.step === \([^)]*\)\)\.at\(-1\)|checkRows\[checkRows\.length - 1\]/, {}), []);
});

// am3g item 24: a run's money NUMBER is runMoney (src/panel/jobgrid.js): the history total, else the priced spend rows as a floor, else unknown. Its words stay two writers:
// "exact $0 is written `$0.0000` on the Runs list and Run tab (data.js) and `$0` on the ticket grid (jobgrid.js moneyWords)": no screen changes.
test('am3g item 24: only jobgrid.js sums a run\'s priced spend rows; the words are written in data.js (costDisplay) and jobgrid.js (moneyWords)', () => {
  const files = load();
  assert.deepEqual(strays(files, /\bspendFloorDisplay\b|filter\(\(r\) => isNum\(r\?\.costUsd\)\)/, { 'panel/jobgrid.js': 'runMoney: the one number rule' }), []);
  assert.deepEqual(strays(files, /export function costDisplay|export function moneyWords/, {
    'panel/data.js': 'costDisplay: exact $0 is written `$0.0000` on the Runs list and Run tab',
    'panel/jobgrid.js': 'moneyWords: exact $0 is written `$0` on the ticket grid',
  }), []);
});
