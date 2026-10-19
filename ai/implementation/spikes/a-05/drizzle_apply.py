"""E10: apply real drizzle-kit 0.31.11 SQLite migration files (drizzle/0000_v1.sql, 0001_v2.sql) to a remote
D1 database, each file sent unmodified as ONE /query request: "PRAGMA defer_foreign_keys = on;\\n" + file text
(+ the migration-record insert in the same request). First 0001 is sent with a failing statement appended
(nothing must change), then as-is (everything must change). Usage: python3 -I drizzle_apply.py <uuid-file>"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d1, experiments as ex  # noqa: E402

u = open(sys.argv[1]).read().strip()
log = ex.Log("e10-drizzle-files")
files = {n: open(os.path.join(HERE, "drizzle", n)).read() for n in ("0000_v1.sql", "0001_v2.sql")}
RECORD = ("CREATE TABLE IF NOT EXISTS __framework_migrations (id TEXT PRIMARY KEY, dialect TEXT NOT NULL, "
          "checksum TEXT NOT NULL, applied_at TEXT NOT NULL)")


def body(name, extra=""):
    rec = (f"INSERT INTO __framework_migrations (id, dialect, checksum, applied_at) "
           f"VALUES ('{name}', 'sqlite', 'sha256-placeholder', '2026-10-19T00:00:00Z')")
    return f"PRAGMA defer_foreign_keys = on;\n{files[name]};\n{rec};\n{extra}"


def show(label, sql):
    log(f"## {label}")
    log("REQUEST POST .../query body={\"sql\": <below>}\n" + sql)
    s, b, t = d1.query(u, sql)
    log("RESPONSE http=%s success=%s errors=%s statements=%s" % (
        s, b.get("success"), b.get("errors"), len(b.get("result") or [])))
    log("AFTER")
    ex.state(u, log)
    _, c, _ = d1.query(u, "PRAGMA table_info(child)")
    log("  child columns:", [r["name"] for r in c["result"][0]["results"]])


log("# E10 drizzle-kit generated files applied as one request each")
d1.query(u, RECORD)
show("0000_v1.sql", body("0000_v1.sql"))
d1.query(u, "INSERT INTO parent (id, name) VALUES (1, 'a'), (2, 'b'); "
            "INSERT INTO child (id, parent_id, legacy) VALUES (1, 1, 'old'), (2, 2, 'old')")
log("seeded parent(1,2), child(1->1, 2->2)")
show("0001_v2.sql + failing last statement (duplicate primary key)",
     body("0001_v2.sql", "INSERT INTO parent (id, name) VALUES (1, 'dup');"))
show("0001_v2.sql as generated", body("0001_v2.sql"))
log.save()
