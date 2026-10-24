#!/bin/sh
# G-S2: run both generated programs under Pulumi mocks with no network at all, then the
# structural checks. Usage (after typecheck.sh):
#   unshare -rn sh ../../../../scripts/offline.sh sh mocks.sh
set -e
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
rm -f out/.sst/platform/g-s2-eval.*.mjs
node mocks/run-mocks.mjs out/sst.config.ts logs/mocks-full.json
node mocks/run-mocks.mjs out/step3/sst.config.ts logs/mocks-step3.json
rm -f out/.sst/platform/g-s2-eval.*.mjs
node --test mocks/structure.test.mjs 2>&1 | tee logs/structure-test.txt
