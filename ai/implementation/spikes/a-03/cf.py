"""Spike A-03 Cloudflare API helper. All calls go to api.cloudflare.com through HTTPS_PROXY; the proxy
injects the token. This script never sends an Authorization header and never prints a secret value.

Usage: python3 -I cf.py <command>
  script            print this spike's Worker script name(s) (prefix spikeuekwqgqb)
  set-secret        PUT a fresh dummy secret SECRET_SPIKE on the script; the dummy value is kept only in
                    $A03_STATE (scratchpad, not committed); prints its SHA-256
  secrets           list the script's secrets (names and types only)
  bindings          list the script's bindings from /settings (names and types only)
  probe             GET the Worker's workers.dev URL and compare secretSha256 with the dummy's SHA-256
  leftovers         list scripts, KV namespaces and sst-state objects containing spikeuekwqgqb
  cleanup-state     delete sst-state objects under */spikeuekwqgqb/*; --delete-bucket deletes the bucket
                    only if it is then empty
"""
import hashlib, json, os, secrets, sys, time, urllib.error, urllib.parse, urllib.request

APP = "spikeuekwqgqb"
ACCT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}"
STATE = os.environ["A03_STATE"]


def call(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:300].decode(errors="replace")}


def script_names():
    s, b = call("GET", API + "/workers/scripts")
    return [x["id"] for x in b.get("result", []) if APP in x["id"]]


def one_script():
    names = script_names()
    if len(names) != 1:
        sys.exit(f"expected one script, found {names}")
    return names[0]


def subdomain():
    s, b = call("GET", API + "/workers/subdomain")
    return b["result"]["subdomain"]


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


cmd = sys.argv[1]
if cmd == "script":
    print("scripts:", script_names())
elif cmd == "set-secret":
    name = one_script()
    value = "dummy-" + secrets.token_hex(16)  # generated here; not a real credential
    s, b = call("PUT", f"{API}/workers/scripts/{name}/secrets",
                {"name": "SECRET_SPIKE", "text": value, "type": "secret_text"})
    st = load_state()
    st["sha256"] = hashlib.sha256(value.encode()).hexdigest()
    with open(STATE, "w") as f:
        json.dump({"value": value, "sha256": st["sha256"]}, f)
    print(f"PUT secrets: http={s} success={b.get('success')} errors={b.get('errors')}")
    print("result:", {k: v for k, v in (b.get("result") or {}).items() if k != "text"})
    print("dummy sha256 prefix:", st["sha256"][:12])
elif cmd == "secrets":
    name = one_script()
    s, b = call("GET", f"{API}/workers/scripts/{name}/secrets")
    print(f"GET secrets: http={s} success={b.get('success')}")
    print("secrets:", [(x.get("name"), x.get("type")) for x in b.get("result") or []])
elif cmd == "bindings":
    name = one_script()
    s, b = call("GET", f"{API}/workers/scripts/{name}/settings")
    print(f"GET settings: http={s} success={b.get('success')}")
    print("bindings:", sorted((x.get("name"), x.get("type")) for x in (b.get("result") or {}).get("bindings", [])))
elif cmd == "probe":
    name = one_script()
    url = f"https://{name}.{subdomain()}.workers.dev/"
    want = load_state().get("sha256")
    for attempt in range(6):
        try:
            # Cloudflare answers the default Python-urllib User-Agent with 403 "error code: 1010"
            req = urllib.request.Request(url, headers={"User-Agent": "spike-a03-probe/1"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = json.loads(r.read())
            break
        except Exception as e:  # noqa: BLE001
            print("attempt", attempt, "error:", type(e).__name__, str(e)[:120])
            time.sleep(5)
    else:
        sys.exit("probe failed")
    got = body.pop("secretSha256")
    body["secretMatchesDummy"] = (got is not None and got == want)
    print("probe http=200", json.dumps(body))
elif cmd == "leftovers":
    print("scripts:", script_names())
    s, b = call("GET", API + "/storage/kv/namespaces?per_page=100")
    print("kv:", [x["title"] for x in b.get("result", []) if APP in x["title"]])
    s, b = call("GET", API + "/r2/buckets")
    print("r2 buckets:", [x["name"] for x in (b.get("result") or {}).get("buckets", [])])
    s, b = call("GET", API + "/r2/buckets/sst-state/objects?per_page=1000")
    keys = [o["key"] for o in b.get("result") or []] if s == 200 else []
    print("sst-state http:", s, "objects (mine):", [k for k in keys if f"/{APP}/" in k])
    print("sst-state objects (other apps):", len([k for k in keys if f"/{APP}/" not in k]))
elif cmd == "cleanup-state":
    base = API + "/r2/buckets/sst-state"
    s, b = call("GET", base + "/objects?per_page=1000")
    for key in [o["key"] for o in b.get("result") or []]:
        if f"/{APP}/" not in key:
            print("SKIP (other app):", key.split("/")[0], "/", key.split("/")[1] if "/" in key else "")
            continue
        s2, b2 = call("DELETE", base + "/objects/" + urllib.parse.quote(key, safe=""))
        print(s2, b2.get("success"), key)
    s, b = call("GET", base + "/objects?per_page=1000")
    left = [o["key"] for o in b.get("result") or []]
    print("remaining objects:", len(left))
    if "--delete-bucket" in sys.argv:
        if left:
            print("bucket kept: other objects present")
        else:
            s, b = call("DELETE", base)
            print("delete bucket:", s, b.get("success"), b.get("errors"))
else:
    sys.exit("unknown command")
