// M9 piece 3a (docs/wiki/the-module-ladder.md, "M9" item 1, 2, am1): the trigger is typed data in the signed arbiter block.
// $0, no network. Written red-first against a tree with no `trigger` field and no src/trigger-line.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSignedText, ARBITER_FIELDS } from '../src/signed-text.js';
import {
  triggerLine, proseWithTrigger, stripTrigger, triggerHash,
} from '../src/trigger-line.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROSE = readFileSync(path.join(HERE, 'fixtures', 'job2-with-sources.signed.txt'), 'utf8');
const parse = (extra) => parseSignedText(`${PROSE.trimEnd()}\n${extra}\n`);

test('trigger is an arbiter field, and a job with no trigger line is By hand (null)', () => {
  assert.ok(ARBITER_FIELDS.includes('trigger'));
  const r = parseSignedText(PROSE);
  assert.equal(r.ok, true);
  assert.equal(r.arbiter.trigger, null);
});

test('every kind parses to its typed object and prints back to the same line (round trip)', () => {
  const cases = [
    ['guardrail: trigger daily 09:00', { kind: 'daily', hour: 9, minute: 0 }],
    ['guardrail: trigger weekdays 17:30', { kind: 'weekdays', hour: 17, minute: 30 }],
    ['guardrail: trigger weekly mon 09:05', { kind: 'weekly', day: 'mon', hour: 9, minute: 5 }],
    ['guardrail: trigger file-updated resume = file:/tmp/some dir/r.md', { kind: 'file-updated', role: 'resume', path: '/tmp/some dir/r.md' }],
    ['guardrail: trigger new-file jd = file:/tmp/inbox', { kind: 'new-file', role: 'jd', folder: '/tmp/inbox' }],
  ];
  for (const [line, want] of cases) {
    const r = parse(line);
    assert.equal(r.ok, true, JSON.stringify(r.reds));
    assert.deepEqual(r.arbiter.trigger, want);
    assert.equal(triggerLine(want), line);
  }
});

test('refusals name the field: bad time, bad day, undeclared role, empty path, a second trigger, cron text', () => {
  const bad = [
    'guardrail: trigger daily 25:00', 'guardrail: trigger daily 9:00', 'guardrail: trigger weekly someday 09:00',
    'guardrail: trigger file-updated nope = file:/tmp/x', 'guardrail: trigger new-file jd = file:', 'guardrail: trigger * * * * *', 'guardrail: trigger',
  ];
  for (const line of bad) {
    const r = parse(line);
    assert.equal(r.ok, false, line);
    assert.match(r.reds.join(' '), /trigger/, line);
  }
  assert.equal(parseSignedText(`${PROSE.trimEnd()}\nguardrail: trigger daily 09:00\nguardrail: trigger daily 10:00\n`).ok, false);
});

test('proseWithTrigger adds, replaces and removes the line; null gives back the original text, so an old job hash cannot move', () => {
  const t1 = { kind: 'daily', hour: 9, minute: 0 };
  const t2 = { kind: 'weekdays', hour: 8, minute: 15 };
  const a = proseWithTrigger(PROSE, t1);
  assert.equal(parseSignedText(a).arbiter.trigger.kind, 'daily');
  const b = proseWithTrigger(a, t2);
  assert.deepEqual(parseSignedText(b).arbiter.trigger, t2);
  assert.equal(b.split('\n').filter((l) => /trigger/.test(l)).length, 1);
  assert.equal(proseWithTrigger(b, null).trimEnd(), PROSE.trimEnd());
  assert.equal(stripTrigger(b).trimEnd(), PROSE.trimEnd());
  assert.equal(proseWithTrigger(PROSE, null), PROSE, 'no trigger in, no trigger out: byte-identical');
});

test('the hash binds the flow, its signature and the trigger: any one changed changes it', () => {
  const t = { kind: 'daily', hour: 9, minute: 0 };
  const h = triggerHash({ flow: 'a', flowSignatureHash: 'x', trigger: t });
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, triggerHash({ flow: 'b', flowSignatureHash: 'x', trigger: t }));
  assert.notEqual(h, triggerHash({ flow: 'a', flowSignatureHash: 'y', trigger: t }));
  assert.notEqual(h, triggerHash({ flow: 'a', flowSignatureHash: 'x', trigger: { ...t, minute: 1 } }));
  assert.notEqual(h, triggerHash({ flow: 'a', flowSignatureHash: 'x', trigger: null }));
});
