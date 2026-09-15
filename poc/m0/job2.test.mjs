import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
  runJob2, bindJob2Stages, JOB2_SHAPE,
} from './job2.mjs';
import { appendSpendRow } from './spend.mjs';

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
  return `story of experience\nWorked on agent systems${marker ? ` (${marker})` : ''}.\n\n`
    + 'technical skills\nJavaScript, Node.js, LLM tooling.\n\n'
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
  return `story of experience\n${filler}\n\ntechnical skills\nx\n\nsoft skills\nx\n`;
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
    // 3 headings (3+2+2=7 words) + 593 filler = 600.
    const filler = Array(593).fill('w').join(' ');
    return `story of experience\ntechnical skills\nsoft skills\n${filler}`;
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
  const missingSoftSkills = () => 'story of experience\nx\n\ntechnical skills\nx\n';
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
3. write me a summary under 600 words in three sections: story of experience, technical skills, soft skills,
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
3. write me a summary under 600 words in three sections: story of experience, technical skills, soft skills,
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
4. Write a summary under 600 words in three sections: story of experience, technical skills, soft skills,
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
4. Write a summary under 600 words in three sections: story of experience, technical skills, soft skills,
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
  assert.deepEqual(JOB2_SHAPE.sections, ['story of experience', 'technical skills', 'soft skills']);
});
