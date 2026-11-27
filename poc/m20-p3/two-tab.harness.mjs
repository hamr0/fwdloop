// F267 (M20 P3): do two browser tabs on one panel follow a Stop and a Resume? $0: gated fake model step, fake provider, no key.
// usage: node poc/m20-p3/two-tab.harness.mjs   (prints one JSON result line)
import { writeFileSync } from 'node:fs';
import { launchChrome } from '../../scripts/panel-fixtures/cdp.mjs';
import { GATED_STEP, reapChildren, until, world } from '../../test/m4e-world.mjs';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const out = { stop: null, resume: null };
const w = await world({ step: GATED_STEP });
const c1 = await launchChrome();
const c2 = await launchChrome();
try {
  if (!c1 || !c2) throw new Error('no chromium');
  await w.signedFlow();
  const start = (await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: 'r1' })).json();
  await until(async () => { const j = (await w.get(`/api/author/start/${start.startId}`)).json(); return j?.phase === 'started' && j.state === 'working' ? j : null; });
  const openRun = async (c) => {
    await c.open(`http://127.0.0.1:${w.h.port}/`, 1280);
    await c.ev('(function(){ var x = Array.from(document.querySelectorAll("button, a, [role=tab]")).find(function(e){ return /Runs/.test(e.textContent) && e.textContent.length < 12; }); if(x) x.click(); })()');
    await c.waitFor('Array.from(document.querySelectorAll("button")).some(function(x){ return /r1/.test(x.textContent); })', 10000);
    await c.ev('(function(){ var x = Array.from(document.querySelectorAll("button")).find(function(e){ return /r1/.test(e.textContent); }); if(x) x.click(); })()');
    if (!(await c.waitFor('/running/.test(document.getElementById("active-wf-verdict").textContent)', 15000))) throw new Error('run not open as running');
  };
  await openRun(c1);
  await openRun(c2);
  const verdict2 = () => c2.ev('document.getElementById("active-wf-verdict").textContent');
  const post1 = (url, body) => c1.ev(`fetch(${JSON.stringify(url)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(function(r){ return r.status; })`);

  // one transition: wait for the API sign, then time tab 2 to the word
  const follow = async (apiOk, word) => {
    let t0 = null; let t1 = null; const t = Date.now();
    while (Date.now() - t < 60000 && t1 === null) {
      // eslint-disable-next-line no-await-in-loop
      if (t0 === null && apiOk((await w.get('/api/runs/job2/r1')).json())) t0 = Date.now();
      // eslint-disable-next-line no-await-in-loop
      const v = await verdict2();
      if (t0 !== null && new RegExp(word).test(v)) t1 = Date.now();
      // eslint-disable-next-line no-await-in-loop
      await sleep(100);
    }
    return { apiAtMs: t0, followMs: t0 !== null && t1 !== null ? t1 - t0 : null, tab2Text: await verdict2() };
  };

  // Stop in tab 1 (the gate is released so the held step closes and the run ends)
  out.stopStatus = await post1('/api/stop', { flow: 'job2', runId: 'r1' });
  writeFileSync(w.gate, 'go');
  out.stop = await follow((d) => d?.glyph === '[■]', '^stopped');
  // Resume in tab 1 (the two clicks: prepare, then resume with its hash)
  await sleep(3000);
  const prep = await c1.ev(`fetch('/api/author/resume-prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flow: 'job2', runId: 'r1', capUsd: '0.25' }) }).then(function(r){ return r.json(); })`);
  out.prepHash = typeof prep?.hash === 'string';
  out.resumeStatus = await post1('/api/author/resume', { flow: 'job2', runId: 'r1', capUsd: '0.25', hash: prep?.hash });
  out.resume = await follow((d) => d?.glyph === '[·]' || d?.glyph === '[▶]', '^(waiting|running)');
  const d = (await w.get('/api/runs/job2/r1')).json();
  out.apiAfterResume = { glyph: d?.glyph, word: d?.word };
  // is tab 2's word the API's word at the end?
  out.pass = out.stop.followMs !== null && out.stop.followMs <= 10000 && out.resume.followMs !== null && out.resume.followMs <= 10000;
} finally {
  c1?.close(); c2?.close();
  await reapChildren();
}
process.stdout.write(`${JSON.stringify(out)}\n`);
process.exit(0);
