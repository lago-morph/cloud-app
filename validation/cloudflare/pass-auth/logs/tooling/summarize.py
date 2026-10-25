# Prints one measurement's readings. Usage: python3 -I summarize.py <dir> <label>
import json, sys, os
P, l = sys.argv[1], sys.argv[2]
d = json.load(open(f"{P}/raw/d1-{l}.json"))
if d.get("errors"): print("graphql errors:", d["errors"])
g = d["data"]["viewer"]["accounts"][0]["d1AnalyticsAdaptiveGroups"]
print("D1 today: groups", len(g), "rowsRead", sum(x["sum"]["rowsRead"] for x in g), "rowsWritten", sum(x["sum"]["rowsWritten"] for x in g))
d = json.load(open(f"{P}/raw/d1list-{l}.json"))
print("D1 databases:", len(d.get("result") or []), [x.get("name") for x in d.get("result") or []])
d = json.load(open(f"{P}/raw/sststate-{l}.json"))
ks = [x.get("key") for x in d.get("result") or []]
print("sst-state objects:", len(ks), sorted({"/".join(k.split("/")[:3]) for k in ks}))
d = json.load(open(f"{P}/raw/mailsink-{l}.json"))
r = d.get("result") or []
print("mailsink objects:", len(r), "truncated:", (d.get("result_info") or {}).get("is_truncated"), "errors:", d.get("errors"))
for k in ("workers", "buckets"):
    f = f"{P}/raw/{k}-{l}.json"
    if os.path.exists(f):
        d = json.load(open(f)); res = d.get("result")
        if k == "buckets": res = (res or {}).get("buckets", [])
        print(k + ":", [x.get("id") or x.get("name") for x in res or []])
