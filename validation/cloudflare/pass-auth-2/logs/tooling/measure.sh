#!/bin/bash
# D1 usage (GraphQL d1AnalyticsAdaptiveGroups, today 2026-10-25 UTC), D1 database list, sst-state objects,
# prototype-mailsink objects (emails delivered to the sink), and with "inventory" Workers and R2 buckets.
# Raw bodies stay in raw/; every request is written to ledger.txt. Usage: measure.sh <label> [inventory]
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/pAuth2
S=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad
A="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
L="$P/ledger.txt"
H="Authorization: Bearer $CLOUDFLARE_API_TOKEN"
sed -e 's/date_geq:\\"2026-10-18\\"/date:\\"2026-10-25\\"/' "$S/d1q.json" > "$P/d1q-today.json"
grep -q 'date:\\"2026-10-25\\"' "$P/d1q-today.json" || { echo "query edit failed"; exit 3; }
req() { # label method url outfile [curl args...]
  local lab=$1 m=$2 u=$3 o=$4; shift 4
  local c; c=$(curl -sS -o "$P/raw/$o" -w '%{http_code}' -X "$m" "$@" -H "$H" "$u")
  local short=${u#"$A"/}; short=${short#https://api.cloudflare.com/client/v4/}; short=${short%%\?*}
  echo "$(date -u +%FT%TZ) $lab $m $short -> $c" >> "$L"
  if [ "$c" = 429 ]; then echo "HTTP 429 - STOP"; exit 42; fi
}
req "$1" POST https://api.cloudflare.com/client/v4/graphql "d1-$1.json" -H 'Content-Type: application/json' --data "@$P/d1q-today.json"
req "$1" GET "$A/d1/database?per_page=100" "d1list-$1.json"
req "$1" GET "$A/r2/buckets/sst-state/objects?per_page=1000" "sststate-$1.json"
req "$1" GET "$A/r2/buckets/prototype-mailsink/objects?per_page=1000" "mailsink-$1.json"
if [ "$2" = inventory ]; then
  req "$1" GET "$A/workers/scripts" "workers-$1.json"
  req "$1" GET "$A/r2/buckets" "buckets-$1.json"
fi
python3 -I "$P/summarize.py" "$P" "$1"
