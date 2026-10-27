// F87 POC: barebrowse 0.26.0 links + load outcome (installed package). $0, no model calls. Read only, incognito, consent false, never click.
// Run: node poc/browse/f87.mjs   -> poc/browse/results-f87-1.json (wx, written once)
import { connect } from 'barebrowse';
import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPageText } from '../../src/pagefetch.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.F87_OUT || join(here, 'results-f87-1.json');
const ISSUES = 'https://github.com/nodejs/node/issues';
const R = { barebrowse: JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.resolve('barebrowse'))), '..', 'package.json'), 'utf8')).version, engines: {}, B5: {}, B6: {} };
const mine = () => execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('barebrowse-') && !l.includes('ps -eo')).map((l) => +l.trim().split(/\s+/)[0]);
const tmpDirs = () => new Set(readdirSync('/tmp').filter((d) => d.startsWith('barebrowse-')));
const pidsBefore = new Set(mine()), dirsBefore = tmpDirs();
const cleanup = () => {
  for (const pid of mine()) if (!pidsBefore.has(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
};
const dl = setTimeout(() => { cleanup(); console.error('F87 deadline 240s'); process.exit(3); }, 240000);
const errShape = (e) => ({ name: e?.name, code: e?.code, reason: e?.reason, message: String(e?.message).slice(0, 200) });
const OPEN = { incognito: true, consent: false };

/** list items (data mode): block = a `listitem` line and its deeper-indented lines; a hit has a link whose path is /nodejs/node/issues/<digits> */
function pickIssues(snap) {
  const lines = snap.split('\n'), items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- listitem\b/);
    if (!m) continue;
    const ind = m[1].length; let j = i + 1;
    while (j < lines.length && (lines[j].match(/^(\s*)/)[1].length > ind)) j++;
    const block = lines.slice(i + 1, j);
    for (const l of block) {
      const lm = l.match(/link "(.*)" <(https:\/\/github\.com\/nodejs\/node\/issues\/(\d+))> \[ref=\d+\]/);
      if (lm) { items.push({ number: lm[3], title: lm[1] }); break; }
    }
  }
  return items;
}

for (const engine of ['chromium', 'firefox']) {
  const E = R.engines[engine] = {};
  let page;
  try {
    page = await connect({ ...OPEN, engine });
    // B1/B3a
    const nav = await page.goto(ISSUES, 30000);
    await page.waitForNetworkIdle({ idle: 1500, timeout: 15000 }).catch(() => {});
    const withLinks = await page.snapshot({ mode: 'data', links: true });
    const linkLines = withLinks.split('\n').filter((l) => /\blink "/.test(l));
    const picked = pickIssues(withLinks);
    E.B1 = { verdict: picked.length >= 10 ? 'PASS' : 'FAIL', count: picked.length, linkLinesWithUrl: linkLines.filter((l) => l.includes(' <https://')).length, sample: picked.slice(0, 3), chars: withLinks.length };
    // B2
    const noLinks = await page.snapshot({ mode: 'data' });
    const n2 = noLinks.split('\n').filter((l) => /\blink "/.test(l) && l.includes('<https://')).length;
    E.B2 = { verdict: n2 === 0 ? 'PASS' : 'FAIL', linkLinesWithUrl: n2, chars: noLinks.length };
    // B3
    const r404 = await page.goto('https://github.com/nodejs/node/issues-nope-f87', 30000);
    const s404 = await page.snapshot({ mode: 'data' });
    const rHttp = await page.goto('http://github.com/nodejs/node/issues', 30000);
    E.B3 = { issues: nav, nope: r404, snapshot404Head: s404.split('\n')[0].slice(0, 80), http: rHttp };
    E.B3.verdict = nav.status === 200 && r404.status === 404 && s404.startsWith('[HTTP 404') && rHttp.status === 200 && rHttp.url.startsWith('https://') ? 'PASS' : 'FAIL';
    // B4
    try { await page.goto('http://nonexistent-f87.invalid/', 30000); E.B4 = { verdict: 'FAIL', note: 'resolved' }; }
    catch (e) { E.B4 = { verdict: e.code === 'NAV_FAILED' && e.reason ? 'PASS' : 'FAIL', ...errShape(e) }; }
  } catch (e) { E.error = errShape(e); }
  finally { try { await Promise.race([page?.close(), new Promise((r) => setTimeout(r, 8000))]); } catch {} }
}

// B5: fwdloop's own fetch, chromium, direct call
const realConnect = async (o) => connect({ ...o, engine: 'chromium' });
for (const [name, url] of [['unreachable', 'http://nonexistent-f87.invalid/'], ['404', 'https://github.com/nodejs/node/issues-nope-f87']]) {
  const t0 = Date.now();
  const before = new Set(mine());
  let res, thrown = null;
  try { res = await fetchPageText(url, { connect: realConnect, idleMs: 500, idleTimeoutMs: 5000 }); } catch (e) { thrown = errShape(e); }
  await new Promise((r) => setTimeout(r, 1500));
  const left = mine().filter((p) => !before.has(p));
  R.B5[name] = { url, ms: Date.now() - t0, thrown, ok: res?.ok, error: res?.error, textHead: res?.ok ? res.text.split('\n').slice(0, 3).map((l) => l.slice(0, 160)) : undefined, textChars: res?.ok ? res.text.length : undefined, browserPidsLeftAfterFetch: left.length };
  for (const p of left) { try { process.kill(p, 'SIGKILL'); } catch {} }
}

// B6
await new Promise((r) => setTimeout(r, 1500));
const leftPids = mine().filter((p) => !pidsBefore.has(p));
const leftDirs = [...tmpDirs()].filter((d) => !dirsBefore.has(d));
R.B6 = { leftoverPids: leftPids.length, leftoverTmpDirs: leftDirs };
cleanup();
clearTimeout(dl);
writeFileSync(OUT, JSON.stringify(R, null, 2), { flag: 'wx' });
console.log(JSON.stringify(R, null, 2));
process.exit(0);
