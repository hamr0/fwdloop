#!/bin/sh
cd /home/hamr/PycharmProjects/fwdloop
O=poc/mcp/f103/out; L="--repo microsoft/vscode --ledger $O/ledger-vscode.jsonl"
sleep 960
timeout 200 node poc/mcp/f103/look.mjs $L --tag v-look2 2>/dev/null > $O/v-look2.json
timeout 60 gh api 'repos/microsoft/vscode/issues?state=open&sort=created&direction=desc&per_page=100' > $O/gh-vscode-after-look2.json 2>>$O/gh.err
timeout 200 node poc/mcp/f103/look.mjs $L --tag v-look3 2>/dev/null > $O/v-look3.json
echo done > $O/vscode.done
