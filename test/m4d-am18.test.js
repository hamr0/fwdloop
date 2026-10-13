// M4d amendment 18: the page remembers the version it was served with (am17's data-version); the Inbox poll it already makes reports the server's version
// (src/version.js, the one writer); when they differ a bar says "fwdloop was updated to v<server version>. Reload this page." with a Reload button. $0.
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
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const PKG = JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
const fn = (name) => { const a = PAGE.indexOf(`  function ${name}(`); assert.ok(a !== -1, name); return PAGE.slice(a, PAGE.indexOf('\n  }\n', a) + 5); };
const handles = [];
after(async () => { await Promise.all(handles.map((h) => h.close())); });

test('page: the same version shows no bar; another version gives the exact sentence; an unknown version on either side gives none', () => {
  const bar = new Function(`${fn('updateBarText')}\nreturn updateBarText;`)();
  assert.equal(bar('0.16.0', '0.16.0'), null);
  assert.equal(bar('0.16.0', '0.17.0'), 'fwdloop was updated to v0.17.0. Reload this page.');
  assert.equal(bar('0.16.0', null), null);
  assert.equal(bar('0.16.0', undefined), null);
  assert.equal(bar('', '0.17.0'), null);
});

test('server: the Inbox reply carries the server\'s version, read each time (a restarted panel on newer code reports the new one)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am18-'));
  const pkg = path.join(root, 'package.json');
  writeFileSync(pkg, JSON.stringify({ ...PKG, version: '0.17.0' }));
  const h = await createPanelServer({ port: 0, root, settings: { home: root, env: {} }, packagePath: pkg });
  handles.push(h);
  const html = (await rq(h.port, { url: '/' })).text;
  assert.match(html, /data-version="0\.17\.0"/);
  assert.equal((await rq(h.port, { url: '/api/inbox' })).json().version, '0.17.0');
  writeFileSync(pkg, JSON.stringify({ ...PKG, version: '0.18.0' }));
  assert.equal((await rq(h.port, { url: '/api/inbox' })).json().version, '0.18.0', 'the open page (served at 0.17.0) now sees a different version');
});

test('page: the bar is at the top with a Reload button that reloads; the existing Inbox poll feeds it', () => {
  assert.match(PAGE, /<div id="update-bar"[^>]*hidden[^>]*>[\s\S]*?<button[^>]*id="update-reload"[^>]*>Reload<\/button>/);
  assert.ok(PAGE.indexOf('id="update-bar"') < PAGE.indexOf('<header class="topbar">'), 'above the header');
  assert.match(PAGE, /getElementById\("update-reload"\)\.addEventListener\("click", function\(\)\{ location\.reload\(\); \}\)/);
  assert.match(PAGE, /getJSON\("\/api\/inbox"\)\.then\(function\(r\)\{ renderInbox\(r\.rows \|\| \[\], r\.openCount\); paintUpdateBar\(r\.version\); \}\)/);
});
