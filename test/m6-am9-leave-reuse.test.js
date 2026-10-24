// M6 am9 must-fail: a red run's redraft with the job unchanged makes a new workflow. Live bug: a refused signed start ran leaveReuse() (reuseOf = null)
// but left the New card's boxes that startReuseDraft filled, so the next Draft posted a plain new-job card (new workflow m7-walk-3).
// One owner: leaveReuse clears reuseOf AND the boxes startReuseDraft filled, so they cannot come apart.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { fnSrc } from '../scripts/panel-fixtures/fn-src.mjs';

const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const IDS = ['jf-name', 'jf-job', 'jf-cap-money', 'jf-dest-folder', 'jf-inputs'];

/** the page's REAL leaveReuse over a fake card: boxes filled as startReuseDraft fills them */
function card(reuse) {
  const boxes = Object.fromEntries(IDS.map((id) => [id, { value: `old ${id}` }]));
  const askWaitEl = { value: '2h' };
  const editBannerEl = { hidden: false, textContent: 'Reusing' };
  const api = new Function('byId', 'editBannerEl', 'askWaitEl', 'reuse',
    `var reuseOf = reuse;\n${fnSrc(PAGE, 'leaveReuse', '    ')}\nreturn { leaveReuse, reuseOf: function(){ return reuseOf; } };`)((id) => boxes[id], editBannerEl, askWaitEl, reuse);
  return { api, boxes, askWaitEl, editBannerEl };
}

test('leaveReuse after a Reuse draft clears reuseOf and every box startReuseDraft filled (refused start cannot redraft the old job as a new one)', () => {
  const c = card({ flow: 'm7-walk-2', fromRun: 'run-4' });
  c.api.leaveReuse();
  assert.equal(c.api.reuseOf(), null);
  for (const id of IDS) assert.equal(c.boxes[id].value, '', id);
  assert.equal(c.askWaitEl.value, '1h');
  assert.equal(c.editBannerEl.hidden, true);
});

test('leaveReuse when nothing was reused leaves a person\'s typing alone', () => {
  const c = card(null);
  c.api.leaveReuse();
  for (const id of IDS) assert.equal(c.boxes[id].value, `old ${id}`, id);
});

test('a refused signed start leaves Reuse via leaveReuse (not resetCard: the refusal sentence stays)', () => {
  assert.equal((PAGE.match(/if\(signed\)\{ leaveReuse\(\); endSession\(\)/g) ?? []).length, 1);
  assert.match(PAGE, /r\.body\.signed === true\)\{ leaveReuse\(\); endSession\(\)/);
});
