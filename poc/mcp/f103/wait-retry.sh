#!/bin/sh
# detached: the one pre-registered T2 retry, 15 min after look 2; then gh capture, then an immediate look 5 (T3 again)
cd /home/hamr/PycharmProjects/fwdloop
sleep 900
timeout 200 node poc/mcp/f103/look.mjs --tag look2b 2>/dev/null > poc/mcp/f103/out/look2b.json
timeout 60 gh api 'repos/flutter/flutter/issues?state=open&sort=created&direction=desc&per_page=100' > poc/mcp/f103/out/gh-after-look2b.json 2>>poc/mcp/f103/out/gh.err
timeout 200 node poc/mcp/f103/look.mjs --tag look3b 2>/dev/null > poc/mcp/f103/out/look3b.json
echo done > poc/mcp/f103/out/retry.done
