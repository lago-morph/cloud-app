"""Cuts the small Sessionize fixtures in tests/fixtures/sessionize/ from data/raw.

Usage (from kubecon-planner/): python3 -I data/cut-fixtures.py data/raw tests/fixtures/sessionize
"""
import json, sys
raw, out = sys.argv[1], sys.argv[2]
def cut(code, ids, name):
    d = json.load(open(f"{raw}/sessionize-{code}-All.json"))
    sessions = [s for s in d["sessions"] if s["id"] in ids]
    assert len(sessions) == len(ids), (code, set(ids) - {s["id"] for s in sessions})
    spk = {i for s in sessions for i in s["speakers"]}
    cats = {i for s in sessions for i in s["categoryItems"]}
    rooms = {s["roomId"] for s in sessions}
    speakers = []
    for p in d["speakers"]:
        if p["id"] in spk:
            p = dict(p, bio=(p.get("bio") or "")[:80], sessions=[x for x in p["sessions"] if str(x) in ids], profilePicture=None)
            speakers.append(p)
    categories = []
    for c in d["categories"]:
        items = [i for i in c["items"] if i["id"] in cats]
        if items: categories.append(dict(c, items=items))
    for s in sessions:
        if s["description"]: s["description"] = s["description"][:200]
    result = {"sessions": sessions, "speakers": speakers, "questions": d["questions"], "categories": categories,
              "rooms": [r for r in d["rooms"] if r["id"] in rooms]}
    with open(f"{out}/{name}.ts", "w") as f:
        f.write('// Cut from data/raw/sessionize-*-All.json (see README "Test fixtures"); descriptions and bios shortened.\n')
        f.write("export const feed: unknown = \n")
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write(";\n")
    print(name, len(sessions), "sessions", len(speakers), "speakers")
cut("svi82w6c", ["1302801","1367757","1250350","1202489","1250326","1289755","1289947","1344383","1340051"], "main")
cut("ayajbd6b", ["1312032","1311951","1311945","1309409","1311893","1309453"], "colocated")
cut("qtujim6y", ["1318410","1290687","1318418"], "maintainer")
cut("etvmcsmr", ["1344383","1341814"], "sponsor")
