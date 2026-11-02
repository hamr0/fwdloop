// F130: the fold line, on a synthetic record (no real run repeats an identical failure text)
import { writeFileSync } from 'node:fs';
import { buildMemo } from './memo.mjs';
const row = (idx, step, verdict, gap) => ({ idx, step, attempt: idx, verdict, gap, model: 'm', wallMs: 1, at: '2026-01-01T00:00:00Z' });
const run = { rows: [row(0, 'a', 'red', 'too long'), row(1, 'a', 'red', 'too long'), row(2, 'a', 'red', 'too long'), row(3, 'b', 'hitl', null), row(4, 'c', 'green', null)], order: ['a', 'b', 'c'], humans: [], parentAnswers: [], missing: [] };
const m = buildMemo(run, 4);
writeFileSync(new URL('./out/fold.json', import.meta.url), JSON.stringify(m, null, 1));
console.log(m.text);
