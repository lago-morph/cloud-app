import os, sys
# Scan files for any .dev.vars value; print only names of variables found and files, never values.
W = "/home/user/cloud-app/.claude/worktrees/agent-a0cf9fa37f79e1389/"
vals = {}
for line in open(W + "apps/template/.dev.vars"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        v = v.strip().strip('"')
        if len(v) >= 8:
            vals[k] = v
dirs = [W + "validation/local/phase-B", W + "apps/template/.logs"]
hits = 0
scanned = 0
for d in dirs:
    for root, _, files in os.walk(d):
        for f in files:
            p = os.path.join(root, f)
            try:
                data = open(p, "rb").read().decode("utf-8", "replace")
            except Exception:
                continue
            scanned += 1
            for k, v in vals.items():
                if v in data:
                    hits += 1
                    print(f"FOUND value of {k} in {p.replace(W, '')}")
print(f"scanned {scanned} files for values of {sorted(vals)}; hits={hits}")
