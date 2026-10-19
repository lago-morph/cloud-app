#!/usr/bin/env bash
# Usage: sst.sh <label> <sst args...>
# Runs SST from sst-app/ with stage a01. Environment knobs (all optional):
#   SET_DEFAULT_ACCT=1   export CLOUDFLARE_DEFAULT_ACCOUNT_ID from CLOUDFLARE_ACCOUNT_ID
#   DUMMY_TOKEN=1        export CLOUDFLARE_API_TOKEN=proxy-injected (non-secret placeholder)
# Output is captured to logs/<label>.txt with the account ID redacted.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/sst-app"
label="$1"; shift
export CI=1 SST_STAGE=a01
if [ "${SET_DEFAULT_ACCT:-0}" = 1 ]; then export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"; fi
if [ "${DUMMY_TOKEN:-0}" = 1 ]; then export CLOUDFLARE_API_TOKEN=proxy-injected; fi
prefix=()
if [ "${MINIMAL:-0}" = 1 ]; then
  # Minimal environment: only what is listed here reaches SST (no NODE_EXTRA_CA_CERTS,
  # SSL_CERT_FILE, AWS_*, NODE_OPTIONS, ...). HTTPS_PROXY stays set.
  keep=(PATH="$PATH" HOME="$HOME" HTTPS_PROXY="$HTTPS_PROXY" NO_PROXY="${NO_PROXY:-}" CI=1 SST_STAGE=a01
        CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID")
  [ -n "${CLOUDFLARE_DEFAULT_ACCOUNT_ID:-}" ] && keep+=(CLOUDFLARE_DEFAULT_ACCOUNT_ID="$CLOUDFLARE_DEFAULT_ACCOUNT_ID")
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && keep+=(CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN")
  prefix=(env -i "${keep[@]}")
fi
timeout "${RUN_TIMEOUT:-900}" "${prefix[@]}" ./node_modules/.bin/sst "$@" > "$here/logs/$label.raw" 2>&1 < /dev/null
code=$?
echo "exit=$code" >> "$here/logs/$label.raw"
TAIL="${TAIL:-40}" python3 -I "$here/redact.py" "$here/logs/$label.raw"
