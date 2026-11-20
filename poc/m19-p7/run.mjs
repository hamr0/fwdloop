// M19 P7 (F229): the one check-list look loses no row. $0, no AI, no key.
// usage: node poc/m19-p7/run.mjs write <out.json> [flows-root]     one record per signed folder: readout, Audit rows, card rows, each with the page's own HTML
//        node poc/m19-p7/run.mjs compare <before.json> [flows-root]  runs the same surfaces now and judges them against the pre-registered bars (F229)
// The flows root is a read-only COPY (.claude/scratch/v061/p7/flows); nothing is ever written into it. The page's functions are cut out of src/panel/index.html by name and run in node with no DOM.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { flowDirs } from '../../test/m19-block-snapshot.mjs';
import { parseSignedText } from '../../src/signed-text.js';
import { csvRolesOf } from '../../src/sheetblock.js';
import { buildReadout } from '../../src/authoring.js';
import { auditChecksOf } from '../../src/auditchecks.js';
import { checkedLines, notCheckedView } from '../../src/checked.js';
import { cardLinesOf } from '../../src/checklistsign.js';
import { EVERY_STEP_TEXTS } from '../../src/try-checks.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '../..');
const DEFAULT_ROOT = path.join(REPO, '.claude/scratch/v061/p7/flows');
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

// ---- the page's own functions, by name, from index.html (the first definition at its indent: one-liners end on their line, others on a `}` at the same indent) ----
const HTML = readFileSync(path.join(REPO, 'src/panel/index.html'), 'utf8').split('\n');
function fnSource(name) {
  const i = HTML.findIndex((l) => new RegExp(`^\\s*function ${name}\\(`).test(l));
  if (i < 0) return null;
  const indent = HTML[i].match(/^\s*/)[0];
  if (HTML[i].trimEnd().endsWith('}') && !HTML[i].trimEnd().endsWith('{')) return HTML[i];
  let j = i + 1;
  while (j < HTML.length && HTML[j] !== `${indent}}`) j++;
  return HTML.slice(i, j + 1).join('\n');
}
const NAMES = ['escapeXml', 'glyphClass', 'stateDotHTML', 'tagWordOf', 'byTagOf', 'ckTagHtml', 'ckRowHtml', 'ckGroupHtml', 'planCheckRowHtml', 'planFoldHtml', 'planViewHtml', 'sheetBlockLines', 'planOfState', 'actionRowHtml', 'planControlHTML', 'auditCheckRowHtml', 'resultNotChecked'];
const used = NAMES.filter((n) => fnSource(n) !== null);
const ctx = vm.createContext({ console, RESULT_NONE: 'none' });
vm.runInContext(used.map(fnSource).join('\n'), ctx);
const page = (n) => (used.includes(n) ? ctx[n] : null);
const strip = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ---- one signed folder's surfaces ----
function surfaces(dir) {
  const pf = ['signed/prose.txt', 'prose.txt'].map((f) => path.join(dir, f)).find((f) => existsSync(f));
  const df = ['signed/declaration.json', 'declaration.json'].map((f) => path.join(dir, f)).find((f) => existsSync(f));
  const declaration = readJson(df);
  const parsed = parseSignedText(readFileSync(pf, 'utf8'));
  if (!declaration || !parsed.ok) return { skipped: 'unreadable' };
  const ncFile = ['signature.json', 'signed/signature.json'].map((f) => readJson(path.join(dir, f))).find((s) => isRec(s?.notChecked)) ?? null;
  const nc = ncFile?.notChecked ?? readJson(path.join(dir, 'not-checked.json')) ?? null;
  const items = Array.isArray(nc?.notChecked) ? nc.notChecked : Array.isArray(nc?.items) ? nc.items : [];
  const by = isRec(nc?.by) ? nc.by : {};
  const out = {};
  const t = (f) => { try { return f(); } catch (e) { return { threw: String(e?.message ?? e).slice(0, 160) }; } };
  out.readout = t(() => buildReadout({ declaration, arbiter: parsed.arbiter, lines: parsed.lines, name: 'job', modelId: 'm', costUsd: 0, rounds: 1, spendComplete: true, root: '/r' }).split('\n'));
  const ac = t(() => auditChecksOf(declaration, [], { items, by }, { lines: parsed.lines, csvRoles: csvRolesOf(parsed.arbiter) }));
  out.audit = ac && !ac.threw ? { ...ac, html: Object.fromEntries(['checks', 'notChecked', 'always'].map((k) => [k, (ac[k] ?? []).map((r) => (page('auditCheckRowHtml') ? page('auditCheckRowHtml')(r) : null)).map((h) => (h === null ? null : strip(h)))])) } : ac;
  // the card: only a plan whose draft kept a checkCard (as the panel's planChecks reads it), through the page's planOfState and planViewHtml
  const log = readJson(path.join(dir, 'log.json'));
  if (log?.checkCard && cardLinesOf(declaration).size > 0 && page('planOfState')) {
    out.card = t(() => {
      const askLines = parsed.arbiter.asks.map((x) => x.line);
      const view = notCheckedView(nc?.notChecked, declaration);
      const state = {
        phase: 'green', checked: checkedLines(declaration, { askLines, lines: parsed.lines, csvRoles: csvRolesOf(parsed.arbiter) }),
        notChecked: { ...view, ...(isRec(nc?.by) ? { by: nc.by } : {}) },
        list: { lines: [...cardLinesOf(declaration)], rows: log.checkCard.rows, suggested: log.checkCard.suggested },
        planLines: parsed.lines.map((l) => ({ n: l.n, text: l.text, rules: l.guardrail ? l.guardrail.split('; ') : [] })), always: [...EVERY_STEP_TEXTS],
      };
      const plan = page('planOfState')(state, state.list);
      const act = log.action;
      const action = isRec(act) && Number.isInteger(act.line) && act.dropped !== true ? { line: act.line, ...(act.by === 'agent' || act.by === 'you' ? { by: act.by } : {}) } : null;
      return { plan, html: strip(page('planViewHtml')(plan, page('planControlHTML'))), htmlRaw: page('planViewHtml')(plan, page('planControlHTML')), actionHtml: action && page('actionRowHtml') ? strip(page('actionRowHtml')(action)) : null, hasAction: action !== null };
    });
  }
  return out;
}

