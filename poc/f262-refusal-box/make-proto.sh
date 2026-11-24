#!/bin/sh
# F262: build the prototype root = a tracked-files copy of the repo with proto.patch applied. usage: make-proto.sh <ABSOLUTE repo> <destRoot>
set -e
repo="$1"; dest="$2"
case "$repo" in /*) ;; *) echo "repo path must be absolute" >&2; exit 2;; esac
rm -rf "$dest"; mkdir -p "$dest"
cd "$repo" && git ls-files -z | tar --null -T - -cf - | tar -xf - -C "$dest"
ln -s "$repo/node_modules" "$dest/node_modules"
cd "$dest" && git apply -p1 "$repo/poc/f262-refusal-box/proto.patch"
cp "$repo/poc/f262-refusal-box/f262.test.mjs" "$dest/test/f262.test.mjs"
