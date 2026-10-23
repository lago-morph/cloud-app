#!/bin/bash
# Generates a dummy value and pipes it on stdin to the documented command; the value is never printed.
cd /home/user/cloud-app/.claude/worktrees/agent-a0cf9fa37f79e1389
node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))" | npm --workspace apps/template run secrets -- set apiKey --target local --stage local
