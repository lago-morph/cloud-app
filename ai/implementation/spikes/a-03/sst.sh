#!/usr/bin/env bash
# Usage: sst.sh <label> <sst args...>
# Runs SST from sst-app/ with stage a03 in exactly the A-01 environment:
#   CLOUDFLARE_API_TOKEN=proxy-injected (non-secret placeholder, replaced by the proxy),
#   CLOUDFLARE_DEFAULT_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID, SST_STAGE, HTTPS_PROXY (sandbox default).
# A03_VARIANT / A03_KEEP pass through to sst.config.ts.
# Output is captured to logs/<label>.txt, redacted.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/sst-app"
label="$1"; shift
export A03_SUBDOMAIN="${A03_SUBDOMAIN:-$(curl -sS "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["result"]["subdomain"])')}"
export CI=1 SST_STAGE=a03 CLOUDFLARE_API_TOKEN=proxy-injected
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
# ENV_PROXY=1 adds NODE_USE_ENV_PROXY=1 (needed by SST's Node dynamic providers, see RESULT.md)
if [ "${ENV_PROXY:-0}" = 1 ]; then export NODE_USE_ENV_PROXY=1; fi
timeout "${RUN_TIMEOUT:-900}" ./node_modules/.bin/sst "$@" > "$here/logs/$label.raw" 2>&1 < /dev/null
code=$?
echo "exit=$code" >> "$here/logs/$label.raw"
TAIL="${TAIL:-40}" python3 -I "$here/redact.py" "$here/logs/$label.raw"
