// F192 POC ($0): build the two trees. CURRENT = `git archive HEAD`; PORTED = the same plus the F191 vendor files overlaid on src/ and one patch of src/panel/authorcard.js `applyAnswers` (the POC's stand-in for the job-text owner of bareloop 094b896a).
// Pre-registration: docs/logs/FINDINGS.md "F192 PRE-REGISTERED". Not shipped.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** @param {string} root the repo @param {string} scratch an empty dir @returns {{current: string, ported: string}} */
export function buildTrees(root, scratch) {
  const sh = (cmd, args, opt = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 150000, maxBuffer: 64 * 1024 * 1024, ...opt });
  const tar = path.join(scratch, 'a.tar');
  fs.writeFileSync(tar, execFileSync('git', ['-C', root, 'archive', 'HEAD'], { maxBuffer: 256 * 1024 * 1024 }));
  const out = {};
  for (const name of ['current', 'ported']) {
    const d = path.join(scratch, name);
    fs.mkdirSync(d);
    sh('tar', ['-xf', tar, '-C', d]);
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(d, 'node_modules'));
    out[name] = d;
  }
  // PORTED: the four vendor files (imports ../../../src/ -> ./)
  for (const f of ['checkblock', 'blockpick', 'blockasks', 'pickrecord']) {
    const txt = fs.readFileSync(path.join(root, 'poc/f191-replace/vendor', `${f}.js`), 'utf8').replace(/from '\.\.\/\.\.\/\.\.\/src\//g, "from './");
    fs.writeFileSync(path.join(out.ported, 'src', `${f}.js`), txt);
  }
  // PORTED: applyAnswers replaces the asked rule for a check / no-check answer, and its picks carry no `added`
  const ac = path.join(out.ported, 'src/panel/authorcard.js');
  let t = fs.readFileSync(ac, 'utf8');
  const a = "    } else appends.push({ line: x.line, answer: x.rule });";
  const b = "    } else if ((x.ask === 'check' || x.ask === 'no-check') && Number.isInteger(x.ruleNo)) {\n      const r = replaceRuleOnJob(out, x.line, String(x.ruleText ?? ''), x.rule);\n      if (r.replaced) { out = r.job; done += 1; } else appends.push({ line: x.line, answer: x.rule });\n    } else appends.push({ line: x.line, answer: x.rule });";
  if (t.split(a).length !== 2) throw new Error('overlay: the applyAnswers append line was not found exactly once');
  t = t.replace(a, b);
  const c = "check: x.check ?? null, added: /** @type {string} */ (x.rule), ...(x.own ? { own: true } : {}) }));";
  if (t.split(c).length !== 2) throw new Error('overlay: the picks line was not found exactly once');
  t = t.replace(c, "check: x.check ?? null, ...(x.own ? { own: true } : {}) }));");
  fs.writeFileSync(ac, t);
  return out;
}
