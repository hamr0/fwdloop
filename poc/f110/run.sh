#!/bin/sh
# F110 driver: fake npm on PATH records env NAMES only. Usage: sh poc/f110/run.sh
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
for c in A B; do
  T=$(mktemp -d); mkdir -p "$T/bin" "$T/.config/fwdloop"
  printf '#!/bin/sh\nenv | cut -d= -f1 | sort > "%s/npm-env-names.txt"\nexit 0\n' "$T" > "$T/bin/npm"; chmod +x "$T/bin/npm"
  if [ $c = B ]; then printf 'FAKE2_PROVIDER_API_KEY=sk-canary-f110-file\n' > "$T/.config/fwdloop/.env"; chmod 600 "$T/.config/fwdloop/.env"; fi
  if [ $c = A ]; then export FAKE_PROVIDER_API_KEY=sk-canary-f110-shell; else unset FAKE_PROVIDER_API_KEY; fi
  PATH="$T/bin:$PATH" HOME="$T" timeout 60 node "$ROOT/poc/f110/f110.mjs" $c "$T"
  for n in FAKE_PROVIDER_API_KEY FAKE2_PROVIDER_API_KEY; do
    if grep -qx $n "$T/npm-env-names.txt" 2>/dev/null; then echo "  npm child has $n: yes"; else echo "  npm child has $n: no"; fi
  done
  [ -f "$T/npm-env-names.txt" ] && echo "  npm ran (fake): yes" || echo "  npm ran (fake): no"
  rm -rf "$T"
done
