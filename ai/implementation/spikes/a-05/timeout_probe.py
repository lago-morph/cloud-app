"""E9: a request that runs past the gateway's response deadline. Which component answers, and was the
batch applied anyway? Usage: python3 -I timeout_probe.py <uuid-file> <n-statements>. Appends to logs/e9-timeout.txt."""
import json, os, sys, time, urllib.error, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1  # noqa: E402

u = open(sys.argv[1]).read().strip()
n = int(sys.argv[2])
d1.query(u, "DELETE FROM blob_t")
sql = ";\n".join(["PRAGMA defer_foreign_keys = on"] +
                 [f"INSERT INTO blob_t (id, v) VALUES ({i}, 'v')" for i in range(n)])
req = urllib.request.Request(f"{d1.BASE}/{u}/query", data=json.dumps({"sql": sql}).encode(), method="POST")
req.add_header("Content-Type", "application/json")
t0 = time.time()
try:
    r = urllib.request.urlopen(req, timeout=300)
    st, h, body = r.status, dict(r.headers), r.read()[:200]
except urllib.error.HTTPError as e:
    st, h, body = e.code, dict(e.headers), e.read()[:300]
lines = [f"## {n} small INSERT statements in one request, body {len(sql) / 1e6:.1f} MB",
         f"status {st} elapsed {time.time() - t0:.1f}s",
         "headers " + json.dumps({k: v for k, v in h.items() if k.lower() in ("server", "content-type", "via")}),
         "body " + body.decode("utf-8", "replace")[:300]]
for wait in (0, 10, 30):
    time.sleep(wait)
    _, b, _ = d1.query(u, "SELECT count(*) AS n FROM blob_t")
    lines.append(f"rows after +{wait}s: {b['result'][0]['results'] if b.get('success') else b.get('errors')}")
text = d1.redact("\n".join(lines))
print(text)
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", "e9-timeout.txt"), "a") as f:
    f.write(text + "\n")
