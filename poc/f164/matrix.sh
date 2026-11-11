#!/usr/bin/env bash
# F164: $0 matrix. prose+page from X, map answer (saved mapping) from Y, code from a repo root. usage: matrix.sh <wt07159e8> <wt02fb8bd>
set -u
D=$HOME/.config/fwdloop/flows/.drafts
declare -A P=([G]=$D/d-00mw2arrv2-648e/draft [T]=$D/d-00mw9p09f3-9c72/draft-1 [O]=$D/d-00mvmev44n-19bb/draft)
R=$(cd "$(dirname "$0")/../.." && pwd)
for code in "$R" "$1"; do
 for combo in "G G" "G T" "T G" "T T" "G O" "O O" "O T"; do
  set -- $combo
  echo "== code=$(basename $code) prose+page=$1 map=$2"
  timeout 60 node "$R/poc/f164/replay.mjs" "$code" "${P[$1]}" "$R/poc/f164/out/m-$(basename $code)-$1-$2" "mapdir=${P[$2]}" | cut -c1-1000
 done
done
