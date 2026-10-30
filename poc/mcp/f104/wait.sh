#!/bin/sh
# F104 look 2 (>=15 min after look 1) and look 3, then the independent gh check. Detached.
cd /home/hamr/PycharmProjects/fwdloop
O=poc/mcp/f104/out
sleep ${F104_SLEEP:-960}
timeout 200 node poc/mcp/f104/watch.mjs --tag look2 2>/dev/null > $O/look2.json
for n in $(node -e "console.log(require('fs').readFileSync('$O/ledger.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='baseline').map(r=>r.number).join(' '))"); do
  timeout 30 gh api repos/microsoft/vscode/issues/$n --jq '{number,state:(.state|ascii_upcase),labels:[.labels[].name]|sort,updated_at,title,comments}' >> $O/gh-after-look2.jsonl 2>>$O/gh.err
done
timeout 200 node poc/mcp/f104/watch.mjs --tag look3 2>/dev/null > $O/look3.json
echo done > $O/done
