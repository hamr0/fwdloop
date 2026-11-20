// M19 P6 (F230): the Result fold and the report section on P5's green answers. $0, no AI, no key.
// usage: node poc/m19-p6/run.mjs    (reads bareloop's tests/fixtures/shape-combined/*.answer.json from the tag v0.61.0 with git show; never from a branch)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildShapePart } from '../../src/shaperows.js';
import { shapeResultModel, shapeMarkdown } from '../../src/shaperesult.js';
import { wholeJobText, sendBodyOf, reportContextOf } from '../../src/whole-job.js';

const tag = (f) => execFileSync('git', ['-C', '../bareloop', 'show', `v0.61.0:tests/fixtures/shape-combined/${f}`], { cwd: new URL('../..', import.meta.url).pathname, encoding: 'utf8', maxBuffer: 1 << 26 });
const sha = (t) => createHash('sha256').update(t).digest('hex');
let fails = 0;
const say = (name, ok, detail) => { if (!ok) fails += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`); };

// the expectation, written here and nowhere else: bareloop's rule for a cell's value
const fold = (v) => String(v).replace(/\s+/g, ' ').trim();
const clip = (t, n = 40) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const expectCell = (spec, v) => {
  if (spec.kind === 'text') return { value: clip(fold(v)), bound: `${[...v].length} chars` };
  if (spec.kind === 'list') return { value: clip(v.map(fold).filter((x) => x !== '').join(', ')), bound: `${v.length} ${v.length === 1 ? 'entry' : 'entries'}` };
  if (spec.kind === 'boolean') return { value: v ? 'yes' : 'no', bound: '' };
  return { value: clip(fold(v), 40), bound: '' };
};

const part = buildShapePart({ text: 'the items of line 1', fields: [
  { name: 'quote', spec: { kind: 'text', required: true, maxChars: 5000 }, rule: 1, by: 'you' },
  { name: 'tag', spec: { kind: 'oneOf', required: true, values: ['a', 'b'] }, rule: 2, by: 'you' },
  { name: 'n', spec: { kind: 'number', required: true }, by: 'agent' },
  { name: 'tags', spec: { kind: 'list', required: true, of: { kind: 'text' } }, by: 'agent' },
  { name: 'ok', spec: { kind: 'boolean', required: true }, by: 'agent' },
] });
const rules = ['each quote under 5001 characters', 'the tag is a or b'];

const answers = {};
for (const name of ['dell-1', 'flights-3']) {
  const a = JSON.parse(tag(`${name}.answer.json`));
  a.results.forEach((it, i) => { it.tag = 'a'; it.n = i; it.tags = [`t${i}`, 'x y'.repeat(20)]; it.ok = i % 2 === 0; });
  a.done = true; a.blocker = null;
  answers[name] = a;
}

for (const [name, a] of Object.entries(answers)) {
  const m = shapeResultModel({ part, results: a.results, reds: [], rules });
  // 1 cells
  const bad = [];
  let cells = 0;
  m.rows.forEach((r, i) => part.fields.forEach((f, j) => {
    cells += 1;
    const e = expectCell(f.spec, a.results[i][f.name]);
    const got = r.cells[j].text;
    const want = e.bound && (f.spec.kind === 'list' || f.spec.maxChars !== undefined) ? `${e.value}${e.bound && f.spec.kind !== 'text' ? ` (${e.bound})` : ''}` : e.value;
    // a text field's bound words appear only when bounded (maxChars here), a list's always
    const wantText = f.spec.kind === 'text' ? `${e.value} (${e.bound})` : f.spec.kind === 'list' ? `${e.value} (${e.bound})` : e.value;
    if (got !== wantText) bad.push({ item: i + 1, field: f.name, got, want: wantText, was: want });
  }));
  say(`1 ${name}: every cell is the answer's value as bareloop clips it (${cells} cells)`, bad.length === 0, bad.slice(0, 3));
  // 2 order and count
  const rowsOk = m.rows.length === a.results.length && m.rows.every((r, i) => r.name.startsWith(`${i + 1}`)) && m.columns.map((c) => c.name).join() === part.fields.map((f) => f.name).join() && m.rows.every((r) => r.cells.length === part.fields.length && r.cells.every((c) => c.mark === 'g'));
  say(`2 ${name}: one row per item in the answer's order, columns in the part's order, all marks g`, rowsOk, { rows: m.rows.length, items: a.results.length });
  // 3 markdown
  const md = shapeMarkdown(m);
  const trs = md.split('\n').filter((l) => /^\| \d/.test(l));
  const mdOk = trs.length === a.results.length && !md.includes('✗') && trs.every((l, i) => m.rows[i].cells.every((c) => l.includes(`✓${c.text ? ` ${c.text}` : ''}`.replace(/\|/g, '\\|'))));
  say(`3 ${name}: the markdown table has one row per item, every cell is ✓ plus its text, no ✗`, mdOk, { tableRows: trs.length, hasCross: md.includes('✗') });
}
{
  const a = structuredClone(answers['flights-3']);
  a.results[0].quote = 'one | two\nthree';
  const m = shapeResultModel({ part, results: a.results, reds: [], rules });
  const md = shapeMarkdown(m);
  const row = md.split('\n').find((l) => /^\| 1 /.test(l));
  const cellsOfRow = row.replace(/^\| /, '').replace(/ \|$/, '').split(/(?<!\\) \| /);
  say('3b a value holding "|" and a line break stays in its own cell', cellsOfRow.length === part.fields.length + 1 && cellsOfRow[1].startsWith('✓ one \\| two three'), { cell: cellsOfRow[1], cells: cellsOfRow.length });
}

