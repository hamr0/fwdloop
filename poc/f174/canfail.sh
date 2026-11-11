#!/bin/sh
# F174 can-fail: plant one Q7 re-ask and one Q3 split in a mkdtemp copy; the script must count them; then break one line of the detector and the plant must be missed.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
S="$T/s/flows/.drafts/d-plant"
mkdir -p "$S/draft" "$S/draft-1" "$S/draft-2"
Q='{"questions":[{"line":3,"question":"q","source":"look","ask":"cant-check","ruleNo":1,"ruleText":"no red-eye flights"}]}'
echo "$Q" > "$S/draft/questions.json"
echo '{"k":1,"line":3,"answer":"drop it","rule":null}' > "$S/draft/answer-1.json"
echo '{}' > "$S/card-1.json"; echo '{}' > "$S/redraft-1.json"; echo '{}' > "$S/card-2.json"   # draft-1 = answer redraft, draft-2 = Revise
echo "$Q" > "$S/draft-2/questions.json"                                                       # the planted re-ask
F="$T/f/planted"
mkdir -p "$F/runs/run-1" "$F/signed"
echo '{}' > "$F/signature.json"
echo '{"steps":[{"fromLine":2,"emits":"st","close":{"class":"green","picked":[{"rule":"listItems","value":3}],"cited":{"source":"s","count":{"min":3,"max":3},"facts":[]}}}]}' > "$F/signed/declaration.json"
echo '{"attempts":[{"step":"st","attempt":1,"verdict":"red","gap":"not met: exactly 3 list items (found 0)"}]}' > "$F/runs/run-1/log.json"
echo '{"cited":{"lines":[{"n":2,"passed":true}]}}' > "$F/runs/run-1/line-checks.json"
run() { node -e "import('$1').then(m=>{const a=m.q7(['$T/s']),b=m.q3(['$T/f']);console.log('Q7 cases',a.cases.length,'reasks',a.reasks.length,a.verdict,'| Q3 pairs',b.pairs.length,'split',b.split,b.harm)})"; }
echo "intact:"; run "$HERE/study.mjs"
cp "$HERE/study.mjs" "$T/broken.mjs"
sed -i 's/norm(x.ruleText) === norm(dr.ruleText)/norm(x.ruleText) !== norm(dr.ruleText)/; s/lineRow?.passed === true/lineRow?.passed === false/' "$T/broken.mjs"
echo "broken (one line each):"; run "$T/broken.mjs"
