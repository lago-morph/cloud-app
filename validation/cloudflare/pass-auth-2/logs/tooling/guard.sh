#!/bin/bash
# Budget guard: every 5 s counts requests (count.py); on any HTTP 429, total > $2, or > 950 in
# 5 minutes, kills the process group $1 (the driver) and writes guard.txt. Usage: guard.sh <pgid> <max total>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/pAuth2
while kill -0 -- "-$1" 2>/dev/null; do
  j=$(python3 -I "$P/count.py" "$P" --json)
  t=$(echo "$j" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(d["total"], d["max5min"], d["http429"])')
  set -- "$1" "$2" $t
  echo "$(date -u +%FT%TZ) total $3 max5min $4 429s $5" > "$P/guard-last.txt"
  if [ "$5" -gt 0 ] || [ "$3" -gt "$2" ] || [ "$4" -gt 950 ]; then
    echo "$(date -u +%FT%TZ) STOP: total $3 max5min $4 429s $5; killing group $1" >> "$P/guard.txt"
    kill -TERM -- "-$1"; sleep 5; kill -KILL -- "-$1" 2>/dev/null
    exit 1
  fi
  sleep 5
done
