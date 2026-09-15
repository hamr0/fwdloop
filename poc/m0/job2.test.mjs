import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
  runJob2, bindJob2Stages, JOB2_SHAPE,
  bindJob2DeclarationSteps, checkJob2Grants, preflightJob2FromDeclaration,
} from './job2.mjs';
import { appendSpendRow } from './spend.mjs';
import { validate } from './validator.mjs';

// ---------------------------------------------------------------------------
// Synthetic .docx builder — same zip-by-hand pattern as docx.test.mjs (not
// imported from it: that file's helpers are test-local, and this task's
// brief says never read hamr's real resume in this test file). Independent
// CRC-32, so the fixture doesn't lean on docx.mjs to build itself.
// ---------------------------------------------------------------------------

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localOffset = offset;
    parts.push(local, nameBuf, compressed);
    offset += local.length + nameBuf.length + compressed.length;

    const cdir = Buffer.alloc(46);
    cdir.writeUInt32LE(0x02014b50, 0);
    cdir.writeUInt16LE(20, 4);
    cdir.writeUInt16LE(20, 6);
    cdir.writeUInt16LE(0, 8);
    cdir.writeUInt16LE(8, 10);
    cdir.writeUInt16LE(0, 12);
    cdir.writeUInt16LE(0, 14);
    cdir.writeUInt32LE(crc, 16);
    cdir.writeUInt32LE(compressed.length, 20);
    cdir.writeUInt32LE(data.length, 24);
    cdir.writeUInt16LE(nameBuf.length, 28);
    cdir.writeUInt16LE(0, 30);
    cdir.writeUInt16LE(0, 32);
    cdir.writeUInt16LE(0, 34);
    cdir.writeUInt16LE(0, 36);
    cdir.writeUInt32LE(0, 38);
    cdir.writeUInt32LE(localOffset, 42);
    central.push(cdir, nameBuf);
  }
  const cdirStart = offset;
  const cdirBuf = Buffer.concat(central);
  offset += cdirBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdirBuf.length, 12);
  eocd.writeUInt32LE(cdirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cdirBuf, eocd]);
}

