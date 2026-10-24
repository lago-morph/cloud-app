# Usage: python3 -I collect.py copy|scan
# copy: copies the pass-2to5 evidence into validation/cloudflare/pass-2to5/logs/ with redaction.
# scan: scans the logs dir and the four driver records for the token, account ID, subdomain,
#       apiKey value and 32-hex strings; prints hits by name only.
import os, re, glob, shutil, sys
S = "/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad"
P = S + "/p25"
W = "/home/user/cloud-app/.claude/worktrees/agent-a8b428a0dd59e2c86"
OUT = W + "/validation/cloudflare/pass-2to5/logs"
RUNS = ["cwcrlz8fxgo3ud4", "5tr1c8w0x1b9lai", "2nl855v5sscoqls", "0ljocvikeb16ebm"]
sec = {
    "token": os.environ["CLOUDFLARE_API_TOKEN"],
    "account": os.environ["CLOUDFLARE_ACCOUNT_ID"],
    "subdomain": re.search(r"\.([a-z0-9-]+)\.workers\.dev", open(S + "/p1c/rurl.txt").read()).group(1),
    "apikey": open(S + "/p1c/apikey.secret").read().strip(),
}
HEX = re.compile(r"[0-9a-f]{32,}", re.I)

def red(t):
    t = t.replace(sec["token"], "<TOKEN>").replace(sec["apikey"], "<APIKEY>").replace(sec["account"], "<ACCOUNT>")
    t = t.replace("." + sec["subdomain"] + ".workers.dev", ".<SUBDOMAIN>.workers.dev")
    t = t.replace(sec["subdomain"], "<SUBDOMAIN>")
    return HEX.sub("<HEX32+>", t)

def copy():
    os.makedirs(OUT + "/tooling", exist_ok=True)
    os.makedirs(OUT + "/measure", exist_ok=True)
    for f in ["driver.sh", "measure.sh", "step.sh", "count.py", "trouble.sh", "collect.py", "fetch-trace.mjs", "logwatch.mjs"]:
        open(f"{OUT}/tooling/{f}", "w").write(red(open(f"{P}/{f}").read()))
    for f in glob.glob(P + "/*.log") + glob.glob(P + "/ledger.txt") + glob.glob(P + "/d1q-today.json"):
        open(f"{OUT}/{os.path.basename(f)}", "w").write(red(open(f, errors="replace").read()))
    for f in glob.glob(P + "/raw/*.json"):
        open(f"{OUT}/measure/{os.path.basename(f)}", "w").write(red(open(f).read()))
    d = OUT + "/sstlogs-6-remove"; os.makedirs(d, exist_ok=True)
    for f in glob.glob(P + "/sstlogs-6-remove/*.copy"):
        open(f"{d}/{os.path.basename(f)}", "w").write(red(open(f, errors="replace").read()))

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
