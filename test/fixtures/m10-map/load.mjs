// F71's saved page (public flights page, no PII) and the raw map answers of its three drafts, for the M10 page-word tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = HERE;
export const PAGE = readFileSync(path.join(HERE, 'page-ams-lhr.txt'), 'utf8');
export const CHEAT_REVERSED = readFileSync(path.join(HERE, 'page-ams-lhr.cheat-reversed.txt'), 'utf8');
export const raw = (n) => JSON.parse(readFileSync(path.join(HERE, `draft-${n}.raw.json`), 'utf8')).raw;
export const JOB = [{ n: 1, text: 'List 3 flights from Amsterdam to London', rule: 'under $150; not a red-eye; nonstop' }];
