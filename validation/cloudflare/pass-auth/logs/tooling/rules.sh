#!/bin/bash
# Reads the shareplay.com zone's Email Routing rules (2 requests, ledger). Prints rule matchers/actions only.
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/pAuth
H="Authorization: Bearer $CLOUDFLARE_API_TOKEN"
B=https://api.cloudflare.com/client/v4
c=$(curl -sS -o "$P/raw/zone-$1.json" -w '%{http_code}' -H "$H" "$B/zones?name=shareplay.com")
echo "$(date -u +%FT%TZ) $1 GET zones?name -> $c" >> "$P/ledger.txt"
Z=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["result"][0]["id"])' "$P/raw/zone-$1.json")
c=$(curl -sS -o "$P/raw/rules-$1.json" -w '%{http_code}' -H "$H" "$B/zones/$Z/email/routing/rules")
echo "$(date -u +%FT%TZ) $1 GET zones/<ZONE>/email/routing/rules -> $c" >> "$P/ledger.txt"
python3 -I -c '
import json,sys
d=json.load(open(sys.argv[1]))
for r in d.get("result") or []: print(r.get("enabled"), r.get("matchers"), [(a.get("type"), a.get("value")) for a in r.get("actions",[])], r.get("tag","")[:0])
' "$P/raw/rules-$1.json"
