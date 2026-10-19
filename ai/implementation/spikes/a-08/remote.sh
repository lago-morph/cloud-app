#!/usr/bin/env bash
# Usage: D1_ID=<uuid> remote.sh binding|http   — A-01 environment + NODE_USE_ENV_PROXY=1 (Node fetch).
set -u
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
CI=1 CLOUDFLARE_API_TOKEN=proxy-injected \
  CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  NODE_USE_ENV_PROXY=1 \
  HTTPS_PROXY="$HTTPS_PROXY" D1_ID="$D1_ID" \
  timeout 900 node probe-remote.mjs "$1" 2>&1 < /dev/null | python3 -I "$here/redact.py" | sed -e "s/$D1_ID/<d1-uuid>/g"
