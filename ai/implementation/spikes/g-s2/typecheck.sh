#!/bin/sh
# G-S2: generate the programs and type-check them against the cached SST 4.17.2 platform types.
# Usage: sh typecheck.sh <cached .sst/platform dir>   (no network needed)
set -e
here=$(cd "$(dirname "$0")" && pwd)
root="$here/../../../.."
cd "$here"
node setup-platform.mjs "$1"
"$root/node_modules/.bin/tsx" generate.ts
"$root/node_modules/.bin/tsc" -p tsconfig.typecheck.json
echo "positive: out/sst.config.ts and out/step3/sst.config.ts type-check"
cp negative.sst.config.ts.txt out/negative.sst.config.ts
if "$root/node_modules/.bin/tsc" -p tsconfig.negative.json > logs/typecheck-negative.txt 2>&1; then
  echo "negative control unexpectedly passed"; exit 1
fi
echo "negative control fails as expected:"; cat logs/typecheck-negative.txt
