"""A-05 experiments: is one D1 HTTP API request (one migration file, prefixed with
PRAGMA defer_foreign_keys = on) applied atomically? Each experiment is logged (redacted) to logs/<id>.txt.

Usage: python3 -I experiments.py <uuid-file> [experiment ids...]"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1  # noqa: E402

LOGDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
PRAGMA = "PRAGMA defer_foreign_keys = on"


class Log:
    def __init__(self, name):
        self.name, self.lines = name, []

    def __call__(self, *parts):
        text = " ".join(str(p) for p in parts)
        self.lines.append(text)
        print(text)

    def save(self):
        with open(os.path.join(LOGDIR, self.name + ".txt"), "w", encoding="utf-8") as f:
            f.write(d1.redact("\n".join(self.lines)) + "\n")


def state(u, log):
    """Print schema and row counts (the 'what was applied' check)."""
    s, b, _ = d1.query(u, "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    objs = [(r["type"], r["name"]) for r in b["result"][0]["results"]]
    log("  schema:", objs)
    for t, n in objs:
        if t == "table":
            _, b2, _ = d1.query(u, f'SELECT * FROM "{n}" ORDER BY 1')
            cols = list(b2["result"][0]["results"][0].keys()) if b2["result"][0]["results"] else None
            log(f"  {n}: rows={b2['result'][0]['results']} cols={cols}")
    _, b3, _ = d1.query(u, "PRAGMA foreign_key_check")
    log("  foreign_key_check:", b3["result"][0]["results"] if b3.get("success") else b3.get("errors"))


def send(u, log, sql_or_stmts, form):
    if form == "string":
        log("REQUEST POST .../d1/database/<uuid>/query body={\"sql\": <statements joined with ';\\n'>}")
        res = d1.query(u, sql_or_stmts if isinstance(sql_or_stmts, str) else ";\n".join(sql_or_stmts))
    else:
        log("REQUEST POST .../d1/database/<uuid>/query body={\"batch\": [{\"sql\": ...}, ...]}")
        res = d1.batch(u, [{"sql": s} for s in sql_or_stmts])
    log("RESPONSE", d1.summary(*res))
    return res


def reset(u):
    """Fresh baseline: parent(1), child(1 -> 1), foreign keys enforced."""
    _, b, _ = d1.query(u, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
    names = [r["name"] for r in b["result"][0]["results"]]
    stmts = [PRAGMA] + [f'DROP TABLE IF EXISTS "{n}"' for n in names] + [
        "CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))",
        "INSERT INTO parent (id, name) VALUES (1, 'p1')",
        "INSERT INTO child (id, parent_id) VALUES (1, 1)",
    ]
    s, b, _ = d1.query(u, ";\n".join(stmts))
    assert b.get("success"), d1.redact(json.dumps(b))


def migration_failing_last(kind):
    """A realistic multi-change migration whose LAST statement fails in the given way."""
    body = [
        PRAGMA,
        "CREATE TABLE m_new (id INTEGER PRIMARY KEY, v TEXT)",
        "INSERT INTO m_new (id, v) VALUES (1, 'x')",
        "ALTER TABLE parent ADD COLUMN extra TEXT DEFAULT 'd'",
        "CREATE INDEX parent_name_idx ON parent (name)",
        "INSERT INTO parent (id, name) VALUES (2, 'p2')",
        "UPDATE parent SET name = 'changed' WHERE id = 1",
        "DELETE FROM child WHERE id = 1",
    ]
    last = {
        "pk": "INSERT INTO parent (id, name) VALUES (1, 'duplicate primary key')",
        "notnull": "INSERT INTO parent (id, name) VALUES (3, NULL)",
        "fk_deferred": "INSERT INTO child (id, parent_id) VALUES (2, 999)",
        "syntax": "INSERT INTO parent (id, name) VALUSE (4, 'typo')",
        "missing_table": "INSERT INTO no_such_table VALUES (1)",
        "none": "INSERT INTO parent (id, name) VALUES (3, 'valid last statement')",
    }[kind]
    return body + [last]


def exp_atomic(u, form, kinds=None):
    for kind in kinds or ["pk", "notnull", "fk_deferred", "syntax", "missing_table"]:
        log = Log(f"e1-atomic-{form}-{kind}")
        reset(u)
        log(f"# E1 atomicity, request form={form}, last statement fails: {kind}")
        log("BEFORE")
        state(u, log)
        stmts = migration_failing_last(kind)
        log("STATEMENTS", json.dumps(stmts, indent=1))
        send(u, log, stmts, form)
        log("AFTER")
        state(u, log)
        log.save()


def exp_deferred_fk_ok(u):
    log = Log("e2-deferred-fk-child-before-parent")
    reset(u)
    log("# E2 child inserted before its parent in one request, with and without the PRAGMA prefix")
    for prefix in (False, True):
        stmts = ([PRAGMA] if prefix else []) + [
            f"INSERT INTO child (id, parent_id) VALUES ({10 + prefix}, {20 + prefix})",
            f"INSERT INTO parent (id, name) VALUES ({20 + prefix}, 'late parent')",
        ]
        log(f"## prefix={prefix}")
        send(u, log, stmts, "string")
    log("AFTER")
    state(u, log)
    log.save()


def rebuild(table_new_cols):
    """drizzle-kit's SQLite table-rebuild shape for a referenced table."""
    return [
        f"CREATE TABLE __new_parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL{table_new_cols})",
        "INSERT INTO __new_parent (id, name) SELECT id, name FROM parent",
        "DROP TABLE parent",
        "ALTER TABLE __new_parent RENAME TO parent",
    ]


