#!/usr/bin/env bash
# Usage: wr.sh <wrangler args...>   (A-01's environment; token is a non-secret placeholder the proxy replaces)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
CI=1 CLOUDFLARE_API_TOKEN=proxy-injected \
  CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  HTTPS_PROXY="$HTTPS_PROXY" \
  ./node_modules/.bin/wrangler "$@" 2>&1 < /dev/null | python3 -I "$here/redact.py"
