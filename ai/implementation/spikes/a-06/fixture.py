"""Source-database fixture and fingerprint for spike A-06.

Fixture: framework-shaped tables (text id primary keys, text references, NOT NULL / nullable columns) plus
deliberately awkward cases: a child table whose name sorts before its parent, a three-level chain, a
self-reference whose child row is inserted before its parent, a two-table reference cycle, large text rows
(up to ~1.9 MB, beyond D1's 100 KB statement limit), unicode and control characters, NULL vs '' vs 'NULL',
32/53/64-bit integer edges, awkward reals, and (non-portable, informative) BLOBs, NUL inside text, -0.0 and
an AUTOINCREMENT table (sqlite_sequence)."""
import hashlib, json

SCHEMA = [
    "CREATE TABLE z_parent (id text PRIMARY KEY NOT NULL, name text NOT NULL, note text, n integer, r real, ts integer, flag integer)",
    "CREATE UNIQUE INDEX z_parent_name_unique ON z_parent (name)",
    "CREATE TABLE a_child (id text PRIMARY KEY NOT NULL, parent_id text NOT NULL REFERENCES z_parent(id), body text)",
    "CREATE INDEX a_child_parent_idx ON a_child (parent_id)",
    "CREATE TABLE m_grandchild (id text PRIMARY KEY NOT NULL, child_id text NOT NULL REFERENCES a_child(id), parent_id text REFERENCES z_parent(id))",
    "CREATE TABLE self_ref (id text PRIMARY KEY NOT NULL, parent_id text REFERENCES self_ref(id))",
    "CREATE TABLE cyc_a (id text PRIMARY KEY NOT NULL, b_id text REFERENCES cyc_b(id))",
    "CREATE TABLE cyc_b (id text PRIMARY KEY NOT NULL, a_id text REFERENCES cyc_a(id))",
    "CREATE TABLE big_text (id text PRIMARY KEY NOT NULL, body text NOT NULL)",
    "CREATE TABLE __framework_kv (key text PRIMARY KEY NOT NULL, value text)",
    "CREATE TABLE __framework_migrations (id text PRIMARY KEY NOT NULL, dialect text NOT NULL, checksum text NOT NULL, applied_at integer NOT NULL)",
    "CREATE TABLE x_extras (id integer PRIMARY KEY AUTOINCREMENT, b blob, i integer, r real, t text)",
]

# Generated bulk rows (recursive CTEs run inside D1).
BULK = [
    """WITH RECURSIVE c(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM c WHERE k < 2000)
       INSERT INTO z_parent (id, name, note, n, r, ts, flag)
       SELECT printf('p%05d', k), printf('parent-%05d', k),
              CASE WHEN k % 3 = 0 THEN NULL WHEN k % 3 = 1 THEN '' ELSE 'note ' || k END,
              CASE WHEN k % 5 = 0 THEN NULL ELSE k * 1000003 - 1000000000 END,
              CASE WHEN k % 7 = 0 THEN NULL ELSE k / 7.0 END,
              1760000000000 + k, k % 2 FROM c""",
    """WITH RECURSIVE c(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM c WHERE k < 5000)
       INSERT INTO a_child (id, parent_id, body)
       SELECT printf('c%05d', k), printf('p%05d', (k % 2000) + 1),
              CASE WHEN k % 4 = 0 THEN NULL ELSE 'body ' || hex(randomblob(40)) END FROM c""",
    """WITH RECURSIVE c(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM c WHERE k < 5000)
       INSERT INTO m_grandchild (id, child_id, parent_id)
       SELECT printf('g%05d', k), printf('c%05d', ((k * 7) % 5000) + 1),
              CASE WHEN k % 2 = 0 THEN NULL ELSE printf('p%05d', ((k * 3) % 2000) + 1) END FROM c""",
]

UNICODE = [
    ("u01", "héllo wörld"), ("u02", "日本語のテキスト"), ("u03", "👨‍👩‍👧‍👦 family emoji 🏳️‍🌈"),
    ("u04", "שלום עולם مرحبا"), ("u05", "é combining"), ("u06", "zero​width﻿bom"),
    ("u07", "it's \"quoted\" `back` \\ slash"), ("u08", "line1\nline2\r\nline3\ttab"),
    ("u09", "semi; -- comment /* c */ ;"), ("u10", ""), ("u11", "NULL"), ("u12", "ctrl \x01\x07\x1b\x7f"),
    ("u13", "𝔘𝔫𝔦𝔠𝔬𝔡𝔢 astral 𐍈"), ("u14", "  leading and trailing spaces  "), ("u15", "x'00ff' literal"),
    ("u16", "\U0010FFFF max code point"),
]


