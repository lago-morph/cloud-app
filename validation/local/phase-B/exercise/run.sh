#!/bin/bash
# Usage: run.sh <logname> <command...>   (runs in the worktree, logs to validation/local/phase-B/<logname>.log)
W=/home/user/cloud-app/.claude/worktrees/agent-a9f3ccd5377c6b7ad
O=$W/validation/local/phase-B
name=$1; shift
cd $W
log=$O/$name.log
{
  echo "\$ cd $W"
  echo "\$ $*"
  echo "# start: $(date -u +%FT%TZ)"
} > $log
"$@" >> $log 2>&1
rc=$?
{
  echo "# end: $(date -u +%FT%TZ)"
  echo "# exit code: $rc"
} >> $log
echo "$name $rc" >> $O/exit-codes.txt
echo "exit=$rc"
tail -25 $log
