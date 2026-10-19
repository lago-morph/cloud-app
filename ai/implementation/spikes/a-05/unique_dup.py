"""E11 (MIG-AC-003 shape): a migration whose data-dependent statement fails (unique index over duplicate
rows) placed in the MIDDLE of the file, after a drop column on a table with child rows. Creates and deletes
its own database. Usage: python3 -I unique_dup.py"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1, experiments as ex  # noqa: E402

u = d1.create(d1.PREFIX + "-a05-uniq")
try:
    log = ex.Log("e11-unique-over-duplicates")
    ex.reset(u)
    d1.query(u, "ALTER TABLE parent ADD COLUMN legacy TEXT; INSERT INTO parent (id, name) VALUES (2, 'p1')")
    log("# E11 unique index over duplicate names, in the middle of a PRAGMA-prefixed request")
    log("BEFORE")
    ex.state(u, log)
    stmts = [ex.PRAGMA, "ALTER TABLE parent DROP COLUMN legacy", "CREATE TABLE extra (id INTEGER PRIMARY KEY)",
             "CREATE UNIQUE INDEX parent_name_uq ON parent (name)", "ALTER TABLE parent ADD COLUMN later TEXT"]
    log("STATEMENTS", stmts)
    ex.send(u, log, stmts, "string")
    log("AFTER")
    ex.state(u, log)
    log.save()
finally:
    print("delete:", d1.delete(u), "mine left:", d1.list_mine())
