#!/bin/bash
# Runs the compliance driver with no run stage (DEC-0355) and the fetch trace. Usage: driver.sh <label> <driver args...>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/pB
W=/home/user/cloud-app/.claude/worktrees/agent-a21ab580ba6ff1fff
cd "$W" || exit 9
L="$1"; shift
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
export NODE_USE_ENV_PROXY=1
export COMPLIANCE_CLOUDFLARE_D1=available
unset COMPLIANCE_SECRET_API_KEY COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION
export FETCH_TRACE_LOG="$P/trace-$L.log"
export NODE_OPTIONS="$NODE_OPTIONS --import=$P/fetch-trace.mjs"
echo "start $(date -u +%FT%TZ)" > "$P/$L.log"
npm run compliance -- --target cloudflare --base-url https://no-run-stage.invalid "$@" >> "$P/$L.log" 2>&1
rc=$?
echo "exit $rc $(date -u +%FT%TZ)" >> "$P/$L.log"
echo "exit $rc"