def exp_rebuild(u):
    log = Log("e3-rebuild-referenced-table")
    log("# E3 drizzle-style rebuild of a table that another table references (DROP + RENAME)")
    reset(u)
    log("## without PRAGMA prefix")
    send(u, log, rebuild(", note TEXT"), "string")
    state(u, log)
    reset(u)
    log("## with PRAGMA defer_foreign_keys = on prefix")
    send(u, log, [PRAGMA] + rebuild(", note TEXT"), "string")
    state(u, log)
    log("## drizzle's own wrapper: PRAGMA foreign_keys=OFF ... PRAGMA foreign_keys=ON (inside one request)")
    reset(u)
    send(u, log, ["PRAGMA foreign_keys=OFF"] + rebuild(", note2 TEXT") + ["PRAGMA foreign_keys=ON"], "string")
    state(u, log)
    log("## does the pragma persist into the next request?")
    s, b, _ = d1.query(u, "PRAGMA defer_foreign_keys; PRAGMA foreign_keys")
    log(d1.summary(s, b, _))
    log.save()


def exp_explicit_txn(u):
    log = Log("e4-explicit-transaction")
    reset(u)
    log("# E4 explicit BEGIN/COMMIT and SAVEPOINT inside a request")
    send(u, log, ["BEGIN TRANSACTION", "INSERT INTO parent (id, name) VALUES (5, 'x')", "COMMIT"], "string")
    send(u, log, ["SAVEPOINT s1", "INSERT INTO parent (id, name) VALUES (6, 'y')", "RELEASE s1"], "string")
    state(u, log)
    log.save()


def big_insert(i, size):
    return f"INSERT INTO blob_t (id, v) VALUES ({i}, '{'a' * size}')"


def exp_limits(u):
    log = Log("e5-size-limits")
    reset(u)
    d1.query(u, "CREATE TABLE blob_t (id INTEGER PRIMARY KEY, v TEXT)")
    log("# E5 size limits (statement length, request size, statement count)")
    for size in (90_000, 99_000, 100_000, 101_000, 200_000, 1_100_000):
        res = d1.query(u, big_insert(size, size))
        log(f"## single statement, string literal {size} bytes, statement length {len(big_insert(size, size))}")
        log(d1.summary(*res))
    d1.query(u, "DELETE FROM blob_t")
    # request size: many 90 kB statements
    for n in (12, 56, 112, 160):
        stmts = [PRAGMA] + [big_insert(i, 90_000) for i in range(n)]
        sql = ";\n".join(stmts)
        log(f"## one request, {n} statements of ~90 kB, sql string {len(sql)} bytes")
        res = d1.query(u, sql)
        log(d1.summary(*res).replace("\n", " ")[:1500])
        _, b, _ = d1.query(u, "SELECT count(*) AS n FROM blob_t")
        log("  rows now:", b["result"][0]["results"])
        d1.query(u, "DELETE FROM blob_t")
    # statement count
    for n in (1000, 5000, 20000):
        stmts = [PRAGMA] + [f"INSERT INTO blob_t (id, v) VALUES ({i}, 'v')" for i in range(n)]
        res = d1.query(u, ";\n".join(stmts))
        log(f"## one request, {n} small INSERT statements")
        log(d1.summary(*res).replace("\n", " ")[:800])
        _, b, _ = d1.query(u, "SELECT count(*) AS n FROM blob_t")
        log("  rows now:", b["result"][0]["results"])
        d1.query(u, "DELETE FROM blob_t")
    # batch form, large
    stmts = [PRAGMA] + [big_insert(i, 90_000) for i in range(56)]
    res = d1.batch(u, [{"sql": s} for s in stmts])
    log("## batch-array form, 56 statements of ~90 kB")
    log(d1.summary(*res).replace("\n", " ")[:1500])
    _, b, _ = d1.query(u, "SELECT count(*) AS n FROM blob_t")
    log("  rows now:", b["result"][0]["results"])
    d1.query(u, "DELETE FROM blob_t")
    log.save()