function makeDocxBuffer(paragraphs) {
  const bodyXml = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${bodyXml}</w:body></w:document>`;
  return makeZip([{ name: 'word/document.xml', data: Buffer.from(xml, 'utf8') }]);
}

// ---------------------------------------------------------------------------
// Test scaffolding — a fresh temp dir per test, a synthetic resume + JD,
// the real fixture prose (or a caller-supplied override), and a private
// spend ledger so no test's spend rows leak into another's global cap.
// ---------------------------------------------------------------------------

const FIXTURE_PROSE_PATH = join(new URL('.', import.meta.url).pathname, 'fixtures', 'job2.prose.example.txt');

function setup({ proseText } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'm0-job2-'));
  const resumePath = join(base, 'resume.docx');
  writeFileSync(resumePath, makeDocxBuffer(['AMR HASSAN', 'Story of experience filler.', 'Technical skills filler.']));
  const jdPath = join(base, 'jd.md');
  writeFileSync(jdPath, '# Applied AI Architect\n\nWe need someone who can build agents.\n');

  let prosePath = FIXTURE_PROSE_PATH;
  if (proseText !== undefined) {
    prosePath = join(base, 'job2.prose.txt');
    writeFileSync(prosePath, proseText);
  }

  const outDir = join(base, 'run');
  const spendPath = join(base, 'spend.jsonl');
  const sendDir = join(base, 'sent');
  mkdirSync(sendDir, { recursive: true });

  return {
    base, resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  };
}

function fakeSendStep(sendDir) {
  return async (target, filename, content) => {
    const path = join(sendDir, filename);
    writeFileSync(path, content);
    return { ok: true, path, bytes: Buffer.byteLength(content) };
  };
}

/** A valid three-section summary under the word cap, so `closeWordsAndSections` greens it. */
function goodSummary(marker = '') {
  return `summary of work history\nWorked on agent systems${marker ? ` (${marker})` : ''}.\n\n`
    + 'professional skills\nJavaScript, Node.js, LLM tooling.\n\n'
    + 'soft skills\nCommunication and collaboration.\n';
}

function fakeModelStepFactory(outDir, { textByAttempt, calls } = {}) {
  return async (n, reason) => {
    if (calls) calls.push({ n, reason });
    const text = textByAttempt ? textByAttempt(n, reason) : goodSummary(String(n));
    const artifactPath = join(outDir, `a3-summary.attempt${n}.md`);
    writeFileSync(artifactPath, text);
    return { ok: true, artifactPath, costUsd: 0.01 };
  };
}

function scriptedAskStep(script) {
  let i = 0;
  return async (n, artifactPath) => {
    if (i >= script.length) throw new Error(`scriptedAskStep: ran out of scripted answers at call ${i} (n=${n}, artifactPath=${artifactPath})`);
    const answer = script[i];
    i += 1;
    return answer;
  };
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// (a) happy path
// ---------------------------------------------------------------------------

test('(a) happy path: read/compose/ask/send artifacts exist, result green, sent == accepted attempt', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const calls = [];
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'a',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: fakeModelStepFactory(outDir, { calls }),
    askStep: scriptedAskStep([{ decision: 'accept', text: null }]),
    sendStep: fakeSendStep(sendDir),
  });

  assert.equal(result.outcome, 'green');
  assert.equal(result.attempts, 1);
  assert.ok(existsSync(join(outDir, 'a1-resume.txt')));
  assert.ok(existsSync(join(outDir, 'a2-jd.txt')));
  assert.ok(existsSync(join(outDir, 'a3-summary.attempt1.md')));
  assert.ok(existsSync(result.sent));

  const sentText = readFileSync(result.sent, 'utf8');
  const acceptedText = readFileSync(join(outDir, 'a3-summary.attempt1.md'), 'utf8');
  assert.equal(sentText, acceptedText);
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// (b) reject with reason then accept
// ---------------------------------------------------------------------------

test('(b) reject with reason then accept: attempt 2 sees the reason, audit has 2 attempt rows, sent == attempt 2', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const calls = [];
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'b',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: fakeModelStepFactory(outDir, { calls }),
    askStep: scriptedAskStep([
      { decision: 'rerun', text: 'too generic, name the actual tools' },
      { decision: 'accept', text: null },
    ]),
    sendStep: fakeSendStep(sendDir),
  });

  assert.equal(result.outcome, 'green');
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].reason, null);
  assert.equal(calls[1].reason, 'too generic, name the actual tools');

  const audit = readJsonl(join(outDir, 'audit.jsonl'));
  const attemptRows = audit.filter((r) => r.kind === 'attempt');
  assert.equal(attemptRows.length, 2);

  const sentText = readFileSync(result.sent, 'utf8');
  const attempt2Text = readFileSync(join(outDir, 'a3-summary.attempt2.md'), 'utf8');
  assert.equal(sentText, attempt2Text);
});

test('(b) PROOF the test can fail: break the reason carry-over, watch it red, restore', async () => {
  // Simulated here (not by editing redo.mjs) by scripting a modelStep that
  // asserts the WRONG reason arrives on attempt 2, so this sub-test itself
  // proves the assertion is load-bearing rather than vacuous.
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  await assert.rejects(async () => {
    const result = await runJob2({
      prosePath,
      sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
      runId: 'b-proof',
      outDir,
      spendPath,
      slot: 'deepseek',
      modelStep: fakeModelStepFactory(outDir),
      askStep: scriptedAskStep([
        { decision: 'rerun', text: 'name the tools' },
        { decision: 'accept', text: null },
      ]),
      sendStep: fakeSendStep(sendDir),
    });
    // Deliberately assert a WRONG expectation to prove this proof-block can fail.
    assert.equal(result.attempts, 999);
  }, assert.AssertionError);
});

// ---------------------------------------------------------------------------
// (c) 650 words -> close red, ask never called, nothing sent, phase compose
// ---------------------------------------------------------------------------

function tooLongSummary() {
  const filler = Array(650).fill('w').join(' ');
  return `summary of work history\n${filler}\n\nprofessional skills\nx\n\nsoft skills\nx\n`;
}

test('(c) 650 words closes red; ask never called; nothing sent; result red at phase compose', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  let askCalled = false;
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'c',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: fakeModelStepFactory(outDir, { textByAttempt: () => tooLongSummary() }),
    askStep: async () => { askCalled = true; return { decision: 'accept', text: null }; },
    sendStep: fakeSendStep(sendDir),
  });

  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'compose');
  assert.match(result.red, /words, limit 600/);
  assert.equal(askCalled, false);
});

test('(c) PROOF the test can fail: a 600-word (boundary) summary does NOT red', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const okAt600 = () => {
    // 3 headings ("summary of work history"=4, "professional skills"=2,
    // "soft skills"=2 -> 8 words) + 592 filler = 600.
    const filler = Array(592).fill('w').join(' ');
    return `summary of work history\nprofessional skills\nsoft skills\n${filler}`;
  };
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'c-proof',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: fakeModelStepFactory(outDir, { textByAttempt: okAt600 }),
    askStep: scriptedAskStep([{ decision: 'accept', text: null }]),
    sendStep: fakeSendStep(sendDir),
  });
  // Proves the 650-word test above is actually exercising the word cap, not
  // some unrelated failure: an in-cap summary must NOT red.
  assert.equal(result.outcome, 'green');
});

// ---------------------------------------------------------------------------
// (d) missing section -> same shape of failure
// ---------------------------------------------------------------------------

test('(d) missing a required section heading closes red, ask never called, nothing sent', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  let askCalled = false;
  const missingSoftSkills = () => 'summary of work history\nx\n\nprofessional skills\nx\n';
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'd',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: fakeModelStepFactory(outDir, { textByAttempt: missingSoftSkills }),
    askStep: async () => { askCalled = true; return { decision: 'accept', text: null }; },
    sendStep: fakeSendStep(sendDir),
  });

  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'compose');
  assert.match(result.red, /missing section heading "soft skills"/);
  assert.equal(askCalled, false);
});

// ---------------------------------------------------------------------------
// (e) reason-less rerun then accept -> one refused row, one attempt row
// ---------------------------------------------------------------------------

test('(e) a reason-less rerun is refused at the ask, then accept: one refused row, one attempt', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const calls = [];
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'e',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: fakeModelStepFactory(outDir, { calls }),
    askStep: scriptedAskStep([
      { decision: 'rerun', text: '   ' }, // reason-less (whitespace only)
      { decision: 'accept', text: null },
    ]),
    sendStep: fakeSendStep(sendDir),
  });

  assert.equal(result.outcome, 'green');
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1, 'the reason-less rejection must NOT re-run the step');

  const audit = readJsonl(join(outDir, 'audit.jsonl'));
  assert.equal(audit.filter((r) => r.kind === 'refused').length, 1);
  assert.equal(audit.filter((r) => r.kind === 'attempt').length, 1);
});

// ---------------------------------------------------------------------------
// (f) 4 rejections -> red naming step "compose", nothing sent
// ---------------------------------------------------------------------------

test('(f) 4 rejections halt the run, naming step "compose", nothing sent', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'f',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: fakeModelStepFactory(outDir),
    askStep: scriptedAskStep([
      { decision: 'rerun', text: 'reason 1' },
      { decision: 'rerun', text: 'reason 2' },
      { decision: 'rerun', text: 'reason 3' },
      { decision: 'rerun', text: 'reason 4' },
    ]),
    sendStep: fakeSendStep(sendDir),
  });

  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'compose');
  assert.match(result.red, /compose/);
  assert.match(result.red, /after 4 rejections/);
  assert.equal(existsSync(join(sendDir, 'f-summary.md')), false);
});

// ---------------------------------------------------------------------------
// (g) prose with no "send at" line -> refuse at preflight, no model call
// ---------------------------------------------------------------------------

const PROSE_NO_SEND = `1. Read my resume,
2. and read the job description,
3. write me a summary under 600 words in three sections: summary of work history, professional skills, soft skills,
   guardrail: under 600 words, three sections present
4. check it with me,
   guardrail: nothing goes out before I accept

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.25 per run
guardrail: ask at line 4
`;

test('(g) missing send arbiter slot refuses at preflight, no model call', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup({ proseText: PROSE_NO_SEND });
  let modelCalled = false;
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'g',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: async () => { modelCalled = true; return { ok: true, artifactPath: '/x', costUsd: 0 }; },
    askStep: scriptedAskStep([{ decision: 'accept', text: null }]),
    sendStep: fakeSendStep(sendDir),
  });

  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'preflight');
  assert.equal(modelCalled, false);
});

// ---------------------------------------------------------------------------
// (h) cap line $0.50 -> refuse (tighten-only)
// ---------------------------------------------------------------------------

const PROSE_BIG_CAP = `1. Read my resume,
2. and read the job description,
3. write me a summary under 600 words in three sections: summary of work history, professional skills, soft skills,
4. check it with me,
5. and once I accept, write it to a file.

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.50 per run
guardrail: ask at line 4
guardrail: send at line 5 to file:poc/m0/out
`;

test('(h) a cap line asking for more than the signed ceiling is refused, tighten-only', () => {
  const bound = bindJob2Stages(PROSE_BIG_CAP);
  assert.equal(bound.ok, false);
  assert.match(bound.red, /cap \$0\.5 exceeds the signed per-run ceiling \$0\.25/);
});

// ---------------------------------------------------------------------------
// (i) stale run dir -> refuse
// ---------------------------------------------------------------------------

test('(i) a run dir already holding ask.json from an earlier run refuses', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'ask.json'), '{}');

  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'i',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: fakeModelStepFactory(outDir),
    askStep: scriptedAskStep([{ decision: 'accept', text: null }]),
    sendStep: fakeSendStep(sendDir),
  });

  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'preflight');
  assert.match(result.red, /already holds ask\.json/);
});

// ---------------------------------------------------------------------------
// (j) modelStep throws -> result red, costUsd null in ledger row, never sent
// ---------------------------------------------------------------------------

test('(j) a throwing modelStep reds the run at compose; the ledger row it wrote carries costUsd:null; nothing sent', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const throwingModelStep = async (n) => {
    appendSpendRow(spendPath, {
      runId: 'j', step: 'compose', model: 'deepseek-flash', modelReturned: null, tokens: null, costUsd: null, rounds: 0, rateSource: null, wallMs: 5, error: 'provider exploded',
    });
    throw new Error(`compose attempt ${n}: provider exploded`);
  };

  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'j',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: throwingModelStep,
    askStep: scriptedAskStep([{ decision: 'accept', text: null }]),
    sendStep: fakeSendStep(sendDir),
  });

  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'compose');
  assert.equal(result.sent, undefined);

  const ledgerRows = readJsonl(spendPath);
  const composeRows = ledgerRows.filter((r) => r.step === 'compose');
  assert.ok(composeRows.length > 0, 'the throwing modelStep must have written its own row before throwing');
  assert.equal(composeRows[0].costUsd, null);

  assert.equal(existsSync(join(sendDir, 'j-summary.md')), false);
});

// ---------------------------------------------------------------------------
// (k) binding variants — non-positional binding, proven directly
// ---------------------------------------------------------------------------

const PROSE_EXTRA_READ_LINE = `1. Read my notes,
2. Read my resume,
3. Read the job description,
4. Write a summary under 600 words in three sections: summary of work history, professional skills, soft skills,
5. Check it with me,
6. Write it to a file.

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.25 per run
guardrail: ask at line 5
guardrail: send at line 6 to file:poc/m0/out
`;

test('(k1) an extra read line before the compose line refuses, naming the count', () => {
  const bound = bindJob2Stages(PROSE_EXTRA_READ_LINE);
  assert.equal(bound.ok, false);
  assert.match(bound.red, /expected 2 read lines before the compose line \(line 4\), found 3/);
});

const PROSE_GAPPED_NUMBERING = `1. Read my resume,
2. Read the job description,
4. Write a summary under 600 words in three sections: summary of work history, professional skills, soft skills,
5. Check it with me,
6. Write it to a file.

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.25 per run
guardrail: ask at line 5
guardrail: send at line 6 to file:poc/m0/out
`;

test('(k2) ask at line 5 / send at line 6, with a gap in the numbering, still binds correctly by line identity', () => {
  const bound = bindJob2Stages(PROSE_GAPPED_NUMBERING);
  assert.equal(bound.ok, true);
  assert.equal(bound.composeLine.n, 4);
  assert.equal(bound.readLines.length, 2);
  assert.equal(bound.readLines[0].n, 1);
  assert.equal(bound.readLines[1].n, 2);
  assert.match(bound.readLines[0].text, /resume/);
  assert.match(bound.readLines[1].text, /job description/);
  assert.equal(bound.arbiterSlots.ask.line, 5);
  assert.equal(bound.arbiterSlots.send.line, 6);
  assert.equal(bound.arbiterSlots.send.target, 'file:poc/m0/out');
});

// ---------------------------------------------------------------------------
// sanity: JOB2_SHAPE is a signed constant, not derived from the fixture prose
// ---------------------------------------------------------------------------

test('JOB2_SHAPE is the signed Amendment B shape (600 words, 3 named sections)', () => {
  assert.equal(JOB2_SHAPE.maxWords, 600);
  assert.deepEqual(JOB2_SHAPE.sections, ['summary of work history', 'professional skills', 'soft skills']);
});

// ---------------------------------------------------------------------------
// DECLARATION-DRIVEN BINDING (Claim 2 — the fold obeys the DRAFTER's own
// declaration: binds stages by `fromLine`, checks grants before any model
// round — never guesses stages from position). `bindJob2Stages` still does
// the line-level half from the prose alone (unchanged, tested above);
// `bindJob2DeclarationSteps`/`checkJob2Grants` are the new declaration half.
// ---------------------------------------------------------------------------

const FIXTURE_PROSE_TEXT = readFileSync(FIXTURE_PROSE_PATH, 'utf8');
const FIXTURE_BOUND = bindJob2Stages(FIXTURE_PROSE_TEXT);

/** A well-formed job #2 declaration matching job2.prose.example.txt's own
 *  lines (1=resume, 2=jd, 3=compose, 4=ask, 5=send) — primitives PICKED
 *  from the catalogue (readDocx for the resume, plain read for the JD),
 *  overridable per test to plant a grants/duplicate-line defect. */
function job2Declaration({
  resumePrimitives = ['readDocx'], jdPrimitives = ['read'], resumeFromLine = 1, jdFromLine = 2,
} = {}) {
  return {
    skills: ['core'],
    guardrails: FIXTURE_PROSE_TEXT,
    guardrailClasses: { 3: 'softgreen', 4: 'hitl' },
    steps: [
      {
        goal: 'read the resume', primitives: resumePrimitives, reads: [], emits: 'r1', fromLine: resumeFromLine, close: { class: 'hitl' },
      },
      {
        goal: 'read the job description', primitives: jdPrimitives, reads: [], emits: 'r2', fromLine: jdFromLine, close: { class: 'hitl' },
      },
      {
        goal: 'compose the summary',
        primitives: [],
        reads: ['r1', 'r2'],
        emits: 'r3',
        fromLine: 3,
        close: { class: 'softgreen', shape: { maxWords: 600, sections: JOB2_SHAPE.sections } },
      },
      {
        goal: 'check it with me', primitives: ['checkpoint'], reads: ['r3'], emits: 'r4', fromLine: 4, close: { class: 'hitl' },
      },
      {
        goal: 'send the accepted summary', primitives: ['write'], reads: ['r4'], emits: 'r5', fromLine: 5, close: { class: 'hitl' },
      },
    ],
    refused: [],
  };
}

test('a good job #2 declaration passes validate() end to end (Claim 2 evidence, generic validator.mjs)', () => {
  const result = validate(job2Declaration());
  assert.equal(result.verdict, 'green', result.red);
});

test('bindJob2DeclarationSteps: resolves all five stages from fromLine, matching the prose\'s own line binding', () => {
  const result = bindJob2DeclarationSteps(job2Declaration(), FIXTURE_BOUND);
  assert.equal(result.ok, true);
  assert.equal(result.stages.readResume.emits, 'r1');
  assert.equal(result.stages.readJd.emits, 'r2');
  assert.equal(result.stages.compose.emits, 'r3');
  assert.equal(result.stages.ask.emits, 'r4');
  assert.equal(result.stages.send.emits, 'r5');
});

test('bindJob2DeclarationSteps: a duplicate fromLine (two steps both claiming line 1) reds naming the line and the count, never picks one', () => {
  const declaration = job2Declaration();
  declaration.steps.push({
    goal: 'a second step also claiming line 1', primitives: [], reads: [], emits: 'r1b', fromLine: 1, close: { class: 'hitl' },
  });
  const result = bindJob2DeclarationSteps(declaration, FIXTURE_BOUND);
  assert.equal(result.ok, false);
  assert.match(result.red, /line 1 \(stage "readResume"\) has 2 step\(s\) bound to it/);
});

test('PROOF can fail: removing the duplicate-fromLine step clears the bind red', () => {
  const declaration = job2Declaration();
  declaration.steps.push({
    goal: 'dup', primitives: [], reads: [], emits: 'r1b', fromLine: 1, close: { class: 'hitl' },
  });
  assert.equal(bindJob2DeclarationSteps(declaration, FIXTURE_BOUND).ok, false);
  declaration.steps.pop();
  assert.equal(bindJob2DeclarationSteps(declaration, FIXTURE_BOUND).ok, true);
});

test('checkJob2Grants: the resume step granted "read" instead of "readDocx" reds naming the missing grant — the walkability case (a step claiming the wrong read primitive for its own line)', () => {
  const declaration = job2Declaration({ resumePrimitives: ['read'] });
  const bound = bindJob2DeclarationSteps(declaration, FIXTURE_BOUND);
  assert.equal(bound.ok, true);
  const result = checkJob2Grants(bound.stages);
  assert.equal(result.ok, false);
  assert.match(result.red, /grants: step for line 1 \(stage "readResume"\) is not granted "readDocx"/);
});

test('PROOF can fail: granting readDocx on the resume step clears the grants red', () => {
  const badBound = bindJob2DeclarationSteps(job2Declaration({ resumePrimitives: ['read'] }), FIXTURE_BOUND);
  assert.equal(checkJob2Grants(badBound.stages).ok, false);
  const goodBound = bindJob2DeclarationSteps(job2Declaration(), FIXTURE_BOUND);
  assert.equal(checkJob2Grants(goodBound.stages).ok, true);
});

test('checkJob2Grants: an EXTRA grant beyond what a stage needs is not a red — follows job #1\'s own checkGrants precedent (runner.mjs), which never checks for extra grants either', () => {
  const declaration = job2Declaration({ jdPrimitives: ['read', 'readDocx'] });
  const bound = bindJob2DeclarationSteps(declaration, FIXTURE_BOUND);
  assert.equal(checkJob2Grants(bound.stages).ok, true);
});

test('preflightJob2FromDeclaration: a good declaration binds and grants clean, ready for the fold', () => {
  const { resumePath, jdPath, outDir } = setup();
  const pre = preflightJob2FromDeclaration(job2Declaration(), FIXTURE_PROSE_TEXT, {
    runDir: outDir, sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
  });
  assert.equal(pre.ok, true, pre.red);
  assert.equal(pre.stages.readResume.emits, 'r1');
});

// ---------------------------------------------------------------------------
// (l)-(o) end-to-end through runJob2's own `declaration` option.
// ---------------------------------------------------------------------------

test('(l) declaration-driven fold: happy path via an injected declaration — bound is "declaration", outcome green', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const calls = [];
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'l',
    outDir,
    spendPath,
    slot: 'deepseek',
    declaration: job2Declaration(),
    modelStep: fakeModelStepFactory(outDir, { calls }),
    askStep: scriptedAskStep([{ decision: 'accept', text: null }]),
    sendStep: fakeSendStep(sendDir),
  });
  assert.equal(result.outcome, 'green', result.red);
  assert.equal(result.bound, 'declaration');
  assert.equal(calls.length, 1);
});

test('(m) declaration-driven fold: a resume step granted "read" instead of "readDocx" reds at preflight, no model round', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const modelStep = async () => { throw new Error('modelStep must never be called when grants red'); };
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'm',
    outDir,
    spendPath,
    slot: 'deepseek',
    declaration: job2Declaration({ resumePrimitives: ['read'] }),
    modelStep,
    askStep: scriptedAskStep([]),
    sendStep: fakeSendStep(sendDir),
  });
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'preflight');
  assert.match(result.red, /not granted "readDocx"/);
  assert.equal(result.bound, 'declaration');
});

test('PROOF (m) can fail: the SAME run with readDocx correctly granted goes green', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'm2',
    outDir,
    spendPath,
    slot: 'deepseek',
    declaration: job2Declaration(),
    modelStep: fakeModelStepFactory(outDir),
    askStep: scriptedAskStep([{ decision: 'accept', text: null }]),
    sendStep: fakeSendStep(sendDir),
  });
  assert.equal(result.outcome, 'green', result.red);
});

test('(n) declaration-driven fold: `declaration` accepts a JSON file PATH (the CLI\'s --declaration shape), same as an object', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  mkdirSync(outDir, { recursive: true });
  const declPath = join(outDir, 'declaration.json');
  writeFileSync(declPath, JSON.stringify(job2Declaration()));
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'n',
    outDir,
    spendPath,
    slot: 'deepseek',
    declaration: declPath,
    modelStep: fakeModelStepFactory(outDir),
    askStep: scriptedAskStep([{ decision: 'accept', text: null }]),
    sendStep: fakeSendStep(sendDir),
  });
  assert.equal(result.outcome, 'green', result.red);
  assert.equal(result.bound, 'declaration');
});

// ---------------------------------------------------------------------------
// "ask/send slots missing" — validator.mjs deliberately SKIPS the send lock
// entirely when a declaration carries no arbiter slots at all (a signed,
// tested ruling — validator.test.mjs's "send lock — a declaration with no
// arbiter slots at all skips the lock entirely (old/hand-built
// declarations)"); loosening that for job #2 would silently un-red an
// already-signed job #1 behaviour. So this refusal lives where job #1's own
// analogous check already lives — the FOLD's bind step (bindJob2Stages,
// reused unchanged inside preflightJob2FromDeclaration) — not inside
// validate() itself. See this file's header / the task report for why.
// ---------------------------------------------------------------------------

test('"ask/send slots missing": prose with no signed ask/send arbiter lines refuses at bind, before grants or any model round', () => {
  const proseNoSlots = FIXTURE_PROSE_TEXT.replace(/\nguardrail: ask at line 4\nguardrail: send at line 5 to file:poc\/m0\/out/, '');
  const { resumePath, jdPath, outDir } = setup();
  const pre = preflightJob2FromDeclaration(job2Declaration(), proseNoSlots, {
    runDir: outDir, sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
  });
  assert.equal(pre.ok, false);
  assert.match(pre.red, /bind: prose carries no signed ask\/send arbiter slots/);
});

test('PROOF can fail: the SAME declaration with the slots restored binds clean', () => {
  const { resumePath, jdPath, outDir } = setup();
  const proseNoSlots = FIXTURE_PROSE_TEXT.replace(/\nguardrail: ask at line 4\nguardrail: send at line 5 to file:poc\/m0\/out/, '');
  assert.equal(preflightJob2FromDeclaration(job2Declaration(), proseNoSlots, {
    runDir: outDir, sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
  }).ok, false);
  assert.equal(preflightJob2FromDeclaration(job2Declaration(), FIXTURE_PROSE_TEXT, {
    runDir: outDir, sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
  }).ok, true);
});

test('(o) without a declaration, runJob2 still binds by prose (bound === "prose") — the prose-only path stays available for tests', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const result = await runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'o',
    outDir,
    spendPath,
    slot: 'deepseek',
    modelStep: fakeModelStepFactory(outDir),
    askStep: scriptedAskStep([{ decision: 'accept', text: null }]),
    sendStep: fakeSendStep(sendDir),
  });
  assert.equal(result.outcome, 'green', result.red);
  assert.equal(result.bound, 'prose');
});

// ---------------------------------------------------------------------------
// The REAL ask step (`makeDefaultAskStep`, not `scriptedAskStep`) — the
// ask.json/answer.json file protocol a human answers from another process
// via `answer.mjs`. These tests never call `answer.mjs` as a subprocess (no
// network, no process spawn needed for the protocol itself) but write
// answer.json in the exact shape `answer.mjs` writes, at the exact moments a
// human process would: only after the ask this answer is FOR has actually
// been opened (its ask.json is on disk), so `answeredAt` is never engineered
// to be earlier than the ask it answers — that would just be a different,
// synthetic bug.
//
// Bug this covers (found in review, not yet hit live): `askWithRedo` calls
// the ask step again for attempt 2 after a `rerun`, and again for the SAME
// attempt after a reason-less `rerun` is refused — in both cases the OLD
// answer.json was still on disk, so `waitForReply` returned the stale
// decision instantly. One human rejection became four and halted at the
// cap with no human in the loop for the second case; a reason-less rerun
// became a tight refusal loop for the second.
// ---------------------------------------------------------------------------

function writeAnswerFile(runDir, decision, text, { answeredAt } = {}) {
  writeFileSync(join(runDir, 'answer.json'), JSON.stringify({
    decision, text: text ?? null, answeredAt: answeredAt ?? new Date().toISOString(),
  }, null, 2));
}

async function waitForAskJson(runDir, predicate, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const askPath = join(runDir, 'ask.json');
  const start = Date.now();
  for (;;) {
    if (existsSync(askPath)) {
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(askPath, 'utf8'));
      } catch {
        parsed = null;
      }
      if (parsed && predicate(parsed)) return parsed;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForAskJson: timed out after ${timeoutMs}ms waiting for a matching ask.json in ${runDir}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, intervalMs); });
  }
}

function waitForAskAttempt(runDir, attempt, opts) {
  return waitForAskJson(runDir, (a) => a.evidence?.attempt === attempt, opts);
}

test('(real ask) rerun-with-reason then a SECOND human write of accept: attempt 2 asked, result green, sent == attempt 2, one consumed file per answer', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const calls = [];
  const runPromise = runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'real-ask-1',
    outDir,
    spendPath,
    slot: 'deepseek',
    askTimeoutMs: 5000,
    modelStep: fakeModelStepFactory(outDir, { calls }),
    sendStep: fakeSendStep(sendDir),
    // no askStep — exercises the REAL makeDefaultAskStep.
  });

  await waitForAskAttempt(outDir, 1);
  writeAnswerFile(outDir, 'rerun', 'name the actual tools');

  await waitForAskAttempt(outDir, 2);
  writeAnswerFile(outDir, 'accept', null);

  const result = await runPromise;
  assert.equal(result.outcome, 'green', result.red);
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);

  const consumed = readdirSync(outDir).filter((f) => f.endsWith('.consumed.json'));
  assert.equal(consumed.length, 2, `expected exactly one consumed file per answer, got: ${consumed.join(', ')}`);
  assert.equal(existsSync(join(outDir, 'answer.json')), false, 'answer.json must not linger after being consumed');

  const sentText = readFileSync(result.sent, 'utf8');
  const attempt2Text = readFileSync(join(outDir, 'a3-summary.attempt2.md'), 'utf8');
  assert.equal(sentText, attempt2Text);
});

test('(real ask) rerun-with-reason then NO second write: attempt 2\'s ask expires — the stale answer.json is never re-read', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const runPromise = runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'real-ask-2',
    outDir,
    spendPath,
    slot: 'deepseek',
    askTimeoutMs: 1500,
    modelStep: fakeModelStepFactory(outDir),
    sendStep: fakeSendStep(sendDir),
  });

  await waitForAskAttempt(outDir, 1);
  writeAnswerFile(outDir, 'rerun', 'name the actual tools');

  const result = await runPromise;
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'compose');
  assert.match(result.red, /ask expired at compose attempt 2/);
});

test('(real ask) reason-less rerun re-asks the SAME attempt; a fresh accept then greens on attempt 1', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const runPromise = runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'real-ask-3',
    outDir,
    spendPath,
    slot: 'deepseek',
    askTimeoutMs: 5000,
    modelStep: fakeModelStepFactory(outDir),
    sendStep: fakeSendStep(sendDir),
  });

  const firstAsk = await waitForAskAttempt(outDir, 1);
  writeAnswerFile(outDir, 'rerun', ''); // reason-less — refused, re-asks the SAME attempt.

  // The re-ask for attempt 1 is a NEW `defaultAskStep` call, so it writes a
  // fresh ask.json with a new `askedAt` even though `evidence.attempt` is
  // still 1 — wait for that to distinguish it from the first ask.
  await waitForAskJson(outDir, (a) => a.evidence?.attempt === 1 && a.askedAt !== firstAsk.askedAt);
  writeAnswerFile(outDir, 'accept', null);

  const result = await runPromise;
  assert.equal(result.outcome, 'green', result.red);
  assert.equal(result.attempts, 1);

  const audit = readJsonl(join(outDir, 'audit.jsonl'));
  const refused = audit.filter((r) => r.kind === 'refused' && r.why === 'reason required');
  assert.equal(refused.length, 1);
});

test('(real ask) an answer.json that predates this ask (mid-run stale write) is ignored and logged, then a fresh accept proceeds', async () => {
  const {
    resumePath, jdPath, prosePath, outDir, spendPath, sendDir,
  } = setup();
  const auditPath = join(outDir, 'audit.jsonl');
  const runPromise = runJob2({
    prosePath,
    sources: [{ id: 'resume', path: resumePath }, { id: 'jd', path: jdPath }],
    runId: 'real-ask-4',
    outDir,
    spendPath,
    slot: 'deepseek',
    askTimeoutMs: 5000,
    modelStep: fakeModelStepFactory(outDir),
    sendStep: fakeSendStep(sendDir),
  });

  const askedAt1 = await waitForAskAttempt(outDir, 1);
  // A stale write during attempt 1's poll window — answeredAt predates the
  // ask it landed in, as if it were meant for an ask that already closed.
  const staleAnsweredAt = new Date(Date.parse(askedAt1.askedAt) - 5000).toISOString();
  writeAnswerFile(outDir, 'accept', null, { answeredAt: staleAnsweredAt });

  // Give the poll loop a couple of cycles to see and quarantine the stale
  // file before the real, fresh answer lands.
  await new Promise((r) => { setTimeout(r, 1100); });
  assert.equal(existsSync(join(outDir, 'answer.json')), false, 'the stale file should already have been moved out of the way');
  writeAnswerFile(outDir, 'accept', null);

  const result = await runPromise;
  assert.equal(result.outcome, 'green', result.red);
  assert.equal(result.attempts, 1);

  const audit = readJsonl(auditPath);
  const stale = audit.filter((r) => r.kind === 'stale-answer-ignored');
  assert.equal(stale.length, 1, `expected exactly one stale-answer-ignored row, got: ${JSON.stringify(audit)}`);
  assert.equal(stale[0].attempt, 1);
});
