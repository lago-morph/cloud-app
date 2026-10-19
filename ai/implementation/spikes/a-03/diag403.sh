#!/usr/bin/env bash
# Diagnose the 403 seen by cf.py probe: curl default UA vs Python-urllib UA. Subdomain redacted.
set -u
SUB=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["result"]["subdomain"])')
U="https://spikeuekwqgqb-a03-apiscript.$SUB.workers.dev/"
{
echo "## curl default UA"
curl -sS -o /dev/null -w "http=%{http_code} connect=%{http_connect}\n" "$U"
echo "## curl -A Python-urllib/3.11"
curl -sS -A "Python-urllib/3.11" -w "\nhttp=%{http_code}\n" "$U" | head -c 400
echo
echo "## proxy recentRelayFailures (last 2)"
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -I -c "import json,sys;print(json.load(sys.stdin).get('recentRelayFailures')[-2:])"
} 2>&1 | python3 -I -c "import sys;s=sys.argv[1];print(sys.stdin.read().replace(s,'<subdomain>'))" "$SUB"
