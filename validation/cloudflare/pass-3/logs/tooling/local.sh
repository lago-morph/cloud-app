#!/bin/bash
# Full local compliance pass. Usage: local.sh
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p3
W=/home/user/cloud-app/.claude/worktrees/agent-afb6e5aea64fb07c4
cd "$W" || exit 9
echo "start $(date -u +%FT%TZ)" > "$P/local.log"
npm run compliance -- --target local >> "$P/local.log" 2>&1
rc=$?
echo "exit $rc $(date -u +%FT%TZ)" >> "$P/local.log"
