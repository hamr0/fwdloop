// M4d amendment 21 item 3: with an empty job box (no step that needs a model) the Cap note adds a grey line. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const fn = (name) => { const a = PAGE.indexOf(`    function ${name}(`); assert.ok(a !== -1, name); return PAGE.slice(a, PAGE.indexOf('\n    }\n', a) + 7); };
const SAY = 'The cap is checked against the model once the job has a step.';

test('the grey line is shown only for a job with no step, in the exact words, and cleared when it has one', () => {
  const els = { 'jf-cap-job-note': { textContent: '' }, 'jf-job': { value: '' } };
  const paint = new Function('els', `function byId(id){ return els[id]; }\n${fn('jobHasModelStep')}\n${fn('paintCapJobNote')}\nreturn paintCapJobNote;`)(els);
  paint('new');
  assert.equal(els['jf-cap-job-note'].textContent, SAY);
  els['jf-job'].value = '~just a guardrail\nAsk: check';
  paint('new');
  assert.equal(els['jf-cap-job-note'].textContent, SAY, 'guardrail and ask lines are not steps that need a model');
  els['jf-job'].value = 'Read my resume';
  paint('new');
  assert.equal(els['jf-cap-job-note'].textContent, '');
  els['jf-job'].value = '';
  paint('run');
  assert.equal(els['jf-cap-job-note'].textContent, '', 'only the New job card');
});

test('the note is in the markup (a grey hint under the Cap note) and refreshCapNote repaints it', () => {
  assert.match(PAGE, /<div class="hint" id="jf-cap-job-note" data-testid="jf-cap-job-note"><\/div>/);
  assert.match(fn('refreshCapNote'), /paintCapJobNote\(mode\);/);
});
