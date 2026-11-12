// F179 POC A: node poc/m10-am32/a.mjs  ($0: fake key value, mkdtemp copy, shapes only)
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
const REPO = resolve(new URL('../..', import.meta.url).pathname);
const HOME = homedir();
const SRC = join(HOME, '.config/fwdloop/flows/.drafts/d-00mwcib8im-c20d');
const { createAuthor } = await import(join(REPO, 'src/panel/author.js'));
const tmpRoot = mkdtempSync(join(tmpdir(), 'f179a-'));
const out = {};
try {
  const cfgHome = join(tmpRoot, 'cfg'); mkdirSync(cfgHome); cpSync(join(HOME, '.config/fwdloop/config.json'), join(cfgHome, 'config.json'));
  const author = createAuthor({ root: tmpRoot, home: cfgHome, loadEnv: () => ({ ok: true, env: { DEEPSEEK_API_KEY: 'fake-not-a-key', PATH: process.env.PATH, HOME: tmpRoot }, refusal: null, keyNames: ['DEEPSEEK_API_KEY'] }), bin: join(REPO, 'bin/fwdloop'), childRunning: () => false, skipMonthly: true });
  const run = async (id, mutate) => {
    const dd = join(tmpRoot, '.drafts'); mkdirSync(dd, { recursive: true });
    cpSync(SRC, join(dd, id), { recursive: true });
    for (const f of ['signed.json', 'pid.json', 'abandoned.json']) rmSync(join(dd, id, f), { force: true });
    for (const f of readdirSync(join(dd, id))) if (/^(card|prose|redraft)-\d+/.test(f)) rmSync(join(dd, id, f), { recursive: true, force: true });
    const pd = join(dd, id, 'draft');
    for (const f of readdirSync(pd)) if (/^answer-\d+\.json$/.test(f)) rmSync(join(pd, f));
    const cf = join(dd, id, 'card.json'); const cj = JSON.parse(readFileSync(cf, 'utf8')); cj.provider = 'DEEPSEEK_API_KEY'; cj.model = 'deepseek-flash'; writeFileSync(cf, JSON.stringify(cj));
    if (mutate) { const qf = join(pd, 'questions.json'); const qj = JSON.parse(readFileSync(qf, 'utf8')); mutate(qj.questions[0]); writeFileSync(qf, JSON.stringify(qj)); }
    const x = author.answer(id, { k: 1, answer: 'a rule typed with no button' });
    const r = { status: x.status, ok: x.body?.ok ?? null, refused: x.body?.refused ?? null, say: x.body?.say ?? null, answerWritten: existsSync(join(pd, 'answer-1.json')), redraftWritten: existsSync(join(dd, id, 'redraft-1.json')) };
    if (r.answerWritten) { const a = JSON.parse(readFileSync(join(pd, 'answer-1.json'), 'utf8')); r.answerFile = { answer: a.answer, rule: a.rule, hasChoiceField: 'choice' in a }; }
    if (r.redraftWritten) {
      const log = join(dd, id, 'redraft-1.log');
      for (let i = 0; i < 40 && !(existsSync(log) && readFileSync(log, 'utf8').trim() !== ''); i += 1) await new Promise((y) => setTimeout(y, 250));
      r.log = existsSync(log) ? readFileSync(log, 'utf8').replace(/\s+/g, ' ').slice(0, 160) : null;
    }
    return r;
  };
  out.noChoice = await run('d-00f179aaaa-0001', null);
  const o = out.noChoice;
  out.verdict = (o.status >= 200 && o.status < 300 && o.answerWritten && !o.answerFile?.hasChoiceField) ? 'BEFORE: accepted, saved with no choice (hole exists)' : o.status === 400 && !o.answerWritten ? 'AFTER: refused, nothing written' : 'UNEXPECTED';
} finally { rmSync(tmpRoot, { recursive: true, force: true }); }
console.log(JSON.stringify(out, null, 1));
