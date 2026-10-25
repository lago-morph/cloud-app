# Usage: python3 -I collect.py copy|scan <record id>...
# copy: copies the pass-3 evidence (driver logs, fetch traces, SST log copies, ledger, measurement
#       bodies, tooling) into validation/cloudflare/pass-3/logs/, redacted: token, account ID,
#       zone ID, workers.dev subdomain, and every 32+ hex string.
# scan: scans pass-3/ and the given records (<id>.json and <id>/) for those values and for
#       32+ hex strings; prints hits by name only (a record's 40-hex commit SHA is expected).
import os, re, glob, sys, json
S = "/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad"
P = S + "/p3"
W = "/home/user/cloud-app/.claude/worktrees/agent-afb6e5aea64fb07c4"
OUT = W + "/validation/cloudflare/pass-3/logs"
SUB = re.compile(r"\.([a-z0-9-]+)\.workers\.dev")
def subdomains():
    found = set()
    for f in glob.glob(P + "/**", recursive=True):
        if os.path.isfile(f):
            for m in SUB.findall(open(f, errors="replace").read()):
                if not m.startswith("<") and m not in ("account-subdomain", "SUBDOMAIN"): found.add(m)
    return found
sec = {"token": os.environ["CLOUDFLARE_API_TOKEN"], "account": os.environ["CLOUDFLARE_ACCOUNT_ID"]}
for z in glob.glob(P + "/raw/zone-*.json"):
    sec["zone"] = json.load(open(z))["result"][0]["id"]
SUBS = subdomains()
HEX = re.compile(r"[0-9a-f]{32,}", re.I)

def red(t):
    t = t.replace(sec["token"], "<TOKEN>").replace(sec["account"], "<ACCOUNT>")
    if "zone" in sec: t = t.replace(sec["zone"], "<ZONE>")
    for s in SUBS:
        t = t.replace("." + s + ".workers.dev", ".<SUBDOMAIN>.workers.dev")
    return HEX.sub("<HEX32+>", t)

def copy():
    for f in glob.glob(P + "/**", recursive=True):
        if not os.path.isfile(f) or f.endswith(".link") or "/raw/tokens-" in f or f.endswith("local.log"): continue
        rel = os.path.relpath(f, P)
        if rel.startswith("raw/"): rel = "measure/" + rel[4:]
        elif rel.endswith((".sh", ".py", ".mjs")): rel = "tooling/" + rel
        dst = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, "w").write(red(open(f, errors="replace").read()))

def scan(ids):
    files = [f for f in glob.glob(W + "/validation/cloudflare/pass-3/**", recursive=True) if os.path.isfile(f)]
    for r in ids:
        files += glob.glob(f"{W}/validation/cloudflare/{r}.json")
        files += [f for f in glob.glob(f"{W}/validation/cloudflare/{r}/**", recursive=True) if os.path.isfile(f)]
    bad = 0
    for f in files:
        t = open(f, errors="replace").read()
        hits = [k for k, v in sec.items() if v and v in t] + ["subdomain" for s in SUBS if s in t]
        h = HEX.findall(t)
        if hits or h:
            bad += 1; print(f.replace(W + "/", ""), hits, "hex32:", len(h), sorted({x[:7] for x in h}))
    print(len(files), "files scanned,", bad, "with hits; subdomains known:", len(SUBS))

if sys.argv[1] == "copy": copy()
else: scan(sys.argv[2:])
