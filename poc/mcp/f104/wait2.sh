#!/bin/sh
# F104 pre-registered extension: look 4 (>=15 min after look 2), gh check, look 5.
cd /home/hamr/PycharmProjects/fwdloop
O=poc/mcp/f104/out/r2
sleep ${F104_SLEEP:-960}
timeout 200 node poc/mcp/f104/watch.mjs --tag look4 2>/dev/null > $O/look4.json
for n in $(node -e "console.log(require('fs').readFileSync('poc/mcp/f104/out/ledger.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='baseline').map(r=>r.number).join(' '))"); do
  timeout 30 gh api repos/microsoft/vscode/issues/$n --jq '{number,state:(.state|ascii_upcase),labels:[.labels[].name]|sort,updated_at,title,comments}' >> $O/gh-after-look4.jsonl 2>>$O/gh.err
done
timeout 200 node poc/mcp/f104/watch.mjs --tag look5 2>/dev/null > $O/look5.json
echo done > $O/done
