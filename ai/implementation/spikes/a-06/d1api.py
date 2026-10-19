"""Minimal D1 HTTP API client for spike A-06. Talks to api.cloudflare.com only through HTTPS_PROXY
(Python urllib reads it); the proxy injects the API token, so no Authorization header is ever sent here.
Never prints a signed URL (it carries a signature); only its host."""
import hashlib, json, os, re, time, urllib.error, urllib.parse, urllib.request

ACCT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/d1/database"


def redact(text):
    text = text.replace(ACCT, "<account-id>")
    text = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<uuid>", text)
    text = re.sub(r"[0-9a-f]{32}", "<hex32>", text)
    text = re.sub(r"https://[^\s\"']+\?[^\s\"']+", "<signed-url>", text)
    return text


def call(method, url, body=None, timeout=300):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except ValueError:
            return e.code, {"raw": raw[:500].decode("utf-8", "replace")}


def create(name):
    s, b = call("POST", BASE, {"name": name})
    if not b.get("success"):
        raise RuntimeError(redact(f"create {name}: {s} {b.get('errors')}"))
    return b["result"]["uuid"]


def delete(uuid):
    s, b = call("DELETE", f"{BASE}/{uuid}")
    return s, b.get("success"), b.get("errors")


def list_names():
    s, b = call("GET", BASE + "?per_page=100")
    return [(d["name"], d["uuid"]) for d in b.get("result", [])]


def query(uuid, sql, params=None, raw=False):
    body = {"sql": sql}
    if params is not None:
        body["params"] = params
    return call("POST", f"{BASE}/{uuid}/{'raw' if raw else 'query'}", body)


def q_ok(uuid, sql, params=None, raw=False):
    s, b = query(uuid, sql, params, raw)
    if not b.get("success"):
        raise RuntimeError(redact(f"query failed {s}: {json.dumps(b.get('errors'))[:800]} :: {sql[:200]}"))
    return b["result"]


def export(uuid, log):
    """Polling export; returns (sql_bytes, info). info has timings and the signed URL host only."""
    t0 = time.time()
    body = {"output_format": "polling"}
    polls = 0
    while True:
        s, b = call("POST", f"{BASE}/{uuid}/export", body)
        polls += 1
        r = b.get("result") or {}
        log(f"export poll {polls}: http={s} success={b.get('success')} status={r.get('status')} "
            f"type={r.get('type')} error={r.get('error')} messages={redact(json.dumps(r.get('messages')))[:300]} "
            f"errors={redact(json.dumps(b.get('errors')))[:300]}")
        if not b.get("success") or r.get("status") == "error":
            raise RuntimeError("export failed")
        if r.get("status") == "complete":
            break
        body = {"output_format": "polling", "current_bookmark": r.get("at_bookmark")}
        time.sleep(1)
    t1 = time.time()
    url = r["result"]["signed_url"]
    host = urllib.parse.urlsplit(url).hostname
    log(f"export complete: filename={redact(str(r['result'].get('filename')))} signed_url host={redact(host)}")
    with urllib.request.urlopen(url, timeout=300) as resp:
        data = resp.read()
    t2 = time.time()
    return data, {"export_s": round(t1 - t0, 2), "download_s": round(t2 - t1, 2), "polls": polls,
                  "bytes": len(data), "signed_url_host": redact(host)}


def import_file(uuid, data, log):
    """D1 import API: init -> PUT upload_url -> ingest -> poll. Returns info with timings."""
    etag = hashlib.md5(data).hexdigest()
    t0 = time.time()
    s, b = call("POST", f"{BASE}/{uuid}/import", {"action": "init", "etag": etag})
    r = b.get("result") or {}
    log(f"import init: http={s} success={b.get('success')} status={r.get('status')} "
        f"keys={sorted(r.keys())} errors={redact(json.dumps(b.get('errors')))[:300]}")
    if not b.get("success"):
        raise RuntimeError("import init failed")
    info = {}
    if r.get("upload_url"):
        up = r["upload_url"]
        info["upload_url_host"] = redact(urllib.parse.urlsplit(up).hostname)
        req = urllib.request.Request(up, data=data, method="PUT")
        with urllib.request.urlopen(req, timeout=300) as resp:
            got = resp.headers.get("ETag", "").strip('"')
            log(f"upload PUT: http={resp.status} etag_matches={got == etag} host={info['upload_url_host']}")
        t1 = time.time()
        s, b = call("POST", f"{BASE}/{uuid}/import",
                    {"action": "ingest", "etag": etag, "filename": r.get("filename")})
        r = b.get("result") or {}
        log(f"import ingest: http={s} success={b.get('success')} status={r.get('status')} "
            f"errors={redact(json.dumps(b.get('errors')))[:300]} error={redact(str(r.get('error')))[:300]}")
    else:
        t1 = time.time()
    polls = 0
    if r.get("error") and not r.get("status"):
        r["status"] = "error"
    while r.get("status") not in ("complete", "error") and b.get("success"):
        time.sleep(1)
        s, b = call("POST", f"{BASE}/{uuid}/import", {"action": "poll", "current_bookmark": r.get("at_bookmark")})
        r = b.get("result") or {}
        polls += 1
        log(f"import poll {polls}: http={s} success={b.get('success')} status={r.get('status')} "
            f"error={redact(str(r.get('error')))[:300]} messages={redact(json.dumps(r.get('messages')))[:300]}")
    t2 = time.time()
    res = r.get("result") or {}
    info.update({"upload_s": round(t1 - t0, 2), "ingest_s": round(t2 - t1, 2), "polls": polls,
                 "status": r.get("status"), "error": redact(str(r.get("error"))) if r.get("error") else None,
                 "num_queries": res.get("num_queries"), "meta": res.get("meta")})
    return info
