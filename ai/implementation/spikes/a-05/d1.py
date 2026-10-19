"""Minimal D1 HTTP API client for spike A-05.

Talks to api.cloudflare.com through HTTPS_PROXY with Python urllib (system trust store holds the proxy CA).
No Authorization header is ever set here: the sandbox proxy injects the token. Output is redacted
(account ID, 32-hex IDs, database UUIDs) before it is printed or logged."""
import json, os, re, time, urllib.error, urllib.request

ACCT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/d1/database"
PREFIX = "spikepmyh4f7i"


def redact(text):
    text = text.replace(ACCT, "<account-id>")
    text = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<uuid>", text)
    text = re.sub(r"[0-9a-f]{32}", "<hex32>", text)
    text = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._-]+", r"\1<redacted>", text)
    return text


def call(method, url, body=None, raw_body=None, timeout=300):
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, text = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read().decode("utf-8", "replace")
    elapsed = time.time() - t0
    try:
        parsed = json.loads(text)
    except ValueError:
        parsed = {"_non_json": text[:2000]}
    return status, parsed, elapsed


def create(name):
    s, b, _ = call("POST", BASE, {"name": name})
    assert s == 200 and b.get("success"), redact(json.dumps(b))
    return b["result"]["uuid"]


def delete(uuid):
    s, b, _ = call("DELETE", f"{BASE}/{uuid}")
    return s, b.get("success")


def list_mine():
    s, b, _ = call("GET", BASE + "?per_page=100")
    return [(d["name"], d["uuid"]) for d in b.get("result", []) if d["name"].startswith(PREFIX)]


def query(uuid, sql, params=None, endpoint="query"):
    body = {"sql": sql}
    if params is not None:
        body["params"] = params
    return call("POST", f"{BASE}/{uuid}/{endpoint}", body)


def batch(uuid, stmts, endpoint="query"):
    """stmts: list of {"sql":..., "params":[...]} sent as the `batch` array form."""
    return call("POST", f"{BASE}/{uuid}/{endpoint}", {"batch": stmts})


def summary(status, body, elapsed):
    """Compact, redacted view of a response: status, success, errors, per-statement meta and rows (truncated)."""
    out = {"http": status, "elapsed_s": round(elapsed, 2), "success": body.get("success"),
           "errors": body.get("errors")}
    res = body.get("result")
    if isinstance(res, list):
        out["results"] = []
        for r in res[:12]:
            meta = r.get("meta", {}) if isinstance(r, dict) else {}
            rows = r.get("results") if isinstance(r, dict) else None
            out["results"].append({
                "success": r.get("success") if isinstance(r, dict) else None,
                "rows": (rows[:5] if isinstance(rows, list) else rows),
                "changes": meta.get("changes"), "rows_written": meta.get("rows_written"),
                "duration": meta.get("duration"), "changed_db": meta.get("changed_db"),
            })
        if len(res) > 12:
            out["results_truncated"] = len(res)
    elif res is not None:
        out["result"] = res
    if "_non_json" in body:
        out["non_json"] = body["_non_json"][:500]
    return redact(json.dumps(out, ensure_ascii=False, indent=1))
