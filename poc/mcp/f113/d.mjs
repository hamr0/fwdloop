// F113 (d): damage a temp copy, count again, compare with the clean count. Never touches the real tree.
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, truncateSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { count } from './f113.mjs';

const safe = (p) => { try { return readdirSync(p); } catch { return []; } };
const src = join(homedir(), '.config', 'fwdloop', 'flows');
const tmp = mkdtempSync(join(tmpdir(), 'f113-'));
try {
  // copy only run.json + diary.jsonl of each run
  for (const f of readdirSync(src)) for (const r of safe(join(src, f, 'runs')).filter((x) => x.startsWith('run-'))) {
    for (const n of ['run.json', 'diary.jsonl']) { try { cpSync(join(src, f, 'runs', r, n), join(tmp, f, 'runs', r, n)); } catch {} }
  }
  const clean = count(tmp);
  const ticket = join(tmp, 'ticket-triage', 'runs');
  const runs = readdirSync(ticket).filter((x) => x.startsWith('run-')).sort();
  const withMcp = runs.filter((r) => JSON.parse(readFileSync(join(ticket, r, 'run.json'), 'utf8')).inputs?.some((i) => i.mcp));
  const [a, b, c] = withMcp;
  const size = readFileSync(join(ticket, a, 'run.json')).length;
  truncateSync(join(ticket, a, 'run.json'), Math.floor(size / 2)); // truncated mid-way
  writeFileSync(join(ticket, b, 'run.json'), '');                  // empty
  writeFileSync(join(ticket, c, 'run.json'), '[1,2,3]');           // valid JSON, wrong shape
  // torn last line in one diary that has tool rows
  let torn = null;
  outer: for (const f of readdirSync(tmp)) for (const r of safe(join(tmp, f, 'runs'))) {
    try { const t = readFileSync(join(tmp, f, 'runs', r, 'diary.jsonl'), 'utf8'); if (t.includes('"kind":"tool"')) { writeFileSync(join(tmp, f, 'runs', r, 'diary.jsonl'), t + '{"kind":"tool","tool":"re'); torn = `${f}/${r}`; break outer; } } catch {}
  }
  const dmg = count(tmp);
  const key = (x) => `${x.server}/${x.tool}`;
  const cm = new Map(clean.out.map((x) => [key(x), x.calls])); const dm = new Map(dmg.out.map((x) => [key(x), x.calls]));
  console.log(JSON.stringify({ completed: true, cleanRuns: clean.runDirs, dmgRuns: dmg.runDirs, skippedClean: clean.skipped, skippedDmg: dmg.skipped,
    cleanGithubIssueRead: cm.get('github/issue_read'), dmgGithubIssueRead: dm.get('github/issue_read'), changedKeys: [...cm].filter(([k, v]) => dm.get(k) !== v).map(([k]) => k), torn: !!torn }));
  console.log('damage removed rows:', JSON.stringify([...cm].filter(([k, v]) => dm.get(k) !== v).map(([k, v]) => [k, v, dm.get(k)])));
} finally { rmSync(tmp, { recursive: true, force: true }); }
