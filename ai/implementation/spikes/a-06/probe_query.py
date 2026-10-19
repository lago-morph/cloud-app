"""Probe the D1 /query API on a scratch database: does PRAGMA foreign_keys=off work, does the `batch` body
(statements with params) work and is it atomic, can a deferred-FK batch insert child rows first, how big a
bound parameter may be, and how many parameters a statement may have. Deletes its database at the end."""
import json, sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1api  # noqa: E402

u = d1api.create("spikecmmrxula-a06-probe")


def show(label, s, b):
    res = b.get("result")
    if isinstance(res, list):
        res = [r.get("results") if isinstance(r, dict) else r for r in res]
    print(label, "->", s, b.get("success"), d1api.redact(json.dumps(b.get("errors")))[:300],
          d1api.redact(json.dumps(res))[:300])


def batch(items):
    return d1api.call("POST", f"{d1api.BASE}/{u}/query", {"batch": items})


try:
    show("setup", *d1api.query(u, "CREATE TABLE p (id text PRIMARY KEY); CREATE TABLE c (id text PRIMARY KEY, p text NOT NULL REFERENCES p(id))"))
    show("E3a foreign_keys=off then orphan insert (one request)", *d1api.query(u, "PRAGMA foreign_keys = off; INSERT INTO c VALUES ('c1','nope'); PRAGMA foreign_keys"))
    show("E3b count c", *d1api.query(u, "SELECT count(*) AS n FROM c"))
    show("E3c PRAGMA foreign_keys (fresh request)", *d1api.query(u, "PRAGMA foreign_keys"))
    show("E4a batch body with params", *batch([{"sql": "INSERT INTO p VALUES (?)", "params": ["p1"]},
                                               {"sql": "INSERT INTO c VALUES (?,?)", "params": ["c2", "p1"]}]))
    show("E4b count", *d1api.query(u, "SELECT (SELECT count(*) FROM p) AS p, (SELECT count(*) FROM c) AS c"))
    show("E4c batch atomic? (2nd fails)", *batch([{"sql": "INSERT INTO p VALUES (?)", "params": ["p2"]},
                                                  {"sql": "INSERT INTO c VALUES (?,?)", "params": ["c3", "missing"]}]))
    show("E4d count after failed batch", *d1api.query(u, "SELECT (SELECT count(*) FROM p) AS p, (SELECT count(*) FROM c) AS c"))
    show("E4e batch with defer: child first", *batch([{"sql": "PRAGMA defer_foreign_keys = on"},
                                                      {"sql": "INSERT INTO c VALUES (?,?)", "params": ["c4", "p4"]},
                                                      {"sql": "INSERT INTO p VALUES (?)", "params": ["p4"]}]))
    show("E4f count", *d1api.query(u, "SELECT (SELECT count(*) FROM p) AS p, (SELECT count(*) FROM c) AS c"))
    show("E5a create t", *d1api.query(u, "CREATE TABLE t (id text PRIMARY KEY, body text)"))
    show("E5b insert 1.9MB (950000 x U+00E9) param", *d1api.query(u, "INSERT INTO t VALUES (?, ?)", ["big", "é" * 950000]))
    show("E5c read back", *d1api.query(u, "SELECT length(body) AS chars, length(CAST(body AS blob)) AS bytes FROM t WHERE id='big'"))
    show("E5d param types", *d1api.query(u, "SELECT typeof(?) a, typeof(?) b, typeof(?) c, typeof(?) d, typeof(?) e, typeof(?) f",
                                         [1, 1.5, "s", None, True, 9007199254740993]))
    show("E5e nul via param", *d1api.query(u, "INSERT INTO t VALUES (?, ?)", ["nul", "a\u0000b"]))
    show("E5f nul read", *d1api.query(u, "SELECT length(body) l, hex(body) h FROM t WHERE id='nul'"))
    show("E5g 2.1MB param", *d1api.query(u, "INSERT INTO t VALUES (?, ?)", ["toobig", "z" * 2100000]))
    show("E6a 100 params", *d1api.query(u, "SELECT " + ",".join("?" * 100), list(range(100))))
    show("E6b 101 params", *d1api.query(u, "SELECT " + ",".join("?" * 101), list(range(101))))
finally:
    print("delete probe", d1api.delete(u))