export function snapshot(root) {
  const out = {};
  for (const d of flowDirs(root)) out[path.relative(root, d) || '.'] = surfaces(d);
  return out;
}

// ---- the bars ----
/** the section 3.7 words, taken out of a row before words are compared */
const WORDS37 = [/^(?:›\s*)?check\s*·\s*/, /^(?:›\s*)?not checked\s*·\s*/, /\s*·\s*(?:machine check|judge)$/, /^\[(?:you|agent|default)\]\s*/, /^[~!$]\s*\[(?:you|agent|default)\]\s*/, /\s*[~!$]?\s*\[(?:you|agent|default)\]$/];
const clean = (s) => { let x = String(s).replace(/\s+/g, ' ').trim(); for (let k = 0; k < 3; k++) for (const r of WORDS37) x = x.replace(r, '').trim(); return x; };

export function judge(before, after) {
  const res = { folders: 0, skippedBoth: 0, fails: [], counts: { readout: 0, audit: 0, card: 0 }, rows: { readout: 0, audit: 0, card: 0 }, notes: [] };
  for (const [k, b] of Object.entries(before)) {
    res.folders++;
    const a = after[k];
    if (!a) { res.fails.push(`${k}: folder missing after`); continue; }
    if (b.skipped) { if (!a.skipped) res.fails.push(`${k}: skipped before, read after`); else res.skippedBoth++; continue; }
    if (a.skipped) { res.fails.push(`${k}: read before, skipped after`); continue; }
    // readout: the lines that carry a check or a Not checked row, by their words
    for (const surf of ['readout', 'audit', 'card']) {
      if (b[surf] === undefined) { if (a[surf] !== undefined) res.fails.push(`${k}: ${surf} appeared`); continue; }
      if (a[surf] === undefined) { res.fails.push(`${k}: ${surf} lost`); continue; }
      if (b[surf]?.threw !== undefined || a[surf]?.threw !== undefined) { if (JSON.stringify(b[surf]?.threw) !== JSON.stringify(a[surf]?.threw)) res.fails.push(`${k}: ${surf} threw differently: ${b[surf]?.threw} / ${a[surf]?.threw}`); continue; }
      res.counts[surf]++;
    }
    if (b.readout !== undefined && Array.isArray(b.readout) && Array.isArray(a.readout)) {
      const rows = (lines) => lines.map((l) => clean(l)).filter((l) => l !== '');
      const rb = rows(b.readout), ra = rows(a.readout);
      res.rows.readout += rb.length;
      const miss = rb.filter((x) => !ra.includes(x));
      if (miss.length) res.fails.push(`${k}: readout rows lost or reworded: ${JSON.stringify(miss.slice(0, 4))}`);
      res.notes.push({ k, surf: 'readout', extra: ra.filter((x) => !rb.includes(x)).length });
    }
    if (isRec(b.audit) && isRec(a.audit)) {
      for (const sect of ['checks', 'notChecked', 'always']) {
        const rb = (b.audit[sect] ?? []).map((r) => [clean(r.text), r.by, r.result]);
        const ra = (a.audit[sect] ?? []).map((r) => [clean(r.text), r.by, r.result]);
        res.rows.audit += rb.length;
        if (JSON.stringify(rb) !== JSON.stringify(ra)) res.fails.push(`${k}: audit ${sect} rows differ: ${rb.length} -> ${ra.length}`);
        for (const r of a.audit[sect] ?? []) if (Array.isArray(a.audit.html?.[sect]) && a.audit.html[sect].length && !a.audit.html[sect].some((h) => h !== null && h.includes(String(r.text).replace(/\s+/g, ' ').trim()))) res.fails.push(`${k}: audit row html lacks its text: ${r.text.slice(0, 50)}`);
      }
      if (JSON.stringify(b.audit.readNotes) !== JSON.stringify(a.audit.readNotes)) res.fails.push(`${k}: audit readNotes differ`);
    }
    if (isRec(b.card) && isRec(a.card)) {
      const cells = (c) => {
        const p = c.plan; const o = [];
        for (const l of p.lines ?? []) { o.push(['line', l.text]); (l.rules ?? []).forEach((r) => o.push(['rule', r])); (l.leads ?? []).forEach((r) => o.push(['lead', r])); (l.extra ?? []).forEach((r) => o.push(['extra', r])); (l.checks ?? []).forEach((r) => o.push(['check', r.name, r.by])); }
        (p.suggested ?? []).forEach((r) => o.push(['suggested', r.text]));
        (p.notChecked ?? []).forEach((r) => o.push(['notChecked', r, (p.notCheckedBy ?? {})[r] ?? null]));
        (p.readNotes ?? []).forEach((r) => o.push(['readNote', r]));
        (p.alwaysOn ?? []).forEach((r) => o.push(['always', r]));
        if (c.hasAction) o.push(['action', c.actionHtml === null ? null : clean(c.actionHtml)]);
        return o;
      };
      const cb = cells(b.card), ca = cells(a.card);
      res.rows.card += cb.length;
      if (JSON.stringify(cb.map((x) => [x[0], clean(x[1]), x[2]])) !== JSON.stringify(ca.map((x) => [x[0], clean(x[1]), x[2]]))) res.fails.push(`${k}: card cells differ: ${cb.length} -> ${ca.length}`);
      for (const c of ca) if (c[0] !== 'action' && c[1] && !String(a.card.html).includes(String(c[1]).replace(/\s+/g, ' ').trim())) res.fails.push(`${k}: card html lacks ${c[0]}: ${String(c[1]).slice(0, 50)}`);
      if (b.card.hasAction && !(a.card.actionHtml && /writes everything before it/.test(a.card.actionHtml))) res.fails.push(`${k}: action row lost`);
      for (const r of b.card.plan.readNotes ?? []) if (!String(a.card.html).includes(r)) res.fails.push(`${k}: How the page was read row lost: ${r.slice(0, 50)}`);
    }
  }
  return res;
}

const [mode, file, rootArg] = process.argv.slice(2);
if (mode === 'write') {
  const snap = snapshot(rootArg ?? DEFAULT_ROOT);
  writeFileSync(file, `${JSON.stringify(snap)}\n`);
  const v = Object.values(snap);
  console.log(`folders ${v.length}; skipped ${v.filter((x) => x.skipped).length}; readout ${v.filter((x) => x.readout).length}; audit ${v.filter((x) => isRec(x.audit)).length}; card ${v.filter((x) => isRec(x.card) && !x.card.threw).length}; threw ${v.filter((x) => x.card?.threw || x.audit?.threw || x.readout?.threw).length}; page functions found: ${used.join(',')}`);
} else if (mode === 'compare') {
  const before = JSON.parse(readFileSync(file, 'utf8'));
  const res = judge(before, snapshot(rootArg ?? DEFAULT_ROOT));
  console.log(JSON.stringify({ folders: res.folders, skippedBoth: res.skippedBoth, surfacesCompared: res.counts, rowsCompared: res.rows, fails: res.fails.length }, null, 1));
  for (const f of res.fails.slice(0, 40)) console.log('FAIL', f);
  process.exit(res.fails.length ? 1 : 0);
}
