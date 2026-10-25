// A test helper: a hand-made record in the run's `line-checks.json` (M8b), for a test that feeds a reader a record the run itself did not write.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LINE_CHECKS_FILE } from '../src/line-checks.js';

/** the `cited` section = `rec` (`{lines: [...]}`); a string is written as the file's raw text (to test an unreadable record) */
export const putCited = (runDir, rec) => writeFileSync(join(runDir, LINE_CHECKS_FILE), typeof rec === 'string' ? rec : JSON.stringify({ cited: rec }));
