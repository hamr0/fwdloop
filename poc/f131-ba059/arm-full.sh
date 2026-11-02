#!/bin/zsh
# F131 full arm: run -> parks at its ask -> answer accept -> resume. usage: arm-full.sh <label> <runId>; env ROOT WT FWD_HOME BASETEN_API_KEY (exported by caller, never printed)
set -u
label=$1; rid=$2
[ -n "${BASETEN_API_KEY:-}" ] || { echo "REFUSED: empty key"; exit 2; }
cd "$WT" || exit 3
export HOME=$FWD_HOME
echo "== $label bare-agent $(node -p "require('./node_modules/bare-agent/package.json').version")"
timeout 400 node bin/fwdloop run exit-walk-1 --root "$ROOT" --source aging=/home/hamr/PycharmProjects/fwdloop/fixtures/ar-aging.csv; echo "run exit=$?"
ask=$(timeout 60 node bin/fwdloop inbox --root "$ROOT" | grep "run=$rid " | grep -Eo '^[0-9a-f-]{36}')
echo "ask found: ${ask:+yes}"
[ -n "$ask" ] && timeout 60 node bin/fwdloop answer "$ask" accept --root "$ROOT"
timeout 300 node bin/fwdloop resume "$rid" --flow exit-walk-1 --root "$ROOT"; echo "resume exit=$?"
echo DONE
