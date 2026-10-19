"""Fallback copy prototype (migrations.md §2 "Fallback copy"): copy every table page by page through the D1
/query API, parents before the rows that reference them, every page one atomic `batch` request starting with
`PRAGMA defer_foreign_keys = on`, pages within D1 limits (<=100 bound parameters per statement, SQL text far
below 100 KB because every value is a bound parameter, <=PAGE_BYTES of values / PAGE_ROWS rows per request,
a single larger row alone in its page).

Exactness: values are read as (typeof, text form) and re-bound by type: integer -> CAST(? AS INTEGER) from
its decimal text (exact int64), real -> JSON double (exact), text -> string, blob -> unhex(?) from hex,
null -> NULL. JSON numbers alone would bind as REAL (probe E5d), so integers never travel as JSON numbers.

Ordering: tables are grouped into strongly connected components of the reference graph (Tarjan); groups are
copied parents first. An acyclic single table is streamed by rowid. A group with a cycle (self-reference or
tables referencing each other) gets a row-level reference graph from a metadata pass; its row SCCs are
emitted parents first and a row SCC is never split across pages, so deferral inside one batch covers it.

Usage: python3 -I fallback_copy.py <src-uuid-key> <dst-suffix>   (uses run.py's state file)"""
import json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1api  # noqa: E402

PAGE_ROWS = int(os.environ.get("PAGE_ROWS", "1000"))
PAGE_BYTES = int(os.environ.get("PAGE_BYTES", "1000000"))
MAX_PARAMS = 100
stats = {"requests": 0, "read_requests": 0, "pages": 0}


def raw(uuid, sql, params=None):
    stats["read_requests"] += 1
    r = d1api.q_ok(uuid, sql, params, raw=True)[-1]["results"]
    return r.get("rows", [])


def batch(uuid, items):
    stats["requests"] += 1
    s, b = d1api.call("POST", f"{d1api.BASE}/{uuid}/query", {"batch": items})
    if not b.get("success"):
        raise RuntimeError(d1api.redact(f"batch failed {s}: {json.dumps(b.get('errors'))[:500]}"))


def tarjan(nodes, edges):
    """SCCs in an order where every SCC comes after the SCCs it points to (edges: node -> parents)."""
    index, low, on, stack, out, counter = {}, {}, set(), [], [], [0]
    sys.setrecursionlimit(100000)

    def visit(v):
        index[v] = low[v] = counter[0]; counter[0] += 1
        stack.append(v); on.add(v)
        for w in edges.get(v, ()):
            if w not in index:
                visit(w); low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp = []
            while True:
                w = stack.pop(); on.discard(w); comp.append(w)
                if w == v:
                    break
            out.append(comp)
    for v in nodes:
        if v not in index:
            visit(v)
    return out


def table_info(src):
    tables = [r[0] for r in raw(src, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
                                     "AND name NOT LIKE '_cf_%' ORDER BY rowid")]
    cols, fks = {}, {}
    for t in tables:
        info = raw(src, f'PRAGMA table_info("{t}")')  # cid, name, type, notnull, dflt, pk
        pks = [r for r in info if r[5]]
        has_alias = len(pks) == 1 and pks[0][2].upper() == "INTEGER"
        # copy the hidden rowid too, so the copy keeps rowids (and thus unordered scan order) identical
        cols[t] = ([] if has_alias else ["rowid"]) + [r[1] for r in info]
        # foreign_key_list rows: id, seq, table, from, to, on_update, on_delete, match
        fks[t] = [(r[2], r[3], r[4]) for r in raw(src, f'PRAGMA foreign_key_list("{t}")')]
    return tables, cols, fks


def sel_list(cols):
    return ", ".join(f'typeof("{c}"), CASE typeof("{c}") WHEN \'integer\' THEN CAST("{c}" AS TEXT) '
                     f'WHEN \'blob\' THEN hex("{c}") ELSE "{c}" END' for c in cols)


def value_bytes(row):
    return sum(len(v.encode()) if isinstance(v, str) else 8 for v in row[1::2] if v is not None)