// 4 the report, C1: a text line, a shape line, a facts line, then an Ask line; fwd's real whole-job path
const steps = (withShape) => [
  { fromLine: 1, goal: 'Write a short note', emits: 's1', close: { class: 'green' } },
  ...(withShape ? [{ fromLine: 2, goal: 'List the items', emits: 's2', close: { class: 'green', itemShape: { fields: part.fields } } }] : []),
  { fromLine: 3, goal: 'Quote the price', emits: 's3', close: { class: 'green', cited: { source: 'page', facts: [{ name: 'price', shape: 'text' }] } } },
  { fromLine: 4, goal: 'Check it with me', emits: 's4', close: { class: 'hitl' } },
];
const artifacts = { s1: { text: 'a short note', done: true, blocker: null }, s2: answers['flights-3'], s3: { results: [{ quote: 'it costs 9', values: { price: '9' } }], done: true, blocker: null } };
const jobLines = [{ n: 1, text: 'Write a short note', guardrail: '' }, { n: 2, text: 'List the items', guardrail: rules.join('; ') }, { n: 3, text: 'Quote the price', guardrail: '' }];
const body = (withShape) => {
  const st = steps(withShape);
  const ctx = reportContextOf({ runDir: '/nonexistent', steps: st, jobLines, checkList: null });
  const askLines = new Map([[4, {}]]);
  const r = wholeJobText({ steps: st, askLines, lastAskIndex: st.length - 1, readResult: (id) => ({ ok: true, value: artifacts[id] }), context: ctx });
  return { r, st, ctx, askLines };
};
const withS = body(true);
const without = body(false);
const text = withS.r.value.text;
const marks = text.split('\n').filter((l) => l.includes('✓'));
say('4a the shape section: heading, Rule lines, shape-checks line, table, Not checked line', /^## 2\. List the items\nRule: each quote under 5001 characters\nRule: the tag is a or b\n\nShape checks \(code checks each item's form, not whether it is true\)\n\n\| item \|/.test(text.slice(text.indexOf('## 2.'))) && text.includes('Not checked: whether each one is true (you judge it at Accept)'), { head: text.slice(text.indexOf('## 2.'), text.indexOf('## 2.') + 160) });
say('4b every line holding a ✓ is a table row of the shape section; no ✗', marks.length > 0 && marks.every((l) => l.startsWith('| ')) && !text.includes('✗'), { marks: marks.length });
const sec = (t, n) => { const i = t.indexOf(`## ${n}. `); if (i < 0) return null; const j = t.indexOf('\n\n## ', i); return t.slice(i, j < 0 ? undefined : j); };
say('4c the text line and the facts line sections are byte-identical to the report with no shape line', sec(text, 1) === sec(without.r.value.text, 1) && sec(text, 3) === sec(without.r.value.text, 3) && sec(text, 1) !== null && sec(text, 3) !== null && !sec(text, 1).includes('✓') && !sec(text, 3).includes('✓'));
// 5 the bound hash
const sent = sendBodyOf({ content: { text }, wholeIdx: 0, steps: withS.st, sendIndex: withS.st.length, askLines: withS.askLines, context: withS.ctx });
const altered = text.replace('✓ t0', '✓ t9');
say('5 sendBodyOf returns the accepted text byte for byte; one changed table value changes the sha256', sent.ok && sent.body === text && sha(text) !== sha(altered) && altered !== text, { sha: sha(text).slice(0, 12), altered: sha(altered).slice(0, 12) });

// 6 recorded only
for (const name of ['dell-1', 'flights-3']) {
  const p = buildShapePart({ text: 'x', fields: [{ name: 'values', spec: { kind: 'object', required: true, fields: {} }, by: 'agent' }] });
  const m = shapeResultModel({ part: p, results: answers[name].results, reds: [], rules: [] });
  console.log(`6 (recorded, no bar) ${name}: an object field's cell text is ${JSON.stringify(m.rows[0].cells[0].text)} for the value ${JSON.stringify(answers[name].results[0].values).slice(0, 60)}`);
}
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
