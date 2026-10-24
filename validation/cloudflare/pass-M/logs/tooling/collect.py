# Usage: python3 -I collect.py copy|scan
# copy: copies the pass-M evidence into validation/cloudflare/pass-M/logs/ with redaction.
# scan: scans the logs dir and the four driver records for the token, account ID, subdomain,
#       apiKey value and 32-hex strings; prints hits by name only.
import os, re, glob, shutil, sys
S = "/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad"
P = S + "/pM"
W = "/home/user/cloud-app/.claude/worktrees/agent-a46cd131d47683b75"
OUT = W + "/validation/cloudflare/pass-M/logs"
RUNS = ["xxiuurmy40pnr33", "e22y1n7jn93xoz4", "6e5ya5y8z05u4ce", "0reagqr1j01rqfv"]
sec = {
    "token": os.environ["CLOUDFLARE_API_TOKEN"],
    "account": os.environ["CLOUDFLARE_ACCOUNT_ID"],
    "subdomain": re.search(r"\.([a-z0-9-]+)\.workers\.dev", open(S + "/p1c/rurl.txt").read()).group(1),
}
for _n, _f in (("apiKey", S + "/p1c/apikey.secret"), ("apiKey2", S + "/apikey")):
    try:
        _v = open(_f).read().strip()
        if len(_v) >= 8: sec[_n] = _v
    except (FileNotFoundError, IsADirectoryError): pass
HEX = re.compile(r"[0-9a-f]{32,}", re.I)

def red(t):
    for _k in ("apiKey", "apiKey2"):
        if _k in sec: t = t.replace(sec[_k], "<APIKEY>")
    t = t.replace(sec["token"], "<TOKEN>").replace(sec["account"], "<ACCOUNT>")
    t = t.replace("." + sec["subdomain"] + ".workers.dev", ".<SUBDOMAIN>.workers.dev")
    t = t.replace(sec["subdomain"], "<SUBDOMAIN>")
    return HEX.sub("<HEX32+>", t)

def copy():
    os.makedirs(OUT + "/tooling", exist_ok=True)
    os.makedirs(OUT + "/measure", exist_ok=True)
    for f in ["driver.sh", "measure.sh", "count.py", "collect.py", "fetch-trace.mjs", "logwatch.mjs"]:
        open(f"{OUT}/tooling/{f}", "w").write(red(open(f"{P}/{f}").read()))
    for f in glob.glob(P + "/*.log") + glob.glob(P + "/ledger.txt") + glob.glob(P + "/d1q-today.json"):
        open(f"{OUT}/{os.path.basename(f)}", "w").write(red(open(f, errors="replace").read()))
    for f in glob.glob(P + "/raw/*.json"):
        open(f"{OUT}/measure/{os.path.basename(f)}", "w").write(red(open(f).read()))

def scan():
    files = [f for f in glob.glob(OUT + "/**", recursive=True) if os.path.isfile(f)]
    for r in RUNS:
        files.append(f"{W}/validation/cloudflare/{r}.json")
        files += [f for f in glob.glob(f"{W}/validation/cloudflare/{r}/**", recursive=True) if os.path.isfile(f)]
    bad = 0
    for f in files:
        t = open(f, errors="replace").read()
        hits = [k for k, v in sec.items() if v and v in t]
        h = HEX.findall(t)
        if hits or h:
            bad += 1; print(f.replace(W + "/", ""), hits, "hex32:", len(h))
    print(len(files), "files scanned,", bad, "with hits")

{"copy": copy, "scan": scan}[sys.argv[1]]()
