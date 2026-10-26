#!/bin/bash
# Deletes the one account API token with exactly the given name (refuses on 0 or several matches).
# Prints the name and status only. Usage: deltoken.sh <label> <exact token name>
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p4d
A="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
H="Authorization: Bearer $CLOUDFLARE_API_TOKEN"
c=$(curl -sS -o "$P/raw/tokens-$1.json" -w '%{http_code}' -H "$H" "$A/tokens?per_page=50")
echo "$(date -u +%FT%TZ) $1 GET tokens -> $c" >> "$P/ledger.txt"
ID=$(python3 -I -c '
import json,sys
d=json.load(open(sys.argv[1])); m=[t["id"] for t in d.get("result") or [] if t.get("name")==sys.argv[2]]
print(m[0] if len(m)==1 else "")' "$P/raw/tokens-$1.json" "$2")
[ -z "$ID" ] && { echo "no single token named $2; nothing deleted"; exit 1; }
c=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H "$H" "$A/tokens/$ID")
echo "$(date -u +%FT%TZ) $1 DELETE tokens/<id of $2> -> $c" >> "$P/ledger.txt"
echo "deleted token $2 -> HTTP $c"
