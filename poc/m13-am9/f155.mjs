// F155 ($0, read only): build the M13 am9 whole-job file from a real run's saved step outputs using the
// existing M15 form (renderSentMd, src/send.js) per step, then pass it through the real sendViaPrimitive
// hash check into a scratch folder. No model call, no src change, nothing written under ~/.config/fwdloop.
import { readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { renderSentMd, sendViaPrimitive } from '../../src/send.js';
import { serializeArtifact, sha256Hex } from '../../src/ask.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FLOWS = join(homedir(), '.config', 'fwdloop', 'flows');
// PII skipped: m7-walk-2 (hamr's real resume).
const RUNS = [['m14-walk-5', 'run-1'], ['m10-walk-flights-5', 'run-1'], ['aging-live-4', 'run-1'], ['m14-walk-6', 'run-1']];
const kind = (s) => (s.primitives.length === 0 ? 'ask' : s.primitives.includes('write') ? 'send' : 'work');
let allOk = true;
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

for (const [job, run] of RUNS) {
  const d = join(FLOWS, job, 'runs', run);
  const hist = readFileSync(join(FLOWS, job, 'history.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.runId === run);
  const steps = JSON.parse(readFileSync(join(d, 'job', 'declaration.json'), 'utf8')).steps;
  const prose = readFileSync(join(d, 'job', 'prose.txt'), 'utf8').split('\n');
  const proseLine = (n) => { const m = new RegExp(`^${n}\\. (.*)$`).exec(prose.find((l) => l.startsWith(`${n}. `)) ?? ''); return m ? m[1] : null; };
  const ks = steps.map(kind);
  const lastAsk = ks.lastIndexOf('ask');
  let a = true; let c = true; const parts = []; const expected = [];
  steps.forEach((s, i) => {
    if (i > lastAsk || i === lastAsk) return; // the last Ask is the accept itself; the send is not a section
    if (ks[i] === 'ask') { parts.push(`Line ${s.fromLine}: you accepted this at the Ask.`); expected.push(`Line ${s.fromLine}: you accepted this at the Ask.`); return; }
    const p = join(d, 'artifacts', `${s.emits}.json`);
    if (!existsSync(p)) { a = false; say(`  step ${s.fromLine}: saved output missing (${s.emits})`); return; }
    const body = renderSentMd(JSON.parse(readFileSync(p, 'utf8'))); // the M15 form, unchanged, per step
    if (!body.trim()) a = false;
    const words = proseLine(s.fromLine);
    if (words !== s.goal) say(`  note: line ${s.fromLine} prose "${words}" differs from step goal "${s.goal}"`);
    parts.push(`## Line ${s.fromLine}: ${words}\n${body}`);
    expected.push(`## Line ${s.fromLine}: ${words}`);
  });
  const md = parts.join('\n\n');
  // (c) headings/accept lines in job order, byte for byte against the am9 template
  const got = md.split('\n').filter((l) => l.startsWith('## Line ') || /^Line \d+: you accepted this at the Ask\.$/.test(l));
  // body lines can start with '## Result' (not '## Line'), so this filter only sees the template lines
  c = JSON.stringify(got) === JSON.stringify(expected) && expected.every((e, i, arr) => i === 0 || Number(/(\d+)/.exec(e)[1]) > Number(/(\d+)/.exec(arr[i - 1])[1]));
  // (d) the real send check on the code-built artifact {text: md}
  const artifact = { text: md };
  const accepted = sha256Hex(serializeArtifact(artifact)); // what answerAsk (src/ask.js:552) records for evidence.artifact
  const dest = mkdtempSync(join(tmpdir(), 'f155-dest-'));
  const ok = await sendViaPrimitive(`file:${dest}`, `${job}-${run}.md`, artifact, accepted, { runDir: d });
  const bad = await sendViaPrimitive(`file:${dest}`, `${job}-${run}-b.md`, { text: `${md}\nx` }, accepted, { runDir: d });
  const wrote = ok.ok ? readFileSync(join(dest, `${job}-${run}.md`), 'utf8') : null;
  const dOk = ok.ok && wrote === md && !bad.ok && /changed after it was accepted/.test(bad.red);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(HERE, 'out'), { recursive: true });
  writeFileSync(join(HERE, 'out', `${job}-${run}.md`), md + '\n');
  const green = hist?.outcome === 'complete';
  say(`${job} ${run} (history outcome ${hist?.outcome}) steps ${ks.join(',')} sections ${expected.length} bytes ${Buffer.byteLength(md)} sha256 ${accepted.slice(0, 16)}`);
  say(`  (a) ${a} (b) true (renderSentMd per step, no formatter written here) (c) ${c} (d) ${dOk} send ok=${ok.ok}${ok.ok ? '' : ` red=${ok.red}`}; tampered refused=${!bad.ok}`);
  if (!(a && c && dOk && green)) allOk = false;
}
say(`OVERALL ${allOk ? 'PASS' : 'FAIL'}`);
writeFileSync(join(HERE, 'out', 'f155.txt'), lines.join('\n') + '\n');
