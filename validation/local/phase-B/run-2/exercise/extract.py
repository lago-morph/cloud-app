import json, re, sys, collections
O = "/home/user/cloud-app/.claude/worktrees/agent-a0cf9fa37f79e1389/validation/local/phase-B/run-2/"
TAG = re.compile(r"\[((?:[A-Z]+-AC|E2E)-\d{3})\]")
root = "/home/user/cloud-app/.claude/worktrees/agent-a0cf9fa37f79e1389/"

def vitest(path, label):
    d = json.load(open(O + path))
    rows = []
    for f in d["testResults"]:
        fn = f["name"].replace(root, "")
        for a in f["assertionResults"]:
            rows.append((fn, a["fullName"], a["status"]))
        if not f["assertionResults"] and f.get("status") == "failed":
            rows.append((fn, "(file failed to load) " + (f.get("message") or "")[:200], "failed"))
    c = collections.Counter(r[2] for r in rows)
    print(f"## {label}: total={len(rows)} " + " ".join(f"{k}={v}" for k, v in sorted(c.items())))
    print(f"   numTotalTests={d['numTotalTests']} passed={d['numPassedTests']} failed={d['numFailedTests']} pending={d['numPendingTests']} todo={d['numTodoTests']}")
    for fn, name, st in rows:
        if st != "passed":
            print(f"- {st} | {fn} | {name} | tags: {','.join(TAG.findall(name)) or '(none)'}")
    return rows

def pw(path, label):
    d = json.load(open(O + path))
    rows = []
    def walk(s, file):
        file = s.get("file", file)
        for sp in s.get("specs", []):
            for t in sp["tests"]:
                st = t["status"]  # expected/unexpected/skipped/flaky
                rows.append((file, sp["title"], st, [r["status"] for r in t["results"]]))
        for ch in s.get("suites", []):
            walk(ch, file)
    for s in d["suites"]:
        walk(s, s.get("file"))
    c = collections.Counter(r[2] for r in rows)
    print(f"## {label}: total={len(rows)} " + " ".join(f"{k}={v}" for k, v in sorted(c.items())) + f" stats={d['stats']}")
    for file, title, st, res in rows:
        print(f"- {st} {res} | {file} | {title} | tags: {','.join(TAG.findall(title)) or '(none)'}")

mode = sys.argv[1]
if mode == "unit":
    vitest("03-test-unit.vitest.json", "unit (vitest)")
elif mode == "int":
    rows = vitest("05a-integration-vitest.json", "integration (vitest)")
    pw("05b-integration-playwright.json", "integration (playwright)")
    untagged = [r for r in rows if not TAG.search(r[1])]
    print(f"## integration vitest tests without an ID tag in title: {len(untagged)}")
