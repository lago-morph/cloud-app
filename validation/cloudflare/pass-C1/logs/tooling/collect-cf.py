# Usage: python3 -I collect-cf.py copy | scan <record id> [--allow <file of allowed 40-hex ids>]
# copy: copies pC1 -> validation/cloudflare/pass-C1/logs, redacted (token, account ID, subdomain,
#       apiKey value, and any 32+ hex string). apikey.secret and rurl.txt are not copied.
# scan: scans the logs dir and the given record (validation/cloudflare/<id>.json and <id>/) for the
#       secrets and 32+ hex strings not in the allow list; prints hits by name only.
import os, re, glob, sys
S = "/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad"
W = "/home/user/cloud-app/.claude/worktrees/agent-ac2d7ebe7faf3d877"
SRC, OUT = S + "/pC1", W + "/validation/cloudflare/pass-C1/logs"
def rd(p):
    try: return open(p).read().strip()
    except FileNotFoundError: return ""
sec = {
    "token": os.environ["CLOUDFLARE_API_TOKEN"],
    "account": os.environ["CLOUDFLARE_ACCOUNT_ID"],
    "subdomain": re.search(r"\.([a-z0-9-]+)\.workers\.dev", rd(SRC + "/rurl.txt")).group(1),
    "apikey": rd(SRC + "/apikey.secret"),
}
HEX = re.compile(r"[0-9a-f]{32,}", re.I)
SKIP = {"apikey.secret", "rurl.txt", "collect-cf.py"}

def red(t):
    for k in ("token", "apikey", "account"):
        if sec[k]: t = t.replace(sec[k], f"<{k.upper()}>")
    t = t.replace(sec["subdomain"], "<SUBDOMAIN>")
    return HEX.sub("<HEX32+>", t)

def copy():
    for f in glob.glob(SRC + "/**", recursive=True):
        if not os.path.isfile(f) or os.path.basename(f) in SKIP or f.endswith(".link"): continue
        rel = os.path.relpath(f, SRC)
        if rel.startswith("raw/"): rel = "measure/" + rel[4:]
        elif rel.endswith((".sh", ".py", ".mjs")): rel = "tooling/" + rel
        dst = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, "w").write(red(open(f, errors="replace").read()))
    open(OUT + "/tooling/collect-cf.py", "w").write(red(open(SRC + "/collect-cf.py").read()))

def scan(args):
    allow = set()
    if "--allow" in args:
        i = args.index("--allow"); allow = set(open(args[i + 1]).read().split()); args = args[:i] + args[i + 2:]
    files = [f for f in glob.glob(OUT + "/**", recursive=True) if os.path.isfile(f)]
    for r in args:
        files += glob.glob(f"{W}/validation/cloudflare/{r}.json")
        files += [f for f in glob.glob(f"{W}/validation/cloudflare/{r}/**", recursive=True) if os.path.isfile(f)]
    bad = 0
    for f in files:
        t = open(f, errors="replace").read()
        hits = [k for k, v in sec.items() if v and v in t]
        h = [x for x in HEX.findall(t) if x.lower() not in allow]
        if hits or h:
            bad += 1; print(f.replace(W + "/", ""), hits, "hex32:", len(h))
    print(len(files), "files scanned,", bad, "with hits")

if sys.argv[1] == "copy": copy()
else: scan(sys.argv[2:])
