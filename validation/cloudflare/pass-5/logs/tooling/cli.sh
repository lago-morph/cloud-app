#!/bin/bash
# Runs the framework CLI from an app directory with the fetch trace (trace-<label>.log), under the
# environment's CLOUDFLARE_API_TOKEN. Output to <label>.log. Usage: cli.sh <label> <app> <cli args...>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p5
W=/home/user/cloud-app/.claude/worktrees/agent-afb6e5aea64fb07c4
L="$1"; APP="$2"; shift 2
cd "$W/apps/$APP" || exit 9
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
export NODE_USE_ENV_PROXY=1
export FETCH_TRACE_LOG="$P/trace-$L.log"
export NODE_OPTIONS="$NODE_OPTIONS --import=$P/fetch-trace.mjs"
echo "start $(date -u +%FT%TZ) $*" >> "$P/$L.log"
node "$W/packages/framework/bin/prototype-framework.js" "$@" >> "$P/$L.log" 2>&1 < "${CLI_STDIN:-/dev/null}"
rc=$?
echo "exit $rc $(date -u +%FT%TZ)" >> "$P/$L.log"
echo "exit $rc"
