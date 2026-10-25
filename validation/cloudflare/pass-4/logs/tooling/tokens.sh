#!/bin/bash
# Lists the account's API tokens: names, status and expiry only (never ids or values); one request
# per page, each in ledger.txt. Usage: tokens.sh <label>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p4
A="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
H="Authorization: Bearer $CLOUDFLARE_API_TOKEN"
page=1
while :; do
  c=$(curl -sS -o "$P/raw/tokens-$1-$page.json" -w '%{http_code}' -H "$H" "$A/tokens?per_page=50&page=$page")
  echo "$(date -u +%FT%TZ) $1 GET tokens -> $c" >> "$P/ledger.txt"
  [ "$c" = 429 ] && { echo "HTTP 429 - STOP"; exit 42; }
  tp=$(python3 -I -c '
import json,sys
d=json.load(open(sys.argv[1]))
if not d.get("success"): print("errors:", [e.get("code") for e in d.get("errors") or []], [e.get("message") for e in d.get("errors") or []], file=sys.stderr)
for t in d.get("result") or []: print("  ", t.get("name"), "|", t.get("status"), "| expires", t.get("expires_on"), "| modified", t.get("modified_on"), file=sys.stderr)
print((d.get("result_info") or {}).get("total_pages") or 1)' "$P/raw/tokens-$1-$page.json")
  [ "$page" -ge "$tp" ] && break
  page=$((page+1))
done
