// Helpers for the M10 piece 4 tests: the fact part F71's draft 3 kept for the AMS-LHR flights job, and result rows read off a saved page.
import { parseMapAnswer } from '../../../src/pagemap.js';
import { applyPageWords, lookFactOf } from '../../../src/pagelook.js';
import { factPartFromLook } from '../../../src/citedcheck.js';
import { PAGE, raw, JOB } from './load.mjs';

/** the fact part (source "flights") the look kept for the job "List 3 flights from Amsterdam to London" and its rules; 3 results exactly */
export function flightsPart(count = { min: 3, max: 3 }) {
  const p = parseMapAnswer(raw(3));
  const kept = applyPageWords(PAGE, /** @type {any} */ (p).mapping, JOB).facts.map((f) => lookFactOf(f, 'flights'));
  return factPartFromLook(kept, 'flights', count);
}

/** every flight on a page as a result: the flight's own line and the "Departure time:" line under it, values read by the test (not by the checker) */
export function flightRows(text) {
  const L = text.split('\n');
  const out = [];
  L.forEach((l, i) => {
    if (!/Select flight"/.test(l)) return;
    const quote = `${l.trim()}\n${(L[i + 1] ?? '').trim()}`;
    const price = /(?:From|Pay \$)\s*(\d+)/.exec(quote);
    const dep = /Departure time: (\d{1,2}:\d{2} [AP]M)/.exec(quote);
    out.push({ quote, values: { price: price ? price[1] : '', 'departure time': dep ? dep[1] : '' } });
  });
  return out;
}

/** the rows that pass the job's rules on the real page: under 150 dollars and non-stop */
export const goodRows = (text) => flightRows(text).filter((r) => r.values.price !== '' && Number(r.values.price) < 150 && /Nonstop/.test(r.quote));
export { PAGE };
