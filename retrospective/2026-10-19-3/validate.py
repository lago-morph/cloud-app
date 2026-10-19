import re, os, glob, json, collections
import yaml
P=[]
md = glob.glob("docs/**/*.md", recursive=True) + ["CLAUDE.md"]
allf = md + glob.glob("docs/contracts/**/*.*", recursive=True)
T = {f: open(f).read() for f in allf}
# links
for f in md:
    for m in re.finditer(r"\]\(([^)#\s]+)(#[^)]*)?\)", T[f]):
        t=m.group(1)
        if t.startswith("http"): continue
        p=os.path.normpath(os.path.join(os.path.dirname(f),t))
        if not os.path.exists(p): P.append(f"{f}: broken link {t}")
# json/yaml
for f in glob.glob("docs/contracts/schemas/*.json"): json.load(open(f))
yaml.safe_load(open("docs/contracts/http/framework.openapi.yaml"))
# areas
cmap=T["docs/architecture/component-map.md"]
areas=set(re.findall(r"\[`([A-Z]+)`\]\(", cmap))
# requirement headings
reqdef=collections.Counter(); reqfile={}
derives={}
for f in md:
    for m in re.finditer(r"^#### ((?:[A-Z]+)-REQ-\d{3}) — .*\n(.*)", T[f], re.M):
        rid=m.group(1); reqdef[rid]+=1; reqfile[rid]=f
        d=re.findall(r"SYS-REQ-\d{3}", m.group(2))
        if not rid.startswith("SYS"):
            derives[rid]=d
            if not d: P.append(f"{rid}: no Derives from")
            if rid.split("-")[0] not in areas: P.append(f"{rid}: unknown area")
for r,c in reqdef.items():
    if c>1: P.append(f"duplicate {r}")
sys_reqs={r for r in reqdef if r.startswith("SYS")}
for r,d in derives.items():
    for x in d:
        if x not in sys_reqs: P.append(f"{r} derives from undefined {x}")
# AC rows
acdef=collections.Counter(); verified=collections.defaultdict(list)
for f in md:
    for m in re.finditer(r"^\| ((?:[A-Z]+)-AC-\d{3}) \|(.*)\|", T[f], re.M):
        aid=m.group(1); acdef[aid]+=1
        cols=[c.strip() for c in m.group(2).split("|")]
        v=re.findall(r"[A-Z]+-REQ-\d{3}", cols[-2] if len(cols)>=2 else "")
        if not v: P.append(f"{aid}: verifies nothing")
        for x in v:
            if x not in reqdef: P.append(f"{aid} verifies undefined {x}")
            verified[x].append(aid)
        if aid.split("-")[0]!=v[0].split("-")[0] if v else False: P.append(f"{aid} verifies other area {v}")
for a,c in acdef.items():
    if c>1: P.append(f"duplicate {a}")
for r in reqdef:
    if not r.startswith("SYS") and r not in verified: P.append(f"{r}: no acceptance criterion")
# E2E
e2e=T["docs/acceptance/e2e-scenarios.md"]
e2ev=collections.defaultdict(list)
for m in re.finditer(r"^#### (E2E-\d{3}) — .*\nVerifies: (.*)", e2e, re.M):
    for x in re.findall(r"SYS-REQ-\d{3}", m.group(2)):
        if x not in sys_reqs: P.append(f"{m.group(1)} verifies undefined {x}")
        e2ev[x].append(m.group(1))
derived_sys=collections.defaultdict(list)
for r,d in derives.items():
    if r in verified:
        for x in d: derived_sys[x].append(r)
for s in sorted(sys_reqs):
    if s not in e2ev and s not in derived_sys: P.append(f"{s}: not verified by any E2E or component requirement")
    if s not in e2ev: print(f"note: {s} has no E2E (covered via {derived_sys[s][:3]})")
# refs
retired=set()
for f,t in T.items():
    for m in re.finditer(r'^Retired IDs: (.*)$', t, re.M): retired |= set(re.findall(r'[A-Z]+-(?:REQ|AC|OQ)-\d+', m.group(1)))
dl=T["docs/decisions/decision-log.md"]; pr=T["docs/parameters/parameters.md"]
for f,s in T.items():
    for d in set(re.findall(r"DEC-\d{4}",s)):
        if f"### {d} " not in dl: P.append(f"{f}: undefined {d}")
    for p in set(re.findall(r"PAR-\d{3}",s)):
        if f"| {p} |" not in pr and p!="PAR-014": P.append(f"{f}: undefined {p}")
    for x in set(re.findall(r"\b[A-Z]+-(?:REQ|AC)-\d{3}\b",s)):
        if x not in reqdef and x not in acdef and x not in retired: P.append(f"{f}: undefined {x}")
    if f!="docs/decisions/decision-log.md":
        for kw in ["webhook","queue","dead-letter","dlq"]:
            if re.search(kw,s,re.I): P.append(f"{f}: forbidden term '{kw}'")
# error codes used are in catalogue
cat=T["docs/contracts/ts/errors.d.ts"]
codes=set(re.findall(r'"([A-Z]+\.[A-Z_]+)":',cat))
for f,s in T.items():
    for c in set(re.findall(r"`([A-Z]+\.[A-Z_]+)`",s)):
        if c not in codes and not c.startswith("PAR"): P.append(f"{f}: error code {c} not in catalogue")
print(f"areas={len(areas)} reqs={len(reqdef)} acs={len(acdef)} e2e={len(set(sum(e2ev.values(),[])))} codes={len(codes)}")
print("\n".join(P) or "NO PROBLEMS")
