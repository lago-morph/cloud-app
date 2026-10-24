# Prints D1 written/read/database count for each measurement label in raw/. Usage: python3 -I readings.py <dir>
import json, sys, glob, os
P = sys.argv[1]
for f in sorted(glob.glob(P + "/raw/d1-*.json"), key=os.path.getmtime):
    l = os.path.basename(f)[3:-5]
    g = json.load(open(f))["data"]["viewer"]["accounts"][0]["d1AnalyticsAdaptiveGroups"]
    n = len(json.load(open(f"{P}/raw/d1list-{l}.json")).get("result") or [])
    print(l, "written", sum(x["sum"]["rowsWritten"] for x in g), "read", sum(x["sum"]["rowsRead"] for x in g), "dbs", n)
