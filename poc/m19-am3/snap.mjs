// F234 / M19 am3 helper: `node snap.mjs <repoRoot> <draftsRoot> <outFile>`. For every prose.txt under draftsRoot, builds the drafter's FIRST block (setUpBlock, asks true, no AI) with the src/ of <repoRoot>
// and records the block's open questions (kind + rule) and shapeCandidates(). Also rebuildBlock (the real saved-plan path) where a declaration.json is there. $0, no AI, no key; read-only on draftsRoot.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, root, out] = process.argv.slice(2);
const imp = (f) => import(pathToFileURL(path.join(repo, 'src', f)).href);
const { parseSignedText } = await imp('signed-text.js');
const { readInputFacts } = await imp('input-facts.js');
const { blockJobLines } = await imp('blocklines.js');
const { setUpBlock } = await imp('blockdraft.js');
const { codeScope } = await imp('checkpick.js');
const { rebuildBlock } = await imp('planrebuild.js');
const { PAGES_DIR } = await imp('authoring.js');
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const rj = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

const dirs = [];
const walk = (d, depth) => {
  if (fs.existsSync(path.join(d, 'prose.txt'))) dirs.push(d);
  if (depth >= 3) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
};
walk(root, 0);

const res = {};
for (const dir of dirs.sort()) {
  const k = path.relative(root, dir);
  try {
    const prose = fs.readFileSync(path.join(dir, 'prose.txt'), 'utf8');
    const parsed = parseSignedText(prose);
    if (!parsed.ok) { res[k] = { skipped: 'prose unreadable' }; continue; }
    const pl = rj(path.join(dir, 'page-look.json'));
    const pages = {};
    for (const p of Array.isArray(pl?.pages) ? pl.pages : []) {
      try { pages[p.role] = { text: fs.readFileSync(path.join(dir, PAGES_DIR, String(p.frozen)), 'utf8') }; } catch { /* none */ }
    }
    const facts = readInputFacts(parsed.arbiter.sources ?? [], { pages });
    if (!facts.ok) { res[k] = { skipped: 'inputs not readable' }; continue; }
    const plan = blockJobLines(prose, undefined, []);
    if (!plan.ok) { res[k] = { skipped: 'no block lines' }; continue; }
    const texts = { ...(facts.docs ?? {}), ...Object.fromEntries(Object.entries(pages).map(([r, p]) => [r, p.text])) };
    const block = setUpBlock({
      texts, jobLines: plan.jobLines, look: { facts: [], dropped: [] }, kept: { picks: [], left: [], askRules: [] }, fresh: { picks: [], left: [] },
      asks: true, countScope: (t) => codeScope(parsed.arbiter.sources, t) === 'in', leaveOut: [], sheetLines: [],
    });
    res[k] = {
      open: block.open.map((q) => `${q.ask}@${q.line}:${q.ruleText}`).sort(),
      candidates: block.shapeCandidates().map((c) => `${c.line}.${c.rule}`),
    };
    if (fs.existsSync(path.join(dir, 'declaration.json'))) {
      const r = rebuildBlock({ planDir: dir, asks: true });
      res[k].rebuild = r.ok ? { open: r.block.open.map((q) => `${q.ask}@${q.line}:${q.ruleText}`).sort(), candidates: r.block.shapeCandidates().map((c) => `${c.line}.${c.rule}`) } : { refused: r.say };
    }
  } catch (e) { res[k] = { threw: String(e?.message ?? e).slice(0, 200) }; }
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`${dirs.length} folders`);
