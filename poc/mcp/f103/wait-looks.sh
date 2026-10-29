#!/bin/sh
# detached: wait >=15 min after look 1, then look 2, gh capture, look 3
cd /home/hamr/PycharmProjects/fwdloop
sleep 960
timeout 200 node poc/mcp/f103/look.mjs --tag look2 2>/dev/null > poc/mcp/f103/out/look2.json
timeout 60 gh api 'repos/flutter/flutter/issues?state=open&sort=created&direction=desc&per_page=100' > poc/mcp/f103/out/gh-after-look2.json 2>poc/mcp/f103/out/gh.err
timeout 200 node poc/mcp/f103/look.mjs --tag look3 2>/dev/null > poc/mcp/f103/out/look3.json
echo done > poc/mcp/f103/out/wait.done
