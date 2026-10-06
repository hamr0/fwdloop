// M4e amendment 4 item 7 (docs/wiki/the-module-ladder.md, "M4e" amendment 4; negative (h), source level): blue section headers in the ask
// view. Source-level, like the other page tests: the page's own functions are cut out and run against a tiny fake DOM. Real colour at
// 1280/390/320, light and dark, is walked in a browser by the orchestrator.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');

function fakeDom() {
  const mk = (tag) => ({
    tag, className: '', children: [],
    appendChild(c) { this.children.push(c); return c; },
    set textContent(t) { this.children = t === '' ? [] : [{ text: String(t) }]; },
    get textContent() { return this.children.map((c) => (c.text !== undefined ? c.text : c.textContent)).join(''); },
  });
  return { createElement: mk, createTextNode: (text) => ({ text }) };
}
test('am4 (h) source: each section header of an ask artifact is wrapped in .art-head, body paragraphs and the text itself are untouched', () => {
  const PAGE_FN = PAGE.slice(PAGE.indexOf('  var ART_HEAD_MAX'), PAGE.indexOf('  // M4c item 5: "your answers so far"'));
  const fill = new Function('document', `${PAGE_FN}\nreturn fillArtifactText;`)(fakeDom());
  const body1 = 'Anthropic\'s Applied AI Architect role wants a builder-first technical partner to startup founders, fluent in LLM and agentic systems in production.';
  const body2 = 'Across two decades I have split my career between enterprise delivery and building my own products.';
  const text = `how it matches the JD\n\n${body1}\n\nsummary of work history\n\n${body2}\n\nprofessional skills, soft skills\n\nProfessional skills. AI building: generative and agentic AI.\n\nSoft skills. Fair, clear leadership.`;
  const el = fakeDom().createElement('div');
  fill(el, text);
  assert.equal(el.textContent, text, 'the artifact text is byte for byte what it was');
  const heads = el.children.filter((c) => c.className === 'art-head').map((c) => c.textContent);
  assert.deepEqual(heads, ['how it matches the JD', 'summary of work history', 'professional skills, soft skills']);
  // a one-line paragraph that ends a sentence, or the last paragraph, is not a header
  const el2 = fakeDom().createElement('div');
  fill(el2, 'Hello there.\n\nbody text here\n\nlast line');
  assert.deepEqual(el2.children.filter((c) => c.className === 'art-head').map((c) => c.textContent), ['body text here']);
  // both ask-view renderers go through it
  assert.match(PAGE, /fillArtifactText\(draftEl, evidence\.draft\)/);
  assert.match(PAGE, /fillArtifactText\(art, u\.text\)/);
});

test('am4 (h) source: .art-head is the panel\'s accent, and --accent is defined for dark, light (auto) and light (forced)', () => {
  assert.match(PAGE, /\.art-head\{color:var\(--accent\);\}/);
  const defs = [...PAGE.matchAll(/--accent:(#[0-9a-f]{6});/gi)].map((m) => m[1]);
  assert.ok(defs.length >= 3, `accent defined for each theme block: ${defs}`);
  assert.equal(new Set(defs).size, 2, 'one blue for dark, one for light');
});
