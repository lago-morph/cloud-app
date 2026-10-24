#!/bin/bash
# D1 usage (GraphQL, today 2026-10-24 UTC), D1 database list, sst-state objects, and optionally
# Workers and R2 buckets. Sends Authorization: Bearer $CLOUDFLARE_API_TOKEN (DEC-0420). Raw bodies stay here.
# Usage: measure.sh <label> [inventory]
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p1c
S=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad
A="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
L="$P/ledger.txt"
H="Authorization: Bearer $CLOUDFLARE_API_TOKEN"
sed -e 's/date_geq:\\"2026-10-18\\"/date:\\"2026-10-24\\"/' "$S/d1q.json" > "$P/d1q-today.json"
grep -q 'date:\\"2026-10-24\\"' "$P/d1q-today.json" || { echo "query edit failed"; exit 3; }
c=$(curl -sS -o "$P/raw/d1-$1.json" -w '%{http_code}' -X POST https://api.cloudflare.com/client/v4/graphql -H "$H" -H 'Content-Type: application/json' --data "@$P/d1q-today.json")
echo "$(date -u +%FT%TZ) $1 POST graphql (d1AnalyticsAdaptiveGroups) -> $c" >> "$L"
c=$(curl -sS -o "$P/raw/d1list-$1.json" -w '%{http_code}' -H "$H" "$A/d1/database?per_page=100")
echo "$(date -u +%FT%TZ) $1 GET d1/database -> $c" >> "$L"
c=$(curl -sS -o "$P/raw/sststate-$1.json" -w '%{http_code}' -H "$H" "$A/r2/buckets/sst-state/objects?per_page=1000")
echo "$(date -u +%FT%TZ) $1 GET r2/buckets/sst-state/objects -> $c" >> "$L"
if [ "$2" = inventory ]; then
  c=$(curl -sS -o "$P/raw/workers-$1.json" -w '%{http_code}' -H "$H" "$A/workers/scripts")
  echo "$(date -u +%FT%TZ) $1 GET workers/scripts -> $c" >> "$L"
  c=$(curl -sS -o "$P/raw/buckets-$1.json" -w '%{http_code}' -H "$H" "$A/r2/buckets")
  echo "$(date -u +%FT%TZ) $1 GET r2/buckets -> $c" >> "$L"
fi
python3 -I - "$P" "$1" <<'PYEOF'
import json,sys,os
P,l=sys.argv[1],sys.argv[2]
d=json.load(open(f"{P}/raw/d1-{l}.json"))
if d.get("errors"): print("graphql errors:", d["errors"])
g=d["data"]["viewer"]["accounts"][0]["d1AnalyticsAdaptiveGroups"]
r=sum(x["sum"]["rowsRead"] for x in g); w=sum(x["sum"]["rowsWritten"] for x in g)
print("D1 today: groups",len(g),"rowsRead",r,"rowsWritten",w)
d=json.load(open(f"{P}/raw/d1list-{l}.json"))
print("D1 databases:", len(d.get("result") or []), [x.get("name") for x in d.get("result") or []])
d=json.load(open(f"{P}/raw/sststate-{l}.json"))
print("sst-state objects:", [x.get("key") for x in d.get("result") or []])
for k in ("workers","buckets"):
    f=f"{P}/raw/{k}-{l}.json"
    if os.path.exists(f):
        d=json.load(open(f)); res=d.get("result")
        if k=="buckets": res=(res or {}).get("buckets",[])
        print(k+":", [x.get("id") or x.get("name") for x in res or []])
PYEOF
