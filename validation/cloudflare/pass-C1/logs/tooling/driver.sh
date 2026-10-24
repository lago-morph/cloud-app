#!/bin/bash
# Runs the compliance driver against R2 (kept run stage, DEC-0355) with the fetch trace. Usage: driver.sh <label> <driver args...>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/pC1
W=/home/user/cloud-app/.claude/worktrees/agent-ac2d7ebe7faf3d877
cd "$W" || exit 9
L="$1"; shift
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
export NODE_USE_ENV_PROXY=1
export COMPLIANCE_CLOUDFLARE_D1=available
unset COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION COMPLIANCE_DEMO_BASE_URL COMPLIANCE_DEMO_STAGE
export COMPLIANCE_SECRET_API_KEY="$(cat "$P/apikey.secret")"
export FETCH_TRACE_LOG="$P/trace-$L.log"
export NODE_OPTIONS="$NODE_OPTIONS --import=$P/fetch-trace.mjs"
R_URL="$(cat "$P/rurl.txt")"
R="$(cat "$P/stage.txt")"
echo "start $(date -u +%FT%TZ)" > "$P/$L.log"
npm run compliance -- --target cloudflare --base-url "$R_URL" --stage "$R" "$@" >> "$P/$L.log" 2>&1
rc=$?
echo "exit $rc $(date -u +%FT%TZ)" >> "$P/$L.log"
echo "exit $rc"
