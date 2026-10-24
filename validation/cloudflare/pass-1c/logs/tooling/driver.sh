#!/bin/bash
# Runs the compliance driver against R with the fetch trace. Usage: driver.sh <label> <driver args...>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p1c
W=/home/user/cloud-app/.claude/worktrees/agent-a600b9490db9ad35d
cd "$W" || exit 9
L="$1"; shift
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
export NODE_USE_ENV_PROXY=1
export COMPLIANCE_CLOUDFLARE_D1=available
export COMPLIANCE_SECRET_API_KEY="$(cat "$P/apikey.secret")"
export FETCH_TRACE_LOG="$P/trace-$L.log"
export NODE_OPTIONS="$NODE_OPTIONS --import=$P/fetch-trace.mjs"
R_URL="$(cat "$P/rurl.txt")"
echo "start $(date -u +%FT%TZ)" > "$P/$L.log"
npm run compliance -- --target cloudflare --base-url "$R_URL" --stage test-9mfkg261apxm7s2 "$@" >> "$P/$L.log" 2>&1
rc=$?
echo "exit $rc $(date -u +%FT%TZ)" >> "$P/$L.log"
echo "exit $rc"
