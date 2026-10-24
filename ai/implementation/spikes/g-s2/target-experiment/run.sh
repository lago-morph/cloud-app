#!/bin/sh
# Usage: OFFLINE=1 TGT_DIR=<dir> unshare -rn sh run.sh <log> <sst args...>   (env V_* select inputs)
# Runs the pinned SST offline (no network namespace), with AWS credentials removed.
log="$1"; shift
[ "$OFFLINE" = 1 ] && python3 -I /home/user/cloud-app/.claude/worktrees/agent-a641b5346ed069304/scripts/lo-up.py
cd "${TGT_DIR:?set TGT_DIR to a scratch copy of this directory with .sst/platform linked and sst install run once online}" || exit 1
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE SST_TELEMETRY_DISABLED=1 NO_COLOR=1 \
  /home/user/cloud-app/.claude/worktrees/agent-a641b5346ed069304/node_modules/sst-linux-x64/bin/sst "$@" --print-logs > "$log" 2>&1
code=$?
echo "exit $code"
grep -E "Target not found|Created|Updated|Replaced|Deleted|Complete|✕|Error|error:|\+ |~ |- |\+-" "$log" | grep -v "level=" | head -40
