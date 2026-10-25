# Read-only: lists the demo stage's log objects for one minute and prints the info entries' fields
# (no secrets in them). Each request is written to ledger.txt. Usage: python3 -I logentries.py <prefix>
import json, os, sys, urllib.request, urllib.parse, datetime
acct = os.environ["CLOUDFLARE_ACCOUNT_ID"]; H = {"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"]}
L = "/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p4d/ledger.txt"
def get(path, lab):
    r = urllib.request.urlopen(urllib.request.Request("https://api.cloudflare.com/client/v4/accounts/" + acct + path, headers=H))
    open(L, "a").write(datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ") + " 9-ac008 GET " + lab + " -> " + str(r.status) + "\n")
    return r.read()
b = json.loads(get("/r2/buckets/prototype-logs/objects?prefix=" + urllib.parse.quote(sys.argv[1]) + "&per_page=100", "r2/buckets/prototype-logs/objects"))
keys = [o["key"] for o in b["result"]]
for k in keys: print(k)
for k in keys:
    if "-info-" in k:
        e = json.loads(get("/r2/buckets/prototype-logs/objects/" + urllib.parse.quote(k, safe=""), "r2/buckets/prototype-logs/objects/<key>"))
        print({x: e.get(x) for x in ("time", "app", "stage", "severity", "component", "requestId")}, "| message:", (e.get("message") or "")[:70])
