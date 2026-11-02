// F133 (M14 Done-when POC): throwaway, $0. Real CLI path (bin/fwdloop run/inbox/answer/resume) against a scripted openai-api stand-in on 127.0.0.1.
// usage: node poc/f133-forced/run.mjs forced|good   (writes poc/f133-forced/out/<arm>.json; removes its mkdtemp dir at exit)
import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFlow } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';

const arm = process.argv[2];
if (!['forced', 'good'].includes(arm)) throw new Error('arm: forced|good');
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const base = mkdtempSync(join(tmpdir(), 'f133-'));
const results = [];
const bar = (n, name, pass, detail) => { results.push({ bar: n, name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  bar ${n}: ${name} — ${detail}`); };
const GOOD_TEXT = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft.';
const SCRIPT = arm === 'forced' ? ['length', 'bad', 'good', 'stop'] : [];

// ---- the stand-in: one scripted reply per emit_artifact request, in order; every request body logged
const bodies = []; let n = 0;
const server = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    const body = JSON.parse(data || '{}');
    bodies.push(body);
    const maxTok = body.max_tokens ?? body.max_completion_tokens;
    const tools = (body.tools ?? []).map((t) => t.function?.name ?? t.name);
    let kind = 'stop';
    if (tools.includes('emit_artifact')) {
      // the scripted prefix first (forced arm: cut-off, bad call, good call, stop); every later request: a correct call, or a stop once a tool result is in the thread
      kind = n < SCRIPT.length ? SCRIPT[n] : ((body.messages ?? []).some((m) => m.role === 'tool') ? 'stop' : 'good');
      n++;
    }
    const call = (args) => ({ role: 'assistant', content: null, tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 'emit_artifact', arguments: JSON.stringify(args) } }] });
    let message; let finish = 'stop'; let usage = { prompt_tokens: 1000, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 0 } };
    if (kind === 'length') { message = { role: 'assistant', content: '' }; finish = 'length'; usage = { prompt_tokens: 1000, completion_tokens: maxTok, completion_tokens_details: { reasoning_tokens: 12000 } }; }
    else if (kind === 'bad') { message = call({ text: 42, done: true, blocker: null }); finish = 'tool_calls'; }
    else if (kind === 'good') { message = call({ text: GOOD_TEXT, done: true, blocker: null }); finish = 'tool_calls'; }
    else message = { role: 'assistant', content: 'done' };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'x', model: 'mock-model', choices: [{ index: 0, message, finish_reason: finish }], usage }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
if (port === 8765 || (port >= 4700 && port <= 4809)) throw new Error(`port ${port} is reserved`);

try {
  // ---- config home, own door; flow root, signed fixture (writeFlow, as F132)
  const home = join(base, 'home'); mkdirSync(join(home, '.config', 'fwdloop'), { recursive: true });
  writeFileSync(join(home, '.config', 'fwdloop', 'config.json'), JSON.stringify({
    models: { MOCK_API_KEY: [{ model: 'mock-model', use: true, inPerM: 0.3, outPerM: 1.2 }] },
    providers: { MOCK_API_KEY: { shape: 'openai-api', baseUrl: `http://127.0.0.1:${port}/v1`, legacyMaxTokens: true } },
  }));
  const root = join(base, 'root'); mkdirSync(root);
  const sendDir = join(base, 'send'); mkdirSync(sendDir);
  const srcDir = join(base, 'src'); mkdirSync(srcDir);
  writeFileSync(join(srcDir, 'resume.docx'), 'Resume text goes here.'); writeFileSync(join(srcDir, 'jd.md'), 'JD text goes here.');
  const FIX = join(REPO, 'test', 'fixtures');
  const w = writeFlow({
    root, name: 'job2', proseText: readFileSync(join(FIX, 'job2-with-sources.signed.txt'), 'utf8').replaceAll('file:poc/m0/out', `file:${sendDir}`),
    declaration: JSON.parse(readFileSync(join(FIX, 'job2.m1.declaration.json'), 'utf8')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: loadCatalogue().primitives,
  });
  if (!w.ok) throw new Error(w.reds.join('\n'));

  const env = { ...process.env, HOME: home, MOCK_API_KEY: 'x' };
  delete env.FWDLOOP_CONFIG_HOME;
  const cli = (args) => new Promise((resolve) => {
    const c = spawn('timeout', ['120', 'node', 'bin/fwdloop', ...args], { cwd: REPO, env });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
  const log = {};
  log.run = await cli(['run', 'job2', '--root', root, '--model', 'mock-model', '--source', `resume=${join(srcDir, 'resume.docx')}`, '--source', `jd=${join(srcDir, 'jd.md')}`]);
  log.inbox = await cli(['inbox', '--root', root]);
  const ask = (log.inbox.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) ?? [])[0];
  if (ask) {
    log.answer = await cli(['answer', ask, 'accept', '--root', root]);
    log.resume = await cli(['resume', 'run-1', '--flow', 'job2', '--root', root]);
  }
  console.log(JSON.stringify(Object.fromEntries(Object.entries(log).map(([k, v]) => [k, { code: v.code, out: v.out.slice(0, 400) }])), null, 1));

  // ---- read the record
  const jl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const dir = join(root, 'job2', 'runs', 'run-1');
  const audit = jl(join(dir, 'audit.jsonl')); const spend = jl(join(dir, 'spend.jsonl'));
  const hist = jl(join(root, 'job2', 'history.jsonl')).filter((h) => h.runId === 'run-1');
  const rows = audit.filter((r) => r.kind !== 'decision' && r.step !== undefined);
  const modelRows = audit.filter((r) => 'rounds' in r || 'verdict' in r);
  console.log('audit keys sample', JSON.stringify(audit.map((r) => ({ step: r.step, attempt: r.attempt, verdict: r.verdict, usd: r.usd, gap: r.gap, red: r.red, badCalls: r.badCalls, memo: r.memoText ? r.memoText.length : undefined, keys: Object.keys(r).join(',') })), null, 1).slice(0, 6000));

  const artifactsText = existsSync(join(dir, 'artifacts')) ? readdirSync(join(dir, 'artifacts')).map((f) => readFileSync(join(dir, 'artifacts', f), 'utf8')).join('\n') : '';
  const redOf = (r) => `${r.gap ?? ''} ${r.red ?? ''} ${r.reason ?? ''} ${r.say ?? ''}`;
  const maxTok = bodies.find((b) => (b.tools ?? []).length)?.max_tokens;
  const t1 = audit.find((r) => r.step !== undefined && r.attempt === 1 && (r.verdict !== undefined));
  const cutRow = audit.find((r) => /cut off at the output limit|truncated/.test(JSON.stringify(r)));
  const cutTxt = cutRow ? JSON.stringify(cutRow) : '';
  const b1 = cutRow && cutTxt.includes('cut off at the output limit with no tool call') && cutTxt.includes(`${maxTok} output tokens`) && cutTxt.includes('12000 of them thinking') && cutTxt.includes(`the limit was ${maxTok}`) && !/truncated: \d+ tokens, no tool call/.test(cutTxt);
  bar(1, 'cut-off facts on the audit gap', !!b1, cutRow ? `row step=${cutRow.step} attempt=${cutRow.attempt}: ${JSON.stringify(cutRow).match(/truncated:[^"]*/)?.[0] ?? 'no truncated text'}` : 'no row names a cut-off');
  const badRow = audit.find((r) => Array.isArray(r.badCalls) && r.badCalls.length);
  const b2 = !!badRow && badRow.badCalls.some((b) => b.tool === 'emit_artifact' && b.param === 'text') && !/"text":\s*42|\b42\b/.test(artifactsText) && artifactsText.includes('worked places');
  bar(2, 'badCalls on the audit row; bad tool never ran', b2, badRow ? `row step=${badRow.step} attempt=${badRow.attempt} badCalls=${JSON.stringify(badRow.badCalls)}; artifact has 42: ${/\b42\b/.test(artifactsText)}; artifact has the good text: ${artifactsText.includes('worked places')}` : `no audit row has badCalls (artifact text: ${artifactsText.slice(0, 120)})`);
  const auditUsd = audit.reduce((s, r) => s + (typeof r.usd === 'number' ? r.usd : 0), 0);
  const spendUsd = spend.reduce((s, r) => s + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0);
  const histUsd = hist.length ? hist[hist.length - 1].spentUsd : null;
  const unpriced = audit.filter((r) => r.spendComplete === false).length + spend.filter((r) => r.costUsd == null).length;
  const b3 = histUsd !== null && Math.abs(auditUsd - histUsd) < 1e-9 && Math.abs(spendUsd - histUsd) < 1e-9 && unpriced === 0 && spend.length > 0;
  bar(3, 'books balance', b3, `audit ${auditUsd} / history ${histUsd} / spend ${spendUsd} (${spend.length} rounds, ${audit.length} audit rows, unpriced ${unpriced})`);
  // bar 4: memo per try vs what the server received
  const sent = bodies.map((b) => { const u = [...(b.messages ?? [])].reverse().find((m) => m.role === 'user'); try { return JSON.parse(typeof u?.content === 'string' ? u.content : '{}')?.reads?.fromThisRun ?? JSON.parse(u.content).fromThisRun ?? null; } catch { return null; } });
  const sentSet = new Set(sent.filter((s) => typeof s === 'string'));
  const withMemo = audit.filter((r) => typeof r.memoText === 'string' && r.memoText !== '');
  const b4 = withMemo.length > 0 && withMemo.every((r) => sentSet.has(r.memoText)) && [...sentSet].every((s) => withMemo.some((r) => r.memoText === s));
  bar(4, 'memoText equals what the server received', b4, `rows with memoText ${withMemo.length}; distinct fromThisRun strings received ${sentSet.size}; requests ${bodies.length}; per-request fromThisRun present: ${sent.map((s) => (s ? s.length : '-')).join(',')}`);
  const out = { arm, port, results, requests: bodies.length, sent, audit, spend, hist, log: Object.fromEntries(Object.entries(log).map(([k, v]) => [k, { code: v.code, out: v.out.slice(0, 1500) }])) };
  writeFileSync(join(HERE, 'out', `${arm}.json`), JSON.stringify(out, null, 1));
} finally {
  server.close();
  rmSync(base, { recursive: true, force: true });
}
