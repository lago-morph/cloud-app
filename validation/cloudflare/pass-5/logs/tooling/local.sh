#!/bin/bash
# Full local compliance pass. Usage: local.sh
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p5
W=/home/user/cloud-app/.claude/worktrees/agent-afb6e5aea64fb07c4
cd "$W" || exit 9
echo "start $(date -u +%FT%TZ)" > "$P/3-local.log"
npm run compliance -- --target local --only PWD-AC-009,E2E-008,MIG-AC-003,PROV-AC-002,SEC-AC-005,E2E-011,E2E-014,DEMO-AC-008 >> "$P/3-local.log" 2>&1
rc=$?
echo "exit $rc $(date -u +%FT%TZ)" >> "$P/3-local.log"
