"""E8: upper bounds on one /query request (body size, statement count). Logged to logs/e8-upper-bounds.txt."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1, experiments as ex  # noqa: E402

u = open(sys.argv[1]).read().strip()
log = ex.Log("e8-upper-bounds")
ex.reset(u)
d1.query(u, "CREATE TABLE blob_t (id INTEGER PRIMARY KEY, v TEXT)")
log("# E8 upper bounds of one POST /query request (sql-string form, PRAGMA-prefixed)")


def run(label, sql):
    log(f"## {label}, body ~{len(sql) / 1e6:.1f} MB")
    s, b, t = d1.query(u, sql)
    log(f"  http={s} success={b.get('success')} elapsed={t:.1f}s errors={b.get('errors')} "
        f"non_json={str(b.get('_non_json'))[:300]}")
    _, c, _ = d1.query(u, "SELECT count(*) AS n FROM blob_t")
    log("  rows now:", c["result"][0]["results"])
    d1.query(u, "DELETE FROM blob_t")
    return s


for n in (300, 560, 1100):
    if run(f"{n} statements of ~90 kB", ";\n".join([ex.PRAGMA] + [ex.big_insert(i, 90_000) for i in range(n)])) != 200:
        break
for n in (50_000, 100_000, 200_000):
    sql = ";\n".join([ex.PRAGMA] + [f"INSERT INTO blob_t (id, v) VALUES ({i}, 'v')" for i in range(n)])
    if run(f"{n} small statements", sql) != 200:
        break
log.save()
