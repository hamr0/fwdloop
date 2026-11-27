// The page gets the origin tags, the decisions that need a reason and the draft phases from the server (PAGE_WORDS, src/page-words.js) and asks them through `inWords`;
// a test that cuts a page function out of index.html defines the same variable from the same source and takes `inWords` from the page.
import { readFileSync } from 'node:fs';
import { fnSrc } from '../scripts/panel-fixtures/fn-src.mjs';
import { pageWords } from '../src/page-words.js';

const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
export const PAGE_WORDS_PRELUDE = `var PAGE_WORDS = ${JSON.stringify(pageWords())};\n${fnSrc(PAGE, 'inWords', '  ')}`;
