#!/bin/bash
# Runs the compliance driver with no run stage (DEC-0355) against the demo stage D through
# COMPLIANCE_DEMO_BASE_URL, with the fetch trace. Usage: driver.sh <label> [stage] <driver args...>
# With "stage" as the second argument, COMPLIANCE_DEMO_STAGE is also set (DEMO-AC-008).
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/f03
W=/home/user/cloud-app/.claude/worktrees/agent-a4665bc84e87d6f2c
cd "$W" || exit 9
L="$1"; shift
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
export NODE_USE_ENV_PROXY=1
export COMPLIANCE_CLOUDFLARE_D1=available
unset COMPLIANCE_SECRET_API_KEY COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION COMPLIANCE_DEMO_STAGE
export COMPLIANCE_DEMO_BASE_URL="$(cat "$P/durl.txt")"
if [ "$1" = stage ]; then export COMPLIANCE_DEMO_STAGE="$(cat "$P/stage.txt")"; shift; fi
export FETCH_TRACE_LOG="$P/trace-$L.log"
export NODE_OPTIONS="$NODE_OPTIONS --import=$P/fetch-trace.mjs"
echo "start $(date -u +%FT%TZ) demo-stage-env=${COMPLIANCE_DEMO_STAGE:+set} args: $*" > "$P/$L.log"
npm run compliance -- --target cloudflare --base-url https://no-run-stage.invalid "$@" >> "$P/$L.log" 2>&1
rc=$?
echo "exit $rc $(date -u +%FT%TZ)" >> "$P/$L.log"
echo "exit $rc"
