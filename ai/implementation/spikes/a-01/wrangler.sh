#!/usr/bin/env bash
# Usage: wrangler.sh <label> <wrangler args...>
# Runs the pinned wrangler from the spike directory. Knobs (optional):
#   DUMMY_TOKEN=1  export CLOUDFLARE_API_TOKEN=proxy-injected (non-secret placeholder)
#   MINIMAL=1      run with only PATH, HOME, HTTPS_PROXY, NO_PROXY, CI, CLOUDFLARE_ACCOUNT_ID
#                  (+ the token placeholder); no NODE_EXTRA_CA_CERTS / SSL_CERT_FILE / NODE_OPTIONS.
# Output is captured to logs/<label>.txt with the account ID redacted.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
label="$1"; shift
export CI=1
if [ "${DUMMY_TOKEN:-0}" = 1 ]; then export CLOUDFLARE_API_TOKEN=proxy-injected; fi
prefix=()
if [ "${MINIMAL:-0}" = 1 ]; then
  keep=(PATH="$PATH" HOME="$HOME" HTTPS_PROXY="$HTTPS_PROXY" NO_PROXY="${NO_PROXY:-}" CI=1
        CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID")
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && keep+=(CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN")
  # EXTRA_CA=1 adds NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
  [ "${EXTRA_CA:-0}" = 1 ] && keep+=(NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt)
  prefix=(env -i "${keep[@]}")
fi
timeout "${RUN_TIMEOUT:-300}" "${prefix[@]}" ./node_modules/.bin/wrangler "$@" > "$here/logs/$label.raw" 2>&1 < /dev/null
code=$?
echo "exit=$code" >> "$here/logs/$label.raw"
TAIL="${TAIL:-40}" python3 -I "$here/redact.py" "$here/logs/$label.raw"
