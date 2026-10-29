// F104 watch: watched-field change (state, labels) over a fixed set of issues. $0, NO model calls.
// Usage: node poc/mcp/f104/watch.mjs [--repo owner/repo] [--ledger path] [--n 30] [--tag name]
// Only github tool called: list_issues (issue_read not needed: state/labels/updated_at/title/comments come with the list).
import { createMCPBridge } from 'bare-agent/mcp';
import { homedir } from 'node:os';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const parse = (r) => { const t = typeof r === 'string' ? r : (r.content || []).map((c) => c.text ?? '').join(''); try { return JSON.parse(t); } catch { return { _text: String(t).slice(0, 200) }; } };
const labelsOf = (i) => (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).sort();

// watched fields only: state and labels
export function reasonFor(prev, cur) {
  const r = [];
  if (prev.state !== cur.state) r.push(`state ${prev.state}→${cur.state}`);
  for (const l of cur.labels) if (!prev.labels.includes(l)) r.push(`label added: ${l}`);
  for (const l of prev.labels) if (!cur.labels.includes(l)) r.push(`label removed: ${l}`);
  return r.join('; ');
}

export async function watch({ repo = 'microsoft/vscode', ledger = join(here, 'out/ledger.jsonl'), n = 30, tag = '' } = {}) {
  const t0 = Date.now(); const [owner, name] = repo.split('/');
  mkdirSync(dirname(ledger), { recursive: true });
  const rows = existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const first = rows.length === 0;
  const last = new Map(); for (const r of rows) last.set(r.number, r); // last row per number = last-seen watched values
  const out = { tag, repo, at: new Date().toISOString(), first, tracked: first ? n : last.size, calls: 0, retried: 0, pages: 0, arrived: [], baselineNumbers: [], missing: [], unreadable: null };
  let b;
  try {
    b = await createMCPBridge({ configPaths: [homedir() + '/.mcp.json'], timeout: 90000, callTimeout: 90000, confirmServer: () => true, allow: { github: ['list_issues'] } });
    out.exposed = b.tools.map((t) => t.name);
    const li = b.tools.find((t) => t.name === 'github_list_issues');
    const got = new Map(); let after; let done = false;
    const need = first ? null : new Set(last.keys());
    while (!done) {
      const args = { owner, repo: name, orderBy: 'CREATED_AT', direction: 'DESC', perPage: first ? n : 100, fields: ['number', 'state', 'labels', 'updated_at', 'title', 'comments'] };
      if (after) args.after = after;
      let r; out.calls++;
      try { r = parse(await li.execute(args)); } catch (e) { r = { _text: 'throw: ' + String(e?.message).slice(0, 200) }; }
      if (!Array.isArray(r.issues)) { out.retried++; out.calls++; try { r = parse(await li.execute(args)); } catch (e) { r = { _text: 'throw: ' + String(e?.message).slice(0, 200) }; } }
      if (!Array.isArray(r.issues)) { out.unreadable = r._text ?? 'no issues list'; break; }
      out.pages++;
      for (const i of r.issues) { if (first && got.size >= n) break; got.set(i.number, i); }
      if (first) break;
      if ([...need].every((k) => got.has(k))) break;
      if (!r.pageInfo?.hasNextPage || !r.pageInfo?.endCursor) break;
      after = r.pageInfo.endCursor;
      if (out.pages > 20) { out.unreadable = 'page cap 20'; break; }
    }
    if (!out.unreadable) {
      const rec = (i, kind, extra) => ({ number: i.number, kind, state: i.state, labels: labelsOf(i), updated_at: i.updated_at, title: i.title, comments: i.comments ?? 0, at: out.at, tag, ...extra });
      if (first) {
        for (const i of [...got.values()].sort((a, b) => a.number - b.number)) { appendFileSync(ledger, JSON.stringify(rec(i, 'baseline')) + '\n'); out.baselineNumbers.push(i.number); }
      } else {
        for (const num of [...last.keys()].sort((a, b) => a - b)) {
          const i = got.get(num);
          if (!i) { out.missing.push(num); continue; } // not found again: not "unchanged", recorded
          const reason = reasonFor(last.get(num), { state: i.state, labels: labelsOf(i) });
          if (!reason) continue;
          appendFileSync(ledger, JSON.stringify(rec(i, 'arrived', { reason })) + '\n');
          out.arrived.push({ number: num, reason });
        }
      }
    }
  } catch (e) { out.unreadable = 'bridge: ' + String(e?.message).slice(0, 200); }
  finally { try { await b?.close(); } catch {} }
  out.ms = Date.now() - t0;
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const g = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const o = await watch({ repo: g('--repo'), ledger: g('--ledger'), n: Number(g('--n', 30)), tag: g('--tag', '') });
  console.log(JSON.stringify(o)); process.exit(0);
}
