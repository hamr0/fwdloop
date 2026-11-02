#!/bin/zsh
# F131: repeat arm-full.sh (new run id each time) until a run reaches its ask and completes, max N tries, stop if spend so far >= $1.50. usage: loop.sh <label> <firstRunNumber> <maxTries>
set -u
label=$1; n=$2; max=$3
i=0
while [ $i -lt $max ]; do
  spent=$(python3 -c "
import json
print(sum(json.loads(l)['spentUsd'] for l in open('$ROOT/exit-walk-1/history.jsonl')))")
  python3 -c "import sys; sys.exit(0 if $spent < 1.5 else 1)" || { echo "BUDGET STOP at $spent"; break; }
  out=$(/home/hamr/PycharmProjects/fwdloop/poc/f131-ba059/arm-full.sh "$label-$n" "run-$n" 2>&1)
  echo "$out" | cut -c1-260 | grep -v OpenAIProvider
  n=$((n+1)); i=$((i+1))
  echo "$out" | grep -q "resume exit=0" && break
done
echo LOOPDONE
