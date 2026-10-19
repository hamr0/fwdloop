#!/usr/bin/env node
// POC (throwaway, never shipped). Builds poc/thinking/engine/ = a copy of bin/ + src/ with TWO one-line patches:
//   src/runner.js     : stepMeta also carries { attempt, stepId } (the runner's own attempt number)
//   src/send.js       : $0/fake runs ONLY (FWDLOOP_POC_SEND_DIR set) send into a sink dir instead of the signed destination
//   src/model-step.js : loop.run options gain the arm's thinkingMode (+ per-call recorder), from ./hook.mjs
// The copy is generated, not committed (engine/ is gitignored); src/ itself is never edited. Fails loudly if a patch target moved.
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const engine = join(here, 'engine');

export function makeEngine() {
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const header = `// POC copy of src/ @${sha} — throwaway, never shipped\n`;
  rmSync(engine, { recursive: true, force: true });
  mkdirSync(engine, { recursive: true });
  cpSync(join(repo, 'src'), join(engine, 'src'), { recursive: true });
  cpSync(join(repo, 'bin'), join(engine, 'bin'), { recursive: true });

  const patch = (rel, from, to) => {
    const p = join(engine, rel);
    const s = readFileSync(p, 'utf8');
    if (s.split(from).length !== 2) throw new Error(`make-engine: patch target not found exactly once in ${rel}: ${from}`);
    writeFileSync(p, s.replace(from, () => to));
  };
  patch('src/runner.js',
    'const stepMeta = Object.freeze({ class: step.close?.class ?? null, attempt, step: step?.emits ?? step?.goal ?? null, thinkingMode: stepThinkingMode({ boxOn: thinkingBox, attempt }) });',
    'const stepMeta = Object.freeze({ class: step.close?.class ?? null, attempt, stepId: step.emits ?? step.goal ?? null }); // POC patch (src now carries attempt + thinkingMode since M4d am25; the POC arm overrides the mode)');
  patch('src/model-step.js',
    'const toolSchema = buildEmitArtifactSchema(stepMeta.class);',
    "const poc = pocBegin(provider, stepMeta); // POC patch\n    const toolSchema = buildEmitArtifactSchema(stepMeta.class);");
  patch('src/model-step.js',
    "result = await loop.run(messages, tools, { maxTokens: 16000, ...(thinkingMode ? { thinkingMode } : {}) });",
    'result = await loop.run(messages, tools, { maxTokens: 16000, ...poc.opts }); // POC patch (the arm decides, not src\'s am25 mode)');
  patch('src/send.js', 'const destination = checkSendDestination(target, ctx);', "const destination = checkSendDestination(pocSendTarget(target), ctx); // POC patch");
  patch('src/send.js', /^import .*$/m.exec(readFileSync(join(repo, 'src/send.js'), 'utf8'))[0], /^import .*$/m.exec(readFileSync(join(repo, 'src/send.js'), 'utf8'))[0] + "\nimport { pocSendTarget } from '../../hook.mjs'; // POC patch");
  patch('src/model-step.js', "import { Loop, HaltError } from 'bare-agent';", "import { Loop, HaltError } from 'bare-agent';\nimport { pocBegin } from '../../hook.mjs'; // POC patch");

  const stamp = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) { stamp(p); continue; }
      const s = readFileSync(p, 'utf8');
      if (n.endsWith('.js') || n.endsWith('.mjs')) writeFileSync(p, s.startsWith('#!') ? s.replace('\n', `\n${header}`) : header + s);
      else if (n === 'fwdloop') writeFileSync(p, s.replace('\n', `\n${header}`));
    }
  };
  stamp(engine);
  return { engine, sha };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { engine: e, sha } = makeEngine();
  process.stdout.write(`engine built at ${e} from src @${sha}\n`);
}
