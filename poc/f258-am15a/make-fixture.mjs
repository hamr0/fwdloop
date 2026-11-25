// F258 fixture (used only because no real saved draft carries a derived `!` row on a no-~ line): ONE real draft, a copy; only the no-~ line 1's words change so code builds a `!` row from them.
// "Read the notes" -> "Read the notes and say plums are purple" (the phrase the draft's own AI suggestion already named, and which is in the notes). Prose line and the step's verbatim goal change; nothing else.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const repo = path.resolve(import.meta.dirname, '../..');
const srcDir = path.join(os.homedir(), '.config/fwdloop/flows/.drafts/d-00mwjqxwxj-9e5c/draft');
const dest = path.join(repo, '.claude/scratch/f258/fixture/d-00mwjqxwxj-9e5c-fix/.drafts/x/draft');
fs.rmSync(path.join(repo, '.claude/scratch/f258/fixture'), { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(srcDir, dest, { recursive: true });
for (const e of fs.readdirSync(dest)) fs.chmodSync(path.join(dest, e), 0o644);
fs.chmodSync(dest, 0o755);
const NEW = 'Read the notes and say plums are purple';
const pp = path.join(dest, 'prose.txt');
const prose = fs.readFileSync(pp, 'utf8'); if (!prose.includes('1. Read the notes\n')) throw new Error('prose line 1 not as expected');
fs.writeFileSync(pp, prose.replace('1. Read the notes\n', `1. ${NEW}\n`));
const dp = path.join(dest, 'declaration.json');
const d = JSON.parse(fs.readFileSync(dp, 'utf8'));
const st = d.steps.find((s) => s.fromLine === 1); if (st.goal !== 'Read the notes') throw new Error('goal not as expected'); st.goal = NEW;
fs.writeFileSync(dp, `${JSON.stringify(d, null, 2)}\n`);
console.log(dest);
