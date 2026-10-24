#!/bin/bash
# E2E-011 troubleshooting check: one throw-plain request on R (workers.dev), then the two curl
# commands of skill/reference/troubleshooting.md §1 (Cloudflare, command line) as written. Output redacted.
P=/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p25
L="$P/5-trouble.log"; LED="$P/ledger.txt"
R_URL="$(cat "$P/rurl.txt")"
red() { sed -E -e "s#$CLOUDFLARE_ACCOUNT_ID#<ACCOUNT>#g" -e 's#[a-z0-9-]+\.workers\.dev#<SUBDOMAIN>.workers.dev#g' -e 's/[0-9a-f]{32}/<HEX32>/g'; }
echo "start $(date -u +%FT%TZ)" > "$L"
body=$(curl -sS -H 'User-Agent: compliance-runner' "$R_URL/api/ref/throw-plain")
echo "GET /api/ref/throw-plain -> $body" | red >> "$L"
RID=$(printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s);console.log(r.requestId??r.error?.requestId??"")}catch{console.log("")}})')
echo "requestId=$RID" >> "$L"
[ -n "$RID" ] || { echo "no requestId" >> "$L"; echo "exit 4"; exit 4; }
sleep 10
APP=reference; STAGE='test-9mfkg261apxm7s2'; DAY=$(date -u +%Y/%m/%d)
echo "--- command 1 (list day's keys) | grep requestId" >> "$L"
KEYS=$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/prototype-logs/objects?per_page=1000&prefix=$APP/$STAGE/$DAY/" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!r.success){console.error(JSON.stringify(r.errors));process.exit(1)}for(const o of r.result)console.log(o.key)})' 2>&1)
rc=$?
echo "$(date -u +%FT%TZ) trouble GET r2/buckets/prototype-logs/objects (troubleshooting 1, command 1) rc=$rc" >> "$LED"
echo "rc=$rc keys-listed=$(printf '%s\n' "$KEYS" | grep -c .)" >> "$L"
M=$(printf '%s\n' "$KEYS" | grep -- "$RID")
echo "match: $M" | red >> "$L"
KEY=$(printf '%s\n' "$M" | head -1)
[ -n "$KEY" ] || { echo "no matching key" >> "$L"; echo "exit 5"; exit 5; }
echo "--- command 2 (read entry)" >> "$L"
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/prototype-logs/objects/$(node -p 'encodeURIComponent(process.argv[1])' "$KEY")" | red >> "$L"
rc=$?
echo >> "$L"
echo "$(date -u +%FT%TZ) trouble GET r2/buckets/prototype-logs/objects/<key> (troubleshooting 1, command 2) rc=$rc" >> "$LED"
echo "exit $rc $(date -u +%FT%TZ)" >> "$L"; echo "exit $rc"
