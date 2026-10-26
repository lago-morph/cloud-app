#!/bin/bash
# Runs ticket.mts against an origin with the fetch trace. Usage: ticket.sh <label> <origin>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p5
W=/home/user/cloud-app/.claude/worktrees/agent-afb6e5aea64fb07c4
cd "$W" || exit 9
export NODE_USE_ENV_PROXY=1 COMPLIANCE_TARGET=cloudflare CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
export FETCH_TRACE_LOG="$P/trace-$1.log"
export NODE_OPTIONS="$NODE_OPTIONS --import=$P/fetch-trace.mjs"
npx tsx "$P/ticket.mts" "$2" 2>&1 | grep -v "UNDICI\|trace-warn\|ExperimentalWarning" | tail -20