def exp_large_atomic(u):
    log = Log("e6-large-request-failing-last")
    reset(u)
    d1.query(u, "CREATE TABLE blob_t (id INTEGER PRIMARY KEY, v TEXT)")
    log("# E6 large request (~5 MB, 56 x 90 kB inserts + 5000 small inserts) whose last statement fails")
    stmts = [PRAGMA] + [big_insert(i, 90_000) for i in range(56)] + \
        [f"INSERT INTO blob_t (id, v) VALUES ({1000 + i}, 'v')" for i in range(5000)] + \
        ["INSERT INTO parent (id, name) VALUES (1, 'duplicate primary key')"]
    log("statements:", len(stmts), "bytes:", len(";\n".join(stmts)))
    for form in ("string", "batch"):
        log(f"## form={form}")
        if form == "string":
            res = d1.query(u, ";\n".join(stmts))
        else:
            res = d1.batch(u, [{"sql": s} for s in stmts])
        log(d1.summary(*res).replace("\n", " ")[:1500])
        _, b, _ = d1.query(u, "SELECT count(*) AS n FROM blob_t")
        log("  blob_t rows after:", b["result"][0]["results"])
    log.save()


def exp_supported_shapes(u):
    """migrations.md 'Supported changes' shapes on a referenced table, each as one PRAGMA-prefixed request."""
    log = Log("e7-supported-change-shapes")
    log("# E7 supported-change shapes involving the referenced table `parent`, each one request with the PRAGMA prefix")
    cases = {
        "add nullable column + static-default column": ["ALTER TABLE parent ADD COLUMN a TEXT",
                                                        "ALTER TABLE parent ADD COLUMN b INTEGER NOT NULL DEFAULT 0"],
        "add column with REFERENCES (nullable)": ["ALTER TABLE child ADD COLUMN other_parent INTEGER REFERENCES parent(id)"],
        "drop column of referenced table": ["ALTER TABLE parent ADD COLUMN gone TEXT", "ALTER TABLE parent DROP COLUMN gone"],
        "add + drop index, unique index": ["CREATE UNIQUE INDEX parent_name_uq ON parent (name)",
                                           "CREATE INDEX child_parent_idx ON child (parent_id)",
                                           "DROP INDEX parent_name_uq"],
        "drop parent then child (wrong order) in one request": ["DROP TABLE parent", "DROP TABLE child"],
        "drop child then parent": ["DROP TABLE child", "DROP TABLE parent"],
        "drop referenced parent only (child rows remain) -> must fail": ["DROP TABLE parent"],
        "rebuild of the referencing table (child)": [
            "CREATE TABLE __new_child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id), n TEXT)",
            "INSERT INTO __new_child (id, parent_id) SELECT id, parent_id FROM child",
            "DROP TABLE child", "ALTER TABLE __new_child RENAME TO child"],
        "rebuild of referenced table + delete/reinsert children (workaround probe)": [
            "CREATE TABLE __tmp_child AS SELECT * FROM child", "DELETE FROM child"] + rebuild(", note TEXT") + [
            "INSERT INTO child SELECT * FROM __tmp_child", "DROP TABLE __tmp_child"],
    }
    for title, stmts in cases.items():
        reset(u)
        log(f"## {title}")
        log("STATEMENTS", json.dumps([PRAGMA] + stmts))
        send(u, log, [PRAGMA] + stmts, "string")
        state(u, log)
    log.save()


if __name__ == "__main__":
    uuid = open(sys.argv[1]).read().strip()
    which = sys.argv[2:] or ["e0", "e1s", "e1b", "e2", "e3", "e4", "e5", "e6", "e7"]
    for w in which:
        {"e0": lambda: exp_atomic(uuid, "string", ["none"]) or exp_atomic(uuid, "batch", ["none"]),
         "e1s": lambda: exp_atomic(uuid, "string"), "e1b": lambda: exp_atomic(uuid, "batch"),
         "e2": lambda: exp_deferred_fk_ok(uuid), "e3": lambda: exp_rebuild(uuid),
         "e4": lambda: exp_explicit_txn(uuid), "e5": lambda: exp_limits(uuid),
         "e6": lambda: exp_large_atomic(uuid), "e7": lambda: exp_supported_shapes(uuid)}[w]()
