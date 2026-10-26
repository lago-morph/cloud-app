# Counts Cloudflare API requests: api.cloudflare.com lines in trace-*.log (Node fetch trace),
# measurement curls in ledger.txt, and SST state calls in sstlogs-*/*sst.log.copy (one per
# "INFO locking/unlocking/getting/putting/pushing/pulling/passphrase..." line and per
# "found existing bucket"). Prints per-file counts, total, max in any 5-minute window, 429s.
# Usage: python3 -I count.py <dir> [--json]
import glob, sys, re, json
from datetime import datetime, timedelta
P = sys.argv[1]
ts = []; per = {}; n429 = 0
SST = re.compile(r'msg="(INFO (locking|unlocking|getting|putting|pushing|pulling|passphrase not found|setting|removing|deleting)|found existing bucket)')
def add(k, t): ts.append(t); per[k] = per.get(k, 0) + 1
for f in sorted(glob.glob(P + "/trace-*.log")):
    k = f.split("/")[-1]
    for l in open(f, errors="replace"):
        if "api.cloudflare.com" not in l: continue
        add(k, datetime.fromisoformat(l.split()[0].replace("Z", "+00:00")))
        if re.search(r"-> 429\b", l): n429 += 1
try:
    for l in open(P + "/ledger.txt"):
        add("ledger.txt", datetime.fromisoformat(l.split()[0].replace("Z", "+00:00")))
        if re.search(r"-> 429\b", l): n429 += 1
except FileNotFoundError: pass
for f in sorted(glob.glob(P + "/sstlogs-*/*sst.log.copy")):
    k = f.split("/")[-2]
    for l in open(f, errors="replace"):
        if SST.search(l):
            m = re.match(r"time=(\S+)", l)
            add(k + " (sst)", datetime.fromisoformat(m.group(1).replace("Z", "+00:00")))
for f in glob.glob(P + "/sstlogs-*/*.copy"):
    if re.search(r"429 Too Many Requests|\b429\b.*(rate|Too Many)|status(Code)?[=: ]+429", open(f, errors="replace").read()): n429 += 1
ts.sort(); mx = 0; j = 0
for i in range(len(ts)):
    while ts[i] - ts[j] > timedelta(minutes=5): j += 1
    mx = max(mx, i - j + 1)
out = {"per": per, "total": len(ts), "max5min": mx, "http429": n429}
print(json.dumps(out) if "--json" in sys.argv else f"{per}\ntotal {len(ts)} max5min {mx} 429s {n429}")
