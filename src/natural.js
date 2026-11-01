// M13 item 9.6: the ONE place that orders names with numbers in them (`run-9` before `run-10`, `#8` before `#10`, `run-3-rerun-1` before `run-25`).
// Digit runs compare as numbers (by length after leading zeros, then by text, so a long number never loses digits); everything else compares as text.

/** @param {string} a @param {string} b digit strings */
const digits = (a, b) => {
  const x = a.replace(/^0+/, '');
  const y = b.replace(/^0+/, '');
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
};

/** @param {unknown} x @param {unknown} y @returns {number} negative, 0 or positive, like a sort callback */
export function compareNatural(x, y) {
  const tx = String(x).match(/\d+|\D+/g) ?? [];
  const ty = String(y).match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(tx.length, ty.length); i++) {
    const a = tx[i];
    const b = ty[i];
    if (a === b) continue; // eslint-disable-line no-continue
    const c = /^\d/.test(a) && /^\d/.test(b) ? digits(a, b) : (a < b ? -1 : 1);
    if (c !== 0) return c;
  }
  return tx.length - ty.length;
}
