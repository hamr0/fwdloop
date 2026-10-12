// M4d amendment 17: the panel header reads "fwdloop · v<version> · automate a job — it has humans in it". The server reads the version from fwdloop's own
// package.json when it serves the page (one writer, never typed into the page). $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { rq } from './m4e-world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
const handles = [];
after(async () => { await Promise.all(handles.map((h) => h.close())); });
async function pageOf(extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am17-'));
  const h = await createPanelServer({ port: 0, root, settings: { home: root, env: {} }, ...extra });
  handles.push(h);
  return (await rq(h.port, { url: '/' })).text;
}
const headerOf = (html) => {
  const a = html.indexOf('<header class="topbar">');
  return html.slice(a, html.indexOf('</header>', a));
};
const spans = (h) => [...h.matchAll(/<span class="(brand|version|tagline)"[^>]*>([^<]*)<\/span>/g)].map((m) => `${m[1]}:${m[2]}`);

test('the header shows package.json\'s version: brand, version, tagline, in that order', async () => {
  const h = headerOf(await pageOf());
  assert.deepEqual(spans(h), ['brand:fwdloop', `version:v${PKG.version}`, 'tagline:automate a job — it has humans in it']);
  assert.match(h, new RegExp(`data-version="${PKG.version.replace(/\./g, '\\.')}"`));
});

test('a copy of package.json with another version: the header follows it (the page types no version)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am17-pkg-'));
  const copy = path.join(dir, 'package.json');
  writeFileSync(copy, JSON.stringify({ ...PKG, version: '9.8.7' }));
  const html = await pageOf({ packagePath: copy });
  assert.deepEqual(spans(headerOf(html)).slice(0, 2), ['brand:fwdloop', 'version:v9.8.7']);
  assert.doesNotMatch(html, new RegExp(`v${PKG.version.replace(/\./g, '\\.')}`));
  assert.doesNotMatch(html, /__FWDLOOP_VERSION__/);
  const source = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
  assert.doesNotMatch(source, new RegExp(`v${PKG.version.replace(/\./g, '\\.')}`), 'the page source holds a placeholder, never the number');
});

test('an unreadable package.json shows no made-up number: "version unknown"', async () => {
  const html = await pageOf({ packagePath: path.join(tmpdir(), 'fwdloop-am17-nope', 'package.json') });
  assert.deepEqual(spans(headerOf(html)).slice(0, 2), ['brand:fwdloop', 'version:version unknown']);
});
