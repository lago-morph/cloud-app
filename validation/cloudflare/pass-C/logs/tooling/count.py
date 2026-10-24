# Counts api.cloudflare.com requests in trace-*.log and ledger.txt; max in any 5-minute window; 429s.
import glob,sys,re
from datetime import datetime,timedelta
P="/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/pC"
ts=[];per={};n429=0
for f in sorted(glob.glob(P+"/trace-*.log"))+[P+"/ledger.txt"]:
    try: lines=open(f).read().splitlines()
    except FileNotFoundError: continue
    k=f.split("/")[-1]; c=0
    for l in lines:
        if "trace-" in k and "api.cloudflare.com" not in l: continue
        if "ledger" in k and "graphql" not in l and "GET" not in l and "POST" not in l and "DELETE" not in l: continue
        t=datetime.fromisoformat(l.split()[0].replace("Z","+00:00")); ts.append(t); c+=1
        if re.search(r"-> 429\b",l): n429+=1
    per[k]=c
ts.sort(); mx=0; j=0
for i in range(len(ts)):
    while ts[i]-ts[j]>timedelta(minutes=5): j+=1
    mx=max(mx,i-j+1)
print(per); print("total",len(ts),"max5min",mx,"429s",n429)
