#!/bin/bash
O=/home/user/cloud-app/.claude/worktrees/agent-a9f3ccd5377c6b7ad/validation/local/phase-B
S=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad
# Compare the two offline verify runs, ignoring only the runner's own start/end timestamp lines and the log-name line.
grep -v -e "^# start:" -e "^# end:" $O/12-offline-verify-run1.log > $S/r1
grep -v -e "^# start:" -e "^# end:" $O/13-offline-verify-run2.log > $S/r2
{
  echo "\$ diff <(12-offline-verify-run1.log minus '# start:'/'# end:' lines) <(13-offline-verify-run2.log minus same)"
  diff $S/r1 $S/r2
  echo "# diff exit code: $?  (0 = identical)"
} > $O/14-offline-verify-diff.txt
cat $O/14-offline-verify-diff.txt
