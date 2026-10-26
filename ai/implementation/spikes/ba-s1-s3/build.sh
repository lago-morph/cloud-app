#!/bin/sh
# Bundle the spike Worker with the repo's wrangler (dry run: no Cloudflare API call; credentials removed from env).
# Usage: sh build.sh [wrangler config] [outdir]
set -e
cd "$(dirname "$0")"
CONFIG="${1:-wrangler.toml}"
OUT="${2:-dist}"
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID WRANGLER_SEND_METRICS=false \
  ../../../../node_modules/.bin/wrangler deploy --dry-run --config "$CONFIG" --outdir "$OUT" 2>&1
