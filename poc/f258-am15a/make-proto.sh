#!/bin/sh
# F258: build a prototype root = a copy of src/ + package.json with a patch applied. usage: make-proto.sh <ABSOLUTE repo> <destRoot> <p257|p15a>
set -e
repo="$1"; dest="$2"; arm="$3"
case "$repo" in /*) ;; *) echo "repo path must be absolute" >&2; exit 2;; esac
case "$arm" in p257) patch="$repo/poc/f257-am15/proto.patch";; p15a) patch="$repo/poc/f258-am15a/proto2.patch";; *) echo "arm p257|p15a" >&2; exit 2;; esac
rm -rf "$dest"; mkdir -p "$dest"
cp -r "$repo/src" "$dest/src"; cp "$repo/package.json" "$dest/package.json"
ln -s "$repo/node_modules" "$dest/node_modules"
cd "$dest"
git apply -p1 "$patch"
if grep -rq NO_GUARDRAIL_WORDS "$dest/src"; then echo "PATCH NOT APPLIED: NO_GUARDRAIL_WORDS still in $dest/src" >&2; exit 3; fi
# harness-only export (not part of the change set): the draft's own assembly, for plans an old build saved
echo "export const __assembleAgain = assembleAgain;" >> "$dest/src/planrebuild.js"
echo "built $arm at $dest"
