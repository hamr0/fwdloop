#!/bin/sh
# F257: build the prototype root = a copy of src/ + package.json with proto.patch applied. usage: make-proto.sh <repo> <destRoot>
set -e
repo="$1"; dest="$2"
rm -rf "$dest"; mkdir -p "$dest"
cp -r "$repo/src" "$dest/src"; cp "$repo/package.json" "$dest/package.json"
ln -s "$repo/node_modules" "$dest/node_modules"
cd "$dest" && git apply -p1 "$repo/poc/f257-am15/proto.patch"
