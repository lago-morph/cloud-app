"""Delete this spike's SST state objects (prefix */spikewxlyyipn/) from the sst-state R2 bucket via
api.cloudflare.com (token injected by the proxy; no Authorization header is sent here), then delete the
bucket if it is empty and --delete-bucket is given. Prints keys and status only."""
import json, os, sys, urllib.parse, urllib.request

acct = os.environ["CLOUDFLARE_ACCOUNT_ID"]
base = f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/sst-state"


def call(method, url):
    req = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


status, body = call("GET", base + "/objects?per_page=1000")
keys = [o["key"] for o in body.get("result", [])]
for key in keys:
    if "/spikewxlyyipn/" not in key:
        print("SKIP (not this spike):", key)
        continue
    s, b = call("DELETE", base + "/objects/" + urllib.parse.quote(key, safe=""))
    print(s, b.get("success"), key)

status, body = call("GET", base + "/objects?per_page=1000")
left = [o["key"] for o in body.get("result", [])]
print("remaining objects:", left)
if "--delete-bucket" in sys.argv and not left:
    s, b = call("DELETE", base)
    print("delete bucket:", s, b.get("success"), b.get("errors"))
