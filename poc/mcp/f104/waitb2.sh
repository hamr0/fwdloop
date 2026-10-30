#!/bin/sh
# F104b pre-registered extension: look 4 (>=15 min after look 2), look 5, gh check. Detached.
cd /home/hamr/PycharmProjects/fwdloop
O=poc/mcp/f104/out/b; L=$O/ledger-b.jsonl
W="node poc/mcp/f104/watch.mjs --order UPDATED_AT --ledger $L"
sleep ${F104B_SLEEP:-0}
timeout 200 $W --tag look4 2>/dev/null > $O/look4.json
for n in $(node -e "console.log(require('fs').readFileSync('$L','utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='baseline').map(r=>r.number).join(' '))"); do
  timeout 30 gh api repos/microsoft/vscode/issues/$n --jq '{number,state:(.state|ascii_upcase),labels:[.labels[].name]|sort,updated_at,title,comments}' >> $O/gh-after-look4.jsonl 2>>$O/gh.err
done
timeout 200 $W --tag look5 2>/dev/null > $O/look5.json
echo done > $O/done2
