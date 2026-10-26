# Read-only: prodcheck's sign-in rate-limit rows (D1 API query, 1 request + the d1 list already in raw/).
# Prints each row's path part, a short hash of its IP part (IPs are not printed), count and last request time.
# Usage: python3 -I ratelimit.py <label>
import json, os, sys, hashlib, urllib.request, datetime
P = "/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p5"
acct = os.environ["CLOUDFLARE_ACCOUNT_ID"]
dbs = json.load(open(f"{P}/raw/d1list-1-after-remove.json"))["result"]
uuid = [d["uuid"] for d in dbs if d["name"] == "reference-prodcheck-db-1"][0]
sql = "SELECT key, count, last_request FROM __framework_auth_rate_limit"
req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{uuid}/query", data=json.dumps({"sql": sql}).encode(), method="POST",
                             headers={"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"], "Content-Type": "application/json"})
try:
    r = urllib.request.urlopen(req); code = r.status; body = json.load(r)
except urllib.error.HTTPError as e:
    code = e.code; body = json.load(e)
open(f"{P}/ledger.txt", "a").write(f"{datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')} {sys.argv[1]} POST d1/database/<prodcheck>/query -> {code}\n")
if code != 200: print("HTTP", code, body.get("errors")); sys.exit(1)
rows = body["result"][0]["results"]
for row in sorted(rows, key=lambda x: x["last_request"]):
    k = row["key"]; ip, _, path = k.rpartition("/") if "/" in k else (k, "", "")
    # BA keys are "<ip><path>"; split at the first "/"
    i = k.find("/"); ip, path = (k[:i], k[i:]) if i >= 0 else (k, "")
    t = datetime.datetime.utcfromtimestamp(row["last_request"] / 1000).strftime("%H:%M:%S")
    print(f"ip#{hashlib.sha256(ip.encode()).hexdigest()[:6]} {path} count={row['count']} last={t}Z")
