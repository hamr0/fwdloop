#!/bin/zsh
# F131 arm: one run on the real CLI path (run -> parks at its ask -> answer accept -> resume). usage: arm.sh <label> ; env: ROOT, WT, FWD_HOME, BASETEN_API_KEY (exported by the caller, never printed)
set -u
label=$1
[ -n "${BASETEN_API_KEY:-}" ] || { echo "REFUSED: empty key"; exit 2; }
cd "$WT" || exit 3
export HOME=$FWD_HOME
echo "== $label bare-agent $(node -p "require('./node_modules/bare-agent/package.json').version")"
timeout 400 node bin/fwdloop run exit-walk-1 --root "$ROOT" --source aging=/home/hamr/PycharmProjects/fwdloop/fixtures/ar-aging.csv; echo "run exit=$?"
timeout 60 node bin/fwdloop inbox --root "$ROOT"; echo "inbox exit=$?"
