#!/usr/bin/env bash
# Usage: cf.sh <label> <cf.py args...> — runs cf.py, logs redacted output to logs/<label>.txt.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
label="$1"; shift
export A03_SUBDOMAIN="${A03_SUBDOMAIN:-$(curl -sS "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["result"]["subdomain"])')}"
export A03_STATE="${A03_STATE:-/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/a03-state.json}"
python3 -I "$here/cf.py" "$@" > "$here/logs/$label.raw" 2>&1
echo "exit=$?" >> "$here/logs/$label.raw"
TAIL="${TAIL:-40}" python3 -I "$here/redact.py" "$here/logs/$label.raw"
