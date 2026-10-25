#!/bin/bash
# Starts driver.sh in its own process group with the budget guard. Usage: launch.sh <max total> <label> <driver args...>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p4d
MAX=$1; shift
setsid bash "$P/driver.sh" "$@" > "$P/launch-$1.out" 2>&1 &
D=$!
sleep 1
bash "$P/guard.sh" "$D" "$MAX" &
G=$!
wait $D
echo "driver done: $(cat "$P/launch-$1.out")"
kill $G 2>/dev/null
python3 -I "$P/count.py" "$P"
