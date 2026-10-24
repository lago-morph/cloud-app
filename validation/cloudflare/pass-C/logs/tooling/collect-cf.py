# Usage: python3 -I collect-cf.py copy|scan [record ids...] [--allow <file of allowed 40-hex ids>]
# copy: copies pC -> validation/cloudflare/pass-C/logs and f03 -> validation/cloudflare/f-03/logs, redacted
#       (token, account ID, subdomain, apiKey and shareKey values, and any 32+ hex string).
#       apikey.secret, sharekey.secret and durl/rurl files are not copied.
# scan: scans both logs dirs and the given records (validation/<target>/<id>.json and <id>/) for the
#       secrets and 32+ hex strings not in the allow list; prints hits by name only.
import os, re, glob, sys
S = "/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad"
W = "/home/user/cloud-app/.claude/worktrees/agent-a4665bc84e87d6f2c"
PAIRS = [(S + "/pC", W + "/validation/cloudflare/pass-C/logs"), (S + "/f03", W + "/validation/cloudflare/f-03/logs")]
def rd(p):
    try: return open(p).read().strip()
    except FileNotFoundError: return ""
sec = {
    "token": os.environ["CLOUDFLARE_API_TOKEN"],
    "account": os.environ["CLOUDFLARE_ACCOUNT_ID"],
    "subdomain": re.search(r"\.([a-z0-9-]+)\.workers\.dev", rd(S + "/pC/rurl.txt")).group(1),
    "apikey": rd(S + "/pC/apikey.secret"),
    "sharekey": rd(S + "/f03/sharekey.secret"),
    "sharekeylocal": rd(S + "/f03/sharekey-local.secret"),
}
HEX = re.compile(r"[0-9a-f]{32,}", re.I)
SKIP = {"apikey.secret", "sharekey.secret", "sharekey-local.secret", "rurl.txt", "durl.txt"}

def red(t):
    for k in ("token", "apikey", "sharekey", "sharekeylocal", "account"):
        if sec[k]: t = t.replace(sec[k], f"<{k.upper()}>")
    t = t.replace(sec["subdomain"], "<SUBDOMAIN>")
    return HEX.sub("<HEX32+>", t)

def copy():
    for src, out in PAIRS:
        for f in glob.glob(src + "/**", recursive=True):
            if not os.path.isfile(f) or os.path.basename(f) in SKIP or f.endswith(".link"): continue
            rel = os.path.relpath(f, src)
            if rel.startswith("raw/"): rel = "measure/" + rel[4:]
            elif rel.endswith((".sh", ".py", ".mjs")): rel = "tooling/" + rel
            dst = os.path.join(out, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst, "w").write(red(open(f, errors="replace").read()))

def scan(args):
    allow = set()
    if "--allow" in args:
        i = args.index("--allow"); allow = set(open(args[i + 1]).read().split()); args = args[:i] + args[i + 2:]
    files = []
    for _, out in PAIRS: files += [f for f in glob.glob(out + "/**", recursive=True) if os.path.isfile(f)]
    for r in args:
        for t in ("cloudflare", "local"):
            files += glob.glob(f"{W}/validation/{t}/{r}.json")
            files += [f for f in glob.glob(f"{W}/validation/{t}/{r}/**", recursive=True) if os.path.isfile(f)]
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
