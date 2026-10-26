#!/bin/bash
# Runs the compliance driver with the fetch trace, keeping every version of the reference app's
# .sst/log/* files. Uses the environment's CLOUDFLARE_API_TOKEN. Usage: driver.sh <label> <driver args...>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p3
W=/home/user/cloud-app/.claude/worktrees/agent-afb6e5aea64fb07c4
cd "$W" || exit 9
L="$1"; shift
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
export NODE_USE_ENV_PROXY=1
export COMPLIANCE_CLOUDFLARE_D1=available
unset COMPLIANCE_SECRET_API_KEY COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_EMAIL_PERMISSION COMPLIANCE_DEMO_BASE_URL COMPLIANCE_DEMO_STAGE COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT
export FETCH_TRACE_LOG="$P/trace-$L.log"
export NODE_OPTIONS="$NODE_OPTIONS --import=$P/fetch-trace.mjs"
mkdir -p "$W/apps/reference/.framework/provision/cloudflare/.sst/log"
node "$P/logwatch.mjs" "$W/apps/reference/.framework/provision/cloudflare/.sst/log" "$P/sstlogs-$L" &
WP=$!
echo "start $(date -u +%FT%TZ)" > "$P/$L.log"
npm run compliance -- --target cloudflare "$@" >> "$P/$L.log" 2>&1
rc=$?
sleep 2
kill $WP
echo "exit $rc $(date -u +%FT%TZ)" >> "$P/$L.log"
echo "exit $rc"
