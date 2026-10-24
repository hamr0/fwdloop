// borrowed-from: bareloop src/validate.js@1a41097 (SECRET_PATTERNS only)
// POC shim: bareloop's redactSecrets calls bareguard's `redact`, which is not copied here; a plain regex mask stands in.
export const SECRET_PATTERNS = [
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/,
  /(?<![A-Za-z0-9_])ghp_[A-Za-z0-9]{20,}/,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}/,
  /(?<![A-Za-z0-9_])AKIA[0-9A-Z]{16}/,
  /(?<![A-Za-z0-9_])xox[bap]-[A-Za-z0-9-]{10,}/,
  /(?<![A-Za-z0-9_])AIza[0-9A-Za-z_-]{35}/,
];
export function redactSecrets(raw) {
  let s = String(raw ?? '');
  for (const re of SECRET_PATTERNS) s = s.replace(new RegExp(re.source, 'g'), '[REDACTED]');
  return s;
}
