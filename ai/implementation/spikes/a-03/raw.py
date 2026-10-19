"""Spike A-03 control: which layer keeps the secret? Uploads a throwaway script
spikeuekwqgqb-a03-raw directly with the Workers script upload API (multipart PUT), sets a dummy secret,
re-uploads with and without metadata.keep_bindings, and lists the secrets after each step.
No Authorization header is sent (the proxy injects the token); no secret value is printed.

Usage: python3 -I raw.py run | delete
"""
import json, os, secrets, sys, urllib.error, urllib.request, uuid

ACCT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
NAME = "spikeuekwqgqb-a03-raw"
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/workers/scripts/{NAME}"
CODE = b'export default { fetch() { return new Response("raw"); } };\n'


def call(method, url, data=None, ctype=None):
    req = urllib.request.Request(url, data=data, method=method)
    if ctype:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def upload(label, metadata):
    b = uuid.uuid4().hex
    parts = [
        (f'--{b}\r\nContent-Disposition: form-data; name="metadata"; filename="blob"\r\n'
         f"Content-Type: application/json\r\n\r\n").encode() + json.dumps(metadata).encode() + b"\r\n",
        (f'--{b}\r\nContent-Disposition: form-data; name="index.js"; filename="index.js"\r\n'
         f"Content-Type: application/javascript+module\r\n\r\n").encode() + CODE + b"\r\n",
        f"--{b}--\r\n".encode(),
    ]
    s, r = call("PUT", BASE, b"".join(parts), f"multipart/form-data; boundary={b}")
    print(f"[{label}] upload metadata={json.dumps({k: v for k, v in metadata.items() if k != 'main_module'})}"
          f" -> http={s} success={r.get('success')} errors={r.get('errors')}")


def show(label):
    s, r = call("GET", BASE + "/secrets")
    sec = [(x["name"], x["type"]) for x in r.get("result") or []]
    s2, r2 = call("GET", BASE + "/settings")
    bnd = sorted((x["name"], x["type"]) for x in (r2.get("result") or {}).get("bindings", []))
    print(f"[{label}] secrets={sec} bindings={bnd}")


if sys.argv[1] == "run":
    base_meta = {"main_module": "index.js", "compatibility_date": "2025-01-01",
                 "bindings": [{"type": "plain_text", "name": "V", "text": "1"}]}
    upload("r1", base_meta)
    s, r = call("PUT", BASE + "/secrets",
                json.dumps({"name": "SECRET_SPIKE", "type": "secret_text",
                            "text": "dummy-" + secrets.token_hex(16)}).encode(), "application/json")
    print(f"[r2] PUT secret -> http={s} success={r.get('success')}")
    show("r2")
    upload("r3 no keep_bindings", dict(base_meta, bindings=[{"type": "plain_text", "name": "V", "text": "2"}]))
    show("r3")
    s, r = call("PUT", BASE + "/secrets",
                json.dumps({"name": "SECRET_SPIKE", "type": "secret_text",
                            "text": "dummy-" + secrets.token_hex(16)}).encode(), "application/json")
    print(f"[r4] PUT secret again -> http={s} success={r.get('success')}")
    upload("r5 keep_bindings=[secret_text]",
           dict(base_meta, bindings=[{"type": "plain_text", "name": "V", "text": "3"}],
                keep_bindings=["secret_text"]))
    show("r5")
elif sys.argv[1] == "collide":
    # A deploy that declares a non-secret binding with the secret's name replaces the secret.
    upload("r6 plain_text named SECRET_SPIKE",
           {"main_module": "index.js", "compatibility_date": "2025-01-01",
            "bindings": [{"type": "plain_text", "name": "SECRET_SPIKE", "text": "not-a-secret"}]})
    show("r6")
    upload("r7 SECRET_SPIKE no longer declared",
           {"main_module": "index.js", "compatibility_date": "2025-01-01",
            "bindings": [{"type": "plain_text", "name": "V", "text": "4"}]})
    show("r7")
elif sys.argv[1] == "delete":
    s, r = call("DELETE", BASE + "?force=true")
    print(f"delete -> http={s} success={r.get('success')} errors={r.get('errors')}")
