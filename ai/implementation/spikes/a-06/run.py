"""Spike A-06 driver. Usage: python3 -I run.py <step> [args]
Steps: setup | export | import-api <dst-suffix> | import-batch <dst-suffix> | compare <dst-suffix> | cleanup | leftovers
State (database UUIDs) lives in $A06_STATE (scratchpad, not committed). Logs go to logs/<step>.txt, redacted."""
import json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1api, fixture  # noqa: E402

PREFIX = "spikecmmrxula-a06"
HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.environ["A06_STATE"]
DUMP = os.environ["A06_DUMP"]
step = sys.argv[1]
logf = open(os.path.join(HERE, "logs", f"{step}{('-' + sys.argv[2]) if len(sys.argv) > 2 else ''}.txt"), "a")


def log(msg):
    msg = d1api.redact(msg)
    print(msg)
    logf.write(msg + "\n")
    logf.flush()


def load():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def save(s):
    json.dump(s, open(STATE, "w"))


st = load()
log(f"=== {step} {' '.join(sys.argv[2:])} @ {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")

if step == "setup":
    src = d1api.create(f"{PREFIX}-src")
    st["src"] = src
    save(st)
    log(f"created {PREFIX}-src")
    t0 = time.time()
    d1api.q_ok(src, ";\n".join(fixture.SCHEMA))
    for b in fixture.BULK:
        r = d1api.q_ok(src, b)
        log(f"bulk insert: changes={r[0]['meta'].get('changes')}")
    for sql, params in fixture.insert_statements():
        d1api.q_ok(src, sql, params)
    r = d1api.q_ok(src, fixture.LITERAL_BATCH)
    log(f"literal batch: {len(r)} statements ok")
    for bid, expr in fixture.BIG:
        r = d1api.q_ok(src, f"INSERT INTO big_text (id, body) SELECT '{bid}', {expr}")
        log(f"big_text {bid}: changes={r[0]['meta'].get('changes')}")
    log(f"setup took {time.time() - t0:.1f}s")
    fp = fixture.fingerprint(d1api.q_ok, src)
    st["fp_src"] = fp
    save(st)
    log("source fingerprint: " + json.dumps({k: v for k, v in fp.items() if k != "__schema__"}, ensure_ascii=False))
    size = d1api.call("GET", f"{d1api.BASE}/{src}")[1]["result"].get("file_size")
    log(f"source file_size bytes: {size}")

elif step == "export":
    data, info = d1api.export(st["src"], log)
    open(DUMP, "wb").write(data)
    st["export"] = info
    save(st)
    log("export info: " + json.dumps(info))

elif step in ("import-api", "import-batch"):
    suffix = sys.argv[2]
    name = f"{PREFIX}-{suffix}"
    dst = d1api.create(name)
    st.setdefault("dst", {})[suffix] = dst
    save(st)
    log(f"created {name}")
    data = open(DUMP, "rb").read()
    if step == "import-api":
        info = d1api.import_file(dst, data, log)
    else:
        sql = "PRAGMA defer_foreign_keys = on;\n" + data.decode("utf-8")
        t0 = time.time()
        s, b = d1api.query(dst, sql)
        info = {"http": s, "success": b.get("success"), "errors": d1api.redact(json.dumps(b.get("errors")))[:600],
                "seconds": round(time.time() - t0, 2), "statements": len(b.get("result") or []),
                "request_bytes": len(sql.encode())}
    st.setdefault("imports", {})[suffix] = info
    save(st)
    log("import info: " + json.dumps(info))
    if os.environ.get("A06_DROP") == "1":
        log(f"delete {name}: {d1api.delete(dst)}")

elif step == "compare":
    suffix = sys.argv[2]
    fp = fixture.fingerprint(d1api.q_ok, st["dst"][suffix])
    src = st["fp_src"]
    diffs = []
    for k in sorted(set(src) | set(fp)):
        if json.dumps(src.get(k)) != json.dumps(fp.get(k)):
            diffs.append(k)
            log(f"DIFF {k}:\n  src={json.dumps(src.get(k), ensure_ascii=False)[:600]}\n  dst={json.dumps(fp.get(k), ensure_ascii=False)[:600]}")
    log(f"compare {suffix}: {'IDENTICAL' if not diffs else 'differs in ' + ', '.join(diffs)}")
    log("dst fingerprint: " + json.dumps({k: v for k, v in fp.items() if k != "__schema__"}, ensure_ascii=False))

elif step == "cleanup":
    for name, uuid in d1api.list_names():
        if name.startswith(PREFIX):
            log(f"delete {name}: {d1api.delete(uuid)}")

elif step == "leftovers":
    mine = [n for n, _ in d1api.list_names() if n.startswith(PREFIX)]
    log(f"remaining {PREFIX}* databases: {mine}")
