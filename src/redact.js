// The one secret inventory: known token shapes only, masked before a value is stored or written.
// borrowed-from: bareloop src/validate.js@76168c8 (SECRET_PATTERNS; a key right after a hyphen is masked for the distinctive prefixes). Its own module so a caller that only
// needs to mask (src/diary.js) does not pull litectx in through src/ctx-tools.js.

import { redact } from 'bareguard';

const SECRET_PATTERNS = [
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/,
  /(?<![A-Za-z0-9_])ghp_[A-Za-z0-9]{20,}/,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}/,
  /(?<![A-Za-z0-9_])AKIA[0-9A-Z]{16}/,
  /(?<![A-Za-z0-9_])xox[bap]-[A-Za-z0-9-]{10,}/,
  /(?<![A-Za-z0-9_])AIza[0-9A-Za-z_-]{35}/,
];

/** Mask known secret shapes. @param {unknown} raw */
export const redactSecrets = (raw) => redact(String(raw ?? ''), { patterns: SECRET_PATTERNS });