def insert_items(t, cols, rows):
    """rows: lists of alternating (typeof, value). Multi-row INSERTs with <= MAX_PARAMS parameters each."""
    items, per = [], max(1, MAX_PARAMS // len(cols))
    for i in range(0, len(rows), per):
        chunk, tuples, params = rows[i:i + per], [], []
        for row in chunk:
            parts = []
            for k in range(len(cols)):
                typ, val = row[2 * k], row[2 * k + 1]
                if typ == "null":
                    parts.append("NULL")
                elif typ == "integer":
                    parts.append("CAST(? AS INTEGER)"); params.append(val)
                elif typ == "blob":
                    parts.append("unhex(?)"); params.append(val)
                else:
                    parts.append("?"); params.append(val)
            tuples.append("(" + ", ".join(parts) + ")")
        col_list = ", ".join(f'"{c}"' for c in cols)
        items.append({"sql": f'INSERT INTO "{t}" ({col_list}) VALUES ' + ", ".join(tuples), "params": params})
    return items


class Pager:
    """Accumulates (table, cols, row, scc_id) units and flushes pages within the limits."""

    def __init__(self, dst):
        self.dst, self.units, self.rows, self.bytes = dst, [], 0, 0

    def add_group(self, group):  # group: list of (t, cols, row) that must share a page
        size = sum(value_bytes(r) for _, _, r in group)
        if self.units and (self.rows + len(group) > PAGE_ROWS or self.bytes + size > PAGE_BYTES):
            self.flush()
        self.units.extend(group); self.rows += len(group); self.bytes += size

    def flush(self):
        if not self.units:
            return
        items = [{"sql": "PRAGMA defer_foreign_keys = on"}]
        i = 0
        while i < len(self.units):  # consecutive rows of one table -> multi-row inserts
            t, cols, _ = self.units[i]
            j = i
            while j < len(self.units) and self.units[j][0] == t:
                j += 1
            items.extend(insert_items(t, cols, [r for _, _, r in self.units[i:j]]))
            i = j
        batch(self.dst, items)
        stats["pages"] += 1
        self.units, self.rows, self.bytes = [], 0, 0


def copy(src, dst, log):
    t0 = time.time()
    tables, cols, fks = table_info(src)
    schema = raw(src, "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE '_cf_%' "
                      "AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
    batch(dst, [{"sql": s} for typ, _, s in schema if typ == "table"])
    groups = tarjan(tables, {t: [p for p, _, _ in fks[t]] for t in tables})
    log(f"table groups (parents first): {groups}")
    pager = Pager(dst)
    for g in groups:
        cyclic = len(g) > 1 or any(p == g[0] for p, _, _ in fks[g[0]])
        if not cyclic:
            t, last = g[0], None
            while True:
                where = "" if last is None else f"WHERE rowid > {last}"
                # read page size adapts to row size: probe sizes first
                sizes = raw(src, f'SELECT rowid, {" + ".join(f"coalesce(length(CAST(\"{c}\" AS BLOB)), 0)" for c in cols[t])} '
                                 f'FROM "{t}" {where} ORDER BY rowid LIMIT {PAGE_ROWS}')
                if not sizes:
                    break
                take, acc = [], 0
                for rid, sz in sizes:
                    if take and acc + sz > PAGE_BYTES:
                        break
                    take.append(rid); acc += sz
                rows = raw(src, f'SELECT {sel_list(cols[t])} FROM "{t}" WHERE rowid BETWEEN {take[0]} AND {take[-1]} ORDER BY rowid')
                for r in rows:
                    pager.add_group([(t, cols[t], r)])
                last = take[-1]
            continue
        # cyclic group: metadata pass (rowid, primary key, reference columns) for row-level ordering
        nodes, edges, by_key = [], {}, {}
        for t in g:
            refs = [(p, frm, to) for p, frm, to in fks[t] if p in g]
            pk = [r[1] for r in raw(src, f'PRAGMA table_info("{t}")') if r[5] == 1]
            meta = raw(src, f'SELECT rowid, {", ".join(f"\"{c}\"" for c in pk)}'
                            f'{"".join(f", \"{frm}\"" for _, frm, _ in refs)} FROM "{t}" ORDER BY rowid')
            for m in meta:
                node = (t, m[0]); nodes.append(node)
                by_key[(t, tuple(m[1:1 + len(pk)]))] = node
            for m in meta:
                node = (t, m[0])
                edges[node] = [(p, (m[1 + len(pk) + k],)) for k, (p, _, _) in enumerate(refs) if m[1 + len(pk) + k] is not None]
        edges = {n: [by_key[e] for e in es if e in by_key] for n, es in edges.items()}
        row_sccs = tarjan(nodes, edges)
        log(f"cyclic group {g}: {len(nodes)} rows, {len(row_sccs)} row SCCs, largest {max(len(s) for s in row_sccs)}")
        # fetch values page-wise per table by rowid lists (<= MAX_PARAMS ids per read), keep SCC order
        values = {}
        for t in g:
            ids = [rid for tt, rid in nodes if tt == t]
            for i in range(0, len(ids), MAX_PARAMS):
                part = ids[i:i + MAX_PARAMS]
                rows = raw(src, f'SELECT rowid, {sel_list(cols[t])} FROM "{t}" WHERE rowid IN ({",".join("?" * len(part))})',
                           [str(x) for x in part])
                for r in rows:
                    values[(t, r[0])] = r[1:]
        for scc in row_sccs:
            pager.add_group([(t, cols[t], values[(t, rid)]) for t, rid in scc])
    pager.flush()
    t1 = time.time()
    # indexes after the data; then sqlite_sequence (AUTOINCREMENT tables only; not portable)
    idx = [s for typ, _, s in schema if typ == "index"]
    if idx:
        batch(dst, [{"sql": s} for s in idx])
    try:
        seq = raw(src, "SELECT name, seq FROM sqlite_sequence")
    except RuntimeError:
        seq = []
    if seq:
        batch(dst, [{"sql": "DELETE FROM sqlite_sequence"}] +
              [{"sql": "INSERT INTO sqlite_sequence (name, seq) VALUES (?, CAST(? AS INTEGER))", "params": [n, str(s)]} for n, s in seq])
    t2 = time.time()
    return {"data_s": round(t1 - t0, 2), "index_seq_s": round(t2 - t1, 2), **stats,
            "page_rows": PAGE_ROWS, "page_bytes": PAGE_BYTES}


if __name__ == "__main__":
    st = json.load(open(os.environ["A06_STATE"]))
    suffix = sys.argv[1]
    name = f"spikecmmrxula-a06-{suffix}"
    logf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", f"fallback-{suffix}.txt"), "a")

    def log(m):
        m = d1api.redact(m); print(m); logf.write(m + "\n"); logf.flush()

    log(f"=== fallback copy -> {name} @ {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} PAGE_ROWS={PAGE_ROWS} PAGE_BYTES={PAGE_BYTES}")
    dst = d1api.create(name)
    st.setdefault("dst", {})[suffix] = dst
    json.dump(st, open(os.environ["A06_STATE"], "w"))
    log(f"created {name}")
    info = copy(st["src"], dst, log)
    log("fallback info: " + json.dumps(info))
