// F103 look: newest-first cursor walk over list_issues until a seen number. $0, NO model calls.
// Usage: node poc/mcp/f103/look.mjs [--repo owner/repo] [--ledger path] [--per 10] [--tag name]
// Only github tool called: list_issues (issue_read not needed: number + created_at come with the list).
import { createMCPBridge } from 'bare-agent/mcp';
import { homedir } from 'node:os';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const parse = (r) => { const t = typeof r === 'string' ? r : (r.content || []).map((c) => c.text ?? '').join(''); try { return JSON.parse(t); } catch { return { _text: String(t).slice(0, 200) }; } };

export async function look({ repo = 'flutter/flutter', ledger = join(here, 'out/ledger.jsonl'), per = 10, tag = '' } = {}) {
  const t0 = Date.now(); const [owner, name] = repo.split('/');
  mkdirSync(dirname(ledger), { recursive: true });
  const rows = existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const seen = new Set(rows.map((r) => r.number)); const first = rows.length === 0;
  const out = { tag, repo, at: new Date().toISOString(), first, seenBefore: seen.size, pages: 0, calls: 0, retried: 0, newOldestFirst: [], unreadable: null };
  let b;
  try {
    b = await createMCPBridge({ configPaths: [homedir() + '/.mcp.json'], timeout: 90000, callTimeout: 90000, confirmServer: () => true, allow: { github: ['list_issues'] } });
    const li = b.tools.find((t) => t.name === 'github_list_issues');
    const found = []; let after; let stopped = false;
    while (!stopped) {
      const args = { owner, repo: name, state: 'OPEN', orderBy: 'CREATED_AT', direction: 'DESC', perPage: per, fields: ['number', 'created_at', 'state'] };
      if (after) args.after = after;
      let r; out.calls++;
      try { r = parse(await li.execute(args)); } catch (e) { r = { _text: 'throw: ' + String(e?.message).slice(0, 200) }; }
      if (!Array.isArray(r.issues)) { out.retried++; out.calls++; try { r = parse(await li.execute(args)); } catch (e) { r = { _text: 'throw: ' + String(e?.message).slice(0, 200) }; } }
      if (!Array.isArray(r.issues)) { out.unreadable = r._text ?? 'no issues list'; break; }
      out.pages++;
      for (const i of r.issues) {
        if (first) { found.push(i); continue; }
        if (seen.has(i.number)) { stopped = true; break; }
        found.push(i);
      }
      if (first) break; // look 1: the first page is the starting point
      if (!r.pageInfo?.hasNextPage) { stopped = true; out.endOfList = true; }
      after = r.pageInfo?.endCursor;
      if (!after) stopped = true;
      if (out.pages > 200) { out.unreadable = 'page cap 200'; break; }
    }
    if (!out.unreadable) {
      const ordered = found.slice().reverse(); // oldest first
      for (const i of ordered) appendFileSync(ledger, JSON.stringify({ number: i.number, created_at: i.created_at, kind: first ? 'baseline' : 'arrived', at: out.at, tag }) + '\n');
      out.newOldestFirst = first ? [] : ordered.map((i) => i.number);
      if (first) out.baselineNumbers = ordered.map((i) => i.number);
    }
  } catch (e) { out.unreadable = 'bridge: ' + String(e?.message).slice(0, 200); }
  finally { try { await b?.close(); } catch {} }
  out.ms = Date.now() - t0;
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const g = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const o = await look({ repo: g('--repo'), ledger: g('--ledger'), per: Number(g('--per', 10)), tag: g('--tag', '') });
  console.log(JSON.stringify(o)); process.exit(0);
}
