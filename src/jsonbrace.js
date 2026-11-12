// borrowed-from: poc/f183-brace/repair.mjs (the repair rule, M4d am39)
// A drafting answer that is a complete JSON object followed ONLY by `}` characters and whitespace: drop exactly those
// trailing characters and parse the rest. Anything else (trailing `]`, text, `}x`, a truncated object, two objects,
// an array root) returns null. The caller calls this only for a round whose reason is malformed JSON.
/**
 * @param {unknown} raw
 * @returns {{ value: Record<string, any>, dropped: string } | null}
 */
export function repairTrailingBraces(raw) {
  if (typeof raw !== 'string') return null;
  let cut = raw.trimEnd();
  if (!cut.endsWith('}')) return null;
  for (;;) {
    cut = cut.slice(0, -1).trimEnd();
    if (!cut.endsWith('}')) return null;
    let value;
    try { value = JSON.parse(cut); } catch { continue; }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    return { value, dropped: raw.slice(cut.length) };
  }
}
