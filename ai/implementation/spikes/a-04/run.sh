#!/usr/bin/env bash
# A-04 spike driver. Usage: ./run.sh <step> [args]
# Wrangler environment exactly as A-01 recorded (placeholder token replaced by the proxy).
# Raw output goes to logs/<name>.raw and is redacted into logs/<name>.txt by redact.py.
# Runtime-only values (KV id, account subdomain) live in $SCRATCH, never in committed files.
set -u
cd "$(dirname "$0")"
SCRATCH=${SCRATCH:?set SCRATCH to a private scratch dir}
P=spikeqgbznvyy
W=$P-a04-worker
API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
export A04_SUBDOMAIN="$(cat "$SCRATCH/sub" 2>/dev/null || true)"

wr() {
  CI=1 CLOUDFLARE_API_TOKEN=proxy-injected CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
    NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt ./node_modules/.bin/wrangler "$@"
}
# Cloudflare API through the proxy; no Authorization header is sent (the proxy injects the token).
api() { local m=$1 p=$2; shift 2; curl -sS -X "$m" "$API$p" -H 'content-type: application/json' "$@"; echo; }
url() { echo "https://$W.$A04_SUBDOMAIN.workers.dev"; }
log() { local n=$1; shift; { echo "\$ $*"; "$@"; echo "exit=$?"; } > "logs/$n.raw" 2>&1; python3 redact.py "logs/$n.raw"; }
now() { date -u +%H:%M:%S.%3N; }

# Probe the URL every ~0.5 s until the HTTP status equals $1 for $2 consecutive requests (max $3 s).
# Prints one line per status change, then the time of the first request in the stable run.
probe_until() {
  local want=$1 need=$2 max=$3 start=$(date +%s.%N) ok=0 last="" first_ok=""
  while :; do
    local t=$(date +%s.%N) code
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$(url)/probe?$RANDOM" 2>&1 | tail -c 3)
    local el=$(python3 -c "print(f'{$t-$start:.2f}')")
    [[ "$code" != "$last" ]] && echo "t+${el}s status=$code" && last=$code
    if [[ "$code" == "$want" ]]; then [[ $ok -eq 0 ]] && first_ok=$el; ok=$((ok+1)); else ok=0; fi
    if [[ $ok -ge $need ]]; then echo "stable: $need consecutive $want from t+${first_ok}s"; return 0; fi
    if python3 -c "import sys; sys.exit(0 if $t-$start>$max else 1)"; then echo "TIMEOUT after ${max}s (last=$code)"; return 1; fi
    sleep 0.5
  done
}

case "$1" in
  kv-create) wr kv namespace create $P-a04-kv ;;
  gen-config) sed "s/__KV_ID__/$(cat "$SCRATCH/kvid")/" worker/wrangler.template.jsonc > worker/wrangler.gen.jsonc ;;
  kv-put) wr kv key put probe kv-value-a04 --namespace-id "$(cat "$SCRATCH/kvid")" --remote ;;
  deploy) wr deploy -c worker/wrangler.gen.jsonc ;;
  secret-put) printf '%s' "$(cat "$SCRATCH/secret")" | wr secret put SPIKE_SECRET -c worker/wrangler.gen.jsonc ;;
  secret-list) wr secret list -c worker/wrangler.gen.jsonc ;;
  get) curl -sS -w '\nhttp=%{http_code}\n' --max-time 15 "$(url)/${2:-get}" ;;
  sub-get) api GET "/workers/scripts/$W/subdomain" ;;
  sub-set) api POST "/workers/scripts/$W/subdomain" --data "$2" ;;
  sub-delete) api DELETE "/workers/scripts/$W/subdomain" ;;
  settings) api GET "/workers/scripts/$W/settings" ;;
  deployments) api GET "/workers/scripts/$W/deployments" ;;
  versions) api GET "/workers/scripts/$W/versions" ;;
  scripts) api GET "/workers/scripts" ;;
  kv-list) api GET "/storage/kv/namespaces?per_page=100" ;;
  probe) probe_until "$2" "$3" "$4" ;;
  # turn the workers.dev route off/on with body $2, then measure propagation to status $3
  toggle)
    echo "request sent at $(now) UTC: POST /workers/scripts/$W/subdomain $2"
    api POST "/workers/scripts/$W/subdomain" --data "$2"
    echo "API returned at $(now) UTC; probing every 0.5 s (t=0 = API return)"
    probe_until "$3" "${4:-10}" "${5:-300}"
    echo "GET subdomain after: $(api GET "/workers/scripts/$W/subdomain" | tr -d '\n ')" ;;
  now) now ;;
  expected-sha) printf 'expected secret sha8=%s\n' "$(printf '%s' "$(cat "$SCRATCH/secret")" | sha256sum | cut -c1-8)" ;;
  delete) wr delete -c worker/wrangler.gen.jsonc --force ;;
  kv-delete) wr kv namespace delete --namespace-id "$(cat "$SCRATCH/kvid")" ;;
  log) shift; log "$@" ;;
  # cycles <from> <to>: off/on with previews_enabled pinned to false, logged as t<n>a/t<n>b
  cycles)
    for n in $(seq "$2" "$3"); do
      log "t$(printf %02d "$n")a-off" ./run.sh toggle '{"enabled":false,"previews_enabled":false}' 404 | grep -E 'status=|stable|TIMEOUT|after:'
      log "t$(printf %02d "$n")b-on" ./run.sh toggle '{"enabled":true,"previews_enabled":false}' 200 | grep -E 'status=|stable|TIMEOUT|after:'
    done ;;
  *) echo "unknown step $1"; exit 2 ;;
esac
