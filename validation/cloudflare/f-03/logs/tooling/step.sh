#!/bin/bash
# Runs one framework CLI step from apps/demo with the fetch trace and SST/Pulumi debug logging,
# keeping every version of .sst/log/* files. Uses the environment's CLOUDFLARE_API_TOKEN (DEC-0420).
# Usage: step.sh <label> deploy|secret|remove|smoke <stage>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/f03
W=/home/user/cloud-app/.claude/worktrees/agent-a4665bc84e87d6f2c
APP=demo
cd "$W/apps/$APP" || exit 9
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
export NODE_USE_ENV_PROXY=1
export COMPLIANCE_CLOUDFLARE_D1=available
export SST_VERBOSE=1
export TF_LOG=DEBUG
export FETCH_TRACE_LOG="$P/trace-$1.log"
export NODE_OPTIONS="$NODE_OPTIONS --import=$P/fetch-trace.mjs"
CLI="node ../../packages/framework/bin/prototype-framework.js"
mkdir -p "$W/apps/$APP/.framework/provision/cloudflare/.sst/log"
node "$P/logwatch.mjs" "$W/apps/$APP/.framework/provision/cloudflare/.sst/log" "$P/sstlogs-$1" &
WP=$!
echo "start $(date -u +%FT%TZ)" > "$P/$1.log"
case "$2" in
  deploy) $CLI deploy --target cloudflare --stage "$3" >> "$P/$1.log" 2>&1 ;;
  secret) $CLI secrets set shareKey --target cloudflare --stage "$3" < "$P/sharekey.secret" >> "$P/$1.log" 2>&1 ;;
  remove) $CLI remove --target cloudflare --stage "$3" >> "$P/$1.log" 2>&1 ;;
  smoke) $CLI smoke --target cloudflare --stage "$3" >> "$P/$1.log" 2>&1 ;;
  *) echo bad; kill $WP; exit 2 ;;
esac
rc=$?
sleep 2
kill $WP
echo "exit $rc $(date -u +%FT%TZ)" >> "$P/$1.log"
echo "exit $rc"
