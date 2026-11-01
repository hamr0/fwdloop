// F126 ($0, no model, no network, no pass): M13 am5 — does "Inputs filled" in the New-card readiness block only what the signed text says?
// Pre-registered in docs/logs/FINDINGS.md (commit e742348). Run: timeout 300 node poc/mcp/f126/f126.mjs   (repo root). Exit 0 = every item passed.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../../../scripts/tmp-track.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const home = mkdtempSync(path.join(tmpdir(), 'f126-home-'));
const cfg = mkdtempSync(path.join(tmpdir(), 'f126-cfg-'));
const root = mkdtempSync(path.join(tmpdir(), 'f126-root-'));
process.env.HOME = home;
const { cardFields, checkCard } = await import(path.join(REPO, 'src/panel/authorcard.js'));
const { appendMcpCheck } = await import(path.join(REPO, 'src/mcp-checks.js'));
const { fnSrc } = await import(path.join(REPO, 'scripts/panel-fixtures/fn-src.mjs'));

writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: '/nonexistent/never-started' } } }));
appendMcpCheck(cfg, { server: 'github', path: '~/.mcp.json', at: '2026-10-31T10:00:00Z', ok: true, tools: [{ name: 'issue_read', hint: 'read-only' }] });
const file = path.join(root, 'in.md'); writeFileSync(file, 'x\n');
const TICKET = 'issues: https://github.com/flutter/flutter/issues';

const PAGE = readFileSync(path.join(REPO, 'src/panel/index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));
const results = [];
const say = (id, pass, line) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${line}`); };

const FLOWS = ['plain', 'mcp', 'tickets'];
const INPUTS = { empty: '', blank: '  \n ', file: `resume: ${file}`, ticket: TICKET };
const cells = [];
for (const flow of FLOWS) for (const [iname, inputs] of Object.entries(INPUTS)) {
  if (iname === 'ticket' && flow !== 'tickets') continue;
  if (iname === 'file' && flow === 'tickets') { cells.push({ flow, iname, inputs }); continue; }
  cells.push({ flow, iname, inputs });
}

// server verdict: the draft door's own check
const server = (c) => {
  const card = cardFields({ flowName: 'tick', job: 'Read the ticket\nWrite it out', inputs: c.inputs, destination: '', capUsd: '5', askWait: '1h', provider: 'x', model: 'y', ...(c.flow === 'plain' ? {} : { flowType: c.flow, mcp: 'github' }) });
  const r = checkCard(card, { root, home: cfg, keys: [] });
  return { ok: r.ok, fields: r.ok ? [] : r.refusals.map((x) => x.field) };
};

// page verdict today: the real startReady + currentCard
const pageToday = (c) => {
  const els = {
    'jf-name': { value: 'tick' }, 'jf-cap-money': { value: '5' },
  };
  const src = `${fnSrc(CHAT, 'currentCard', '    ')}\n${fnSrc(CHAT, 'startReady', '    ')}`;
  const make = new Function('byId', 'jobEl', 'destEl', 'inputsBox', 'askWaitEl', 'modelPick', 'thinkingEl', 'thinkingNone', 'flowTypeEl', 'mcpEl', 'scheduleOfCard', 'reuseOf', 'moneyRed', 'mode', `${src}\nreturn startReady;`);
  const startReady = make((id) => els[id], { value: 'Read the ticket\nWrite it out' }, { value: '' }, { value: c.inputs }, { value: '1h' },
    () => ({ provider: 'x', model: 'y' }), { checked: false }, false, { value: c.flow }, { value: 'github' }, () => null, null, false, 'new');
  return startReady();
};
// the candidate: today's rule AND (MCP, or the Inputs text trimmed is not empty)
const candidate = (c) => pageToday(c) && (c.flow === 'mcp' || c.inputs.trim() !== '');

const rows = cells.map((c) => ({ ...c, name: `${c.flow}/${c.iname}`, srv: server(c), today: pageToday(c), cand: candidate(c) }));
for (const r of rows) console.log(`INFO ${r.name}: server ${r.srv.ok ? 'accepts' : `refuses ${r.srv.fields}`}; page today ${r.today}; candidate ${r.cand}`);
const get = (n) => rows.find((r) => r.name === n);

// (1) server
const s1 = rows.filter((r) => r.iname === 'file' && r.flow !== 'tickets').every((r) => r.srv.ok)
  && get('tickets/ticket').srv.ok
  && ['plain/empty', 'plain/blank', 'mcp/empty', 'mcp/blank'].every((n) => get(n).srv.ok)
  && ['tickets/empty', 'tickets/blank'].every((n) => !get(n).srv.ok && get(n).srv.fields.includes('inputs'));
say('1', s1, 'server: file/ticket cells pass; plain and MCP with empty/blank Inputs pass; Tickets with empty/blank refused on inputs');
// (2) baseline
say('2', rows.every((r) => r.today === true), 'page today: startReady true on every cell (never reads Inputs)');
// (3) candidate vs server
const diff = rows.filter((r) => r.cand !== r.srv.ok).map((r) => r.name).sort();
const blocked = rows.filter((r) => r.srv.ok && !r.cand).map((r) => r.name).sort();
const looser = rows.filter((r) => r.cand && !r.srv.ok).map((r) => r.name);
say('3', JSON.stringify(blocked) === JSON.stringify(['plain/blank', 'plain/empty']) && looser.length === 0, `server-accepted but candidate blocks: ${blocked.join(', ')}; candidate ready but server refuses: ${looser.join(', ') || 'none'}`);
// (4) MCP
say('4', get('mcp/empty').cand && get('mcp/blank').cand, 'candidate: MCP ready with empty and blank Inputs');
// (5) the differing cells
say('5', JSON.stringify(diff) === JSON.stringify(['plain/blank', 'plain/empty']), `cells where candidate and server differ: ${diff.join(', ')}`);

for (const d of [home, cfg, root]) rmSync(d, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(failed.length === 0 ? 'ALL PASS' : `FAIL: ${failed.map((r) => r.id).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