def insert_statements():
    """(sql, params) pairs, each sent as its own /query call (params limited to 100 per statement)."""
    out = []
    for k, v in UNICODE:
        out.append(("INSERT INTO __framework_kv (key, value) VALUES (?, ?)", [k, v]))
    out.append(("INSERT INTO __framework_kv (key, value) VALUES (?, ?)", ["n01", None]))
    for i, (k, v) in enumerate(UNICODE):
        out.append(("INSERT INTO z_parent (id, name, note, n, r, ts, flag) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [f"q{i:04d}", f"uni-{k}", v, None, None, None, None]))
    out.append(("INSERT INTO __framework_migrations VALUES (?, ?, ?, ?)", ["0000_init", "sqlite", "a" * 64, 1760000000123]))
    out.append(("INSERT INTO __framework_migrations VALUES (?, ?, ?, ?)", ["0001_more", "sqlite", "b" * 64, 1760000000456]))
    return out


# Statements whose values cannot travel as JSON params (exact int64, -0.0, blobs, NUL) or need deferral.
LITERAL_BATCH = """
PRAGMA defer_foreign_keys = on;
INSERT INTO self_ref (id, parent_id) VALUES ('s2', 's1');
INSERT INTO self_ref (id, parent_id) VALUES ('s1', NULL);
INSERT INTO self_ref (id, parent_id) VALUES ('s3', 's3');
INSERT INTO cyc_a (id, b_id) VALUES ('a1', 'b1');
INSERT INTO cyc_b (id, a_id) VALUES ('b1', 'a1');
INSERT INTO cyc_a (id, b_id) VALUES ('a2', NULL);
INSERT INTO z_parent (id, name, n, r, ts, flag) VALUES ('e001', 'edge-int32', 2147483647, 0.1, 9007199254740991, 1);
INSERT INTO z_parent (id, name, n, r, ts, flag) VALUES ('e002', 'edge-int32-min', -2147483648, 1e308, 0, 0);
INSERT INTO z_parent (id, name, n, r) VALUES ('e003', 'edge-real-tiny', 2147483648, 4.9406564584124654e-324);
INSERT INTO z_parent (id, name, n, r) VALUES ('e004', 'edge-real-third', 0, 0.33333333333333331);
INSERT INTO z_parent (id, name, n, r) VALUES ('e005', 'edge-real-big-int', -1, 9007199254740993.0);
INSERT INTO z_parent (id, name, n, r) VALUES ('e006', 'edge-real-pi', 3, 3.141592653589793);
INSERT INTO z_parent (id, name, n, r) VALUES ('e007', 'edge-real-neg', -7, -2.5e-10);
INSERT INTO z_parent (id, name, n, r) VALUES ('e008', 'edge-real-whole', 8, 2.0);
INSERT INTO x_extras (b, i, r, t) VALUES (x'00ff10', 9223372036854775807, -0.0, 'nul' || char(0) || 'inside');
INSERT INTO x_extras (b, i, r, t) VALUES (x'', -9223372036854775808, 0.0, NULL);
INSERT INTO x_extras (b, i, r, t) VALUES (NULL, 9007199254740993, 1.7976931348623157e308, 'x');
INSERT INTO x_extras (b, i, r, t) VALUES (randomblob(3000), NULL, NULL, '42');
INSERT INTO x_extras (b, i, r, t) VALUES (NULL, '123', '4.5', 99);
DELETE FROM x_extras WHERE id = 2;
INSERT INTO x_extras (b, i, r, t) VALUES (NULL, 1, 1.0, 'after delete');
"""

# (id, sql expression producing the body) — generated server side so the request stays small.
BIG = [
    ("b050k", "printf('%.*c', 50000, 'a')"),
    ("b099k", "printf('%.*c', 99000, 'b')"),
    ("b150k", "hex(randomblob(75000))"),
    ("b625k", "replace(hex(zeroblob(125000)), '00', 'é€')"),     # 250,000 chars = 625,000 UTF-8 bytes
    ("b1m", "hex(randomblob(500000))"),
    ("b200kq", "replace(printf('%.*c', 100000, 'z'), 'z', '''z')"),  # 200,000 chars, half of them quotes to escape
    ("b1900k", "hex(randomblob(950000))"),                           # 1.9 MB, near D1's 2 MB row limit
]


def table_names(q, uuid):
    rows = q(uuid, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
                   "AND name NOT LIKE '_cf_%' ORDER BY name", raw=True)[0]["results"]["rows"]
    return [r[0] for r in rows]


def fingerprint(q, uuid):
    """Per table: row count and sha256 over every column's (typeof, exact value) in rowid order.
    Integers/text/blobs compared via hex(); reals via their JSON double (exact round-trip)."""
    fp = {}
    schema = q(uuid, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE '_cf_%' "
                     "AND name NOT LIKE 'sqlite_autoindex%' ORDER BY type, name", raw=True)[0]["results"]["rows"]
    fp["__schema__"] = schema
    for t in table_names(q, uuid):
        cols = [r[1] for r in q(uuid, f'PRAGMA table_info("{t}")', raw=True)[0]["results"]["rows"]]
        sel = ", ".join(f'typeof("{c}"), CASE typeof("{c}") WHEN \'real\' THEN "{c}" WHEN \'null\' THEN NULL '
                        f'ELSE hex("{c}") END' for c in cols)
        page = 1 if t == "big_text" else 500
        h = hashlib.sha256()
        n = 0
        off = 0
        while True:
            rows = q(uuid, f'SELECT {sel} FROM "{t}" ORDER BY rowid LIMIT {page} OFFSET {off}', raw=True)[0]["results"]["rows"]
            for r in rows:
                h.update(json.dumps(r, separators=(",", ":")).encode())
                n += 1
            if len(rows) < page:
                break
            off += page
        lens = None
        if t == "big_text":
            lens = q(uuid, "SELECT id, length(body), length(CAST(body AS blob)) FROM big_text ORDER BY id", raw=True)[0]["results"]["rows"]
        fp[t] = {"rows": n, "sha256": h.hexdigest()[:16], **({"lengths_chars_bytes": lens} if lens else {})}
    try:
        fp["__sqlite_sequence__"] = q(uuid, "SELECT name, seq FROM sqlite_sequence ORDER BY name", raw=True)[0]["results"]["rows"]
    except Exception as e:  # table absent
        fp["__sqlite_sequence__"] = f"absent ({str(e)[:80]})"
    fp["__fk_check__"] = q(uuid, "PRAGMA foreign_key_check", raw=True)[0]["results"]["rows"]
    return fp
