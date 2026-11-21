// F246: copies loop's src files from the tag (never the branch) into loop/src/, header line prepended; --check verifies each equals the tag's text minus the header.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BARELOOP = '/home/hamr/PycharmProjects/bareloop';
const FILES = ['kinds', 'rubricstep', 'rowresults', 'checkwords', 'clock', 'config', 'csv', 'facts', 'factwords', 'guarddescriptions', 'inputlook', 'labelscan', 'mcpsources', 'pagedropwords', 'pagefetch', 'pagerules', 'placerule', 'providershapes', 'ralph', 'shapemenu', 'shaperows', 'shapewords', 'sheetchecks', 'sheetclaims', 'sheetrows', 'sheetrun', 'source', 'stagewords', 'ticket', 'ticketmcp', 'ticketrepo', 'ticketshape', 'validate', 'worktree'];
const tag = (f) => execFileSync('git', ['-C', BARELOOP, 'show', `v0.61.0:src/${f}.js`], { encoding: 'utf8', maxBuffer: 1 << 26 });
const head = (f) => `// borrowed-from: bareloop src/${f}.js@v0.61.0 (fc56e1f3)\n`;
const dir = path.join(HERE, 'loop', 'src');
if (process.argv.includes('--check')) {
  let bad = 0;
  for (const f of FILES) { const t = fs.readFileSync(path.join(dir, `${f}.js`), 'utf8'); if (t !== head(f) + tag(f)) { bad++; console.log('DIFFERS', f); } }
  console.log(JSON.stringify({ files: FILES.length, differ: bad })); process.exit(bad ? 1 : 0);
}
fs.mkdirSync(dir, { recursive: true });
for (const f of FILES) fs.writeFileSync(path.join(dir, `${f}.js`), head(f) + tag(f));
console.log('copied', FILES.length);
