# Root cause: pass 1c. FILES-AC-001 list order on Cloudflare. R2 lists a name after the names that extend it (`…/a` after `…/a b` and `…/a/b`). The files service passes the store's order through unchanged, and assumes it is code point order, which DEC-0162 checked only against local R2.

Author: diagnosing subagent (prompt §8). I did not write the code under diagnosis, and I did not run pass 1c. This is a diagnosis only. No code or test was changed, and no Cloudflare call was made.

Base: `origin/claude/implement-local-cloudflare` `71ac98d`. Evidence: `validation/cloudflare/xdryowrec3lephb.json`, `validation/cloudflare/xdryowrec3lephb/raw/vitest.log`, `validation/cloudflare/pass-1c/SUMMARY.md`.

A different subagent must review this record.

## Symptom
`tests/compliance/criteria/files/server-operations.test.ts:77` `[FILES-AC-001] list returns exactly the prefix's names in code point order across several pages`, failed on Cloudflare (`raw/vitest.log:281-301`):

```
  [
    "c-t3/ac001-list/698fba180f17/B",
    "c-t3/ac001-list/698fba180f17/Z",
-   "c-t3/ac001-list/698fba180f17/a",
    "c-t3/ac001-list/698fba180f17/a b",
    "c-t3/ac001-list/698fba180f17/a/b",
+   "c-t3/ac001-list/698fba180f17/a",
    "c-t3/ac001-list/698fba180f17/b",
    "c-t3/ac001-list/698fba180f17/é",
  ]
```

Each name appears exactly once, and the outsider (`…-outside/x`) is excluded. Only the position of `…/a` is wrong. The other FILES-AC-001 tests (round trip, overwrite, missing) passed. The same test passes locally (`validation/local` records; C-local evaluation).

## Evidence

E1. **The requirement is code point order, and it is owner-origin.** `docs/components/files.md` FILES-REQ-001 (Origin: owner): "`list` returns files whose names start with the prefix (literal) in code point order, with pagination behaving like KV-REQ-003". `docs/contracts/ts/files.d.ts:51` says the same. The test's expected array sorts by code points (`server-operations.test.ts:89-94`). For these names (ASCII plus `é`), code point order equals UTF-8 byte order: `B` (0x42) < `Z` < `a` < `a b` < `a/b` < `b` < `é` (0xC3 0xA9). A proper prefix sorts before its extensions in both. **So the test is correct.** It also matches R2's documented order: the Workers API reference says the list result is "ordered lexicographically" (developers.cloudflare.com, R2 Workers API reference, `list`), and `start_after` is "after a given key in lexicographic order" (Cloudflare TS SDK, `r2/buckets/objects.ts`). Under any byte-lexicographic order, `a` sorts before `a b`.

E2. **The service emits the store's order verbatim.** `packages/framework/src/files/service.ts:117-139`: `list` calls `store.list({ prefix, limit: min(limit+1-found, 1000), include: ["httpMetadata"], startAfter? })` repeatedly, appends `page.objects` in the order returned, and slices. It never sorts. The cursor (`src/files/cursor.ts`) holds the last returned name, and the next page is `startAfter: <that name>` (DEC-0162). The reference route `apps/reference/src/server/routes/files.ts:13-17` maps items one to one. The test helper `tests/compliance/criteria/files/support.ts:54-59` concatenates pages.

E3. **With a store in code point order, the service cannot produce the observed sequence.** Pages of 3 (the test's limit) give the received sequence as `[B, Z, a b]`, `[a/b, a, b]`, `[é]`. Every store call returns objects after `startAfter` in the store's order. For `a b` to be emitted before `a`, either one R2 call returned `a b` before `a`, or a call with `startAfter` ∈ {`B`, `Z`} returned `a b` and not `a`. Both mean that R2 placed `a` after `a b`. In the same way, `a/b` came before `a`. `a` still came before `b`. The service has no other source of order.

E4. **Why local passes.** The local binding is Miniflare's R2 simulator: `node_modules/miniflare/dist/src/workers/r2/bucket.worker.js:650-666` lists with `WHERE substr(key, 1, length(:prefix)) = :prefix AND (:start_after IS NULL OR key > :start_after) ORDER BY key LIMIT :limit` over `_mf_objects (key TEXT PRIMARY KEY …)` (line 296). This is SQLite's BINARY collation, which is UTF-8 byte order and therefore code point order. DEC-0162 "Order" records only this local check ("Local R2 lists in code point order. Checked with `getPlatformProxy` (Wrangler 4.149.0)"). Its probe names (`p/Z`, `p/a`, `p/ä`, `p/€`, `p/😀`) include no name that is a proper prefix of another, so it could not have seen this. The unit fake (`src/files/fake-store.test-support.ts:1-17`, "Lists in code point order like R2") also assumes code point order. No test ever ran the service against R2's real order before this pass.

E5. **The observed R2 order fits one simple rule, which is not yet proven.** All seven positions match this rule: compare bytes; where one key ends and the other continues, **the shorter key sorts after the longer one**, that is, a key sorts after its own extensions. Checks: `a b` vs `a`: `a` is a prefix → `a b` first. `a/b` vs `a` → `a/b` first. `a` vs `b`: they differ at byte 0 → `a` first. `a b` vs `a/b`: 0x20 < 0x2F. `B`, `Z` before all `a…`, `é` last. These are consistent with the received order. One observation cannot separate this rule from others, for example "end of key sorts between 0x2F and 0x62", or an order that only `include: ["httpMetadata"]` or `startAfter` paging produces. No public R2 document states it (E1). workerd's R2 binding forwards `list` to the R2 service, and `node_modules` has no R2 server code. **This link (which rule R2 applies) is unproven** and needs the probe in "How the fix will be verified". The cause does not depend on it, and neither does the recommended fix (below): E1–E4 prove that R2's order differs from code point order for a name that is a proper prefix of another, and that the service passes that order through.

## Chain from cause to symptom
1. FILES-REQ-001 requires code point order (E1).
2. → The service relies on the store for order, and pages with `startAfter` in the store's order (E2, DEC-0162).
3. → Local R2 (Miniflare, SQLite BINARY) orders by bytes, so local tests and the code point fake pass (E4).
4. → Real R2 places `…/a` after `…/a b` and `…/a/b` (E3; the exact rule is E5).
5. → The listing on Cloudflare returns R2's order, and `toStrictEqual(expected)` fails (symptom).

## Alternatives ruled out
- **The test is wrong.** Ruled out (E1). The order the test expects is FILES-REQ-001's, and it is also R2's documented order.
- **A paging bug in the service (lost or duplicated item, wrong cursor).** Ruled out. Each name occurs once, and the outsider is excluded. The order of emission is the store's (E2, E3).
- **A locale or UTF-16 sort somewhere.** Ruled out. Locale order would put `a` near `B`. UTF-16 and code point order agree for these BMP names. Nothing in the chain sorts (E2).
- **Eventual consistency (a late `put` of `…/a`).** Ruled out. `…/a` was put second of seven (`server-operations.test.ts:83-84`), and R2 is strongly consistent for list after write. A late object would be missing, not moved.
- **Sort in the service per page.** This is not a fix. With R2's order and `startAfter`, page 1 (`limit 3`) holds `B, Z, a b`, and `a` is not among the objects fetched. A cursor issued in code point order (after `a`) would also make R2 skip `a b` and `a/b` under E5's rule. Exact code point order across pages from a store with a different order needs, in the worst case, a scan of every extension of a name: one name `x` with any number of names `x/…`. That is unbounded per page.

## Proposed fix (minimal, red-green)
**Recommended (needs the probe's confirmation that R2 accepts the byte):** make every stored key end in a terminator byte that no name can contain and that sorts below every byte a name can contain: `U+0001`. FILES-REQ-002 forbids U+0000–U+001F in names, so `name + "\u0001"` is unambiguous. No stored key is then a proper prefix of another stored key, so R2's handling of a key's end never decides an order. The remaining order is byte order of the names, which is code point order. This holds under E5's rule and under any byte-wise order that differs only at the end of a key. U+0001 is used rather than U+0000 because NUL is more likely to be refused by HTTP and storage tooling.
- `src/files/service.ts`: store/get/head/delete use `storeKey(name) = name + "\u0001"`. `list` passes `prefix` unchanged and `startAfter: storeKey(after)`, and strips the terminator from each `object.key` in `infoOf`. A listed key without the terminator is skipped and logged: such an object was not written by this service.
- `src/files/cloudflare/tickets.ts` (signed URLs): sign and address the stored key, so `%01` is in the path. The SigV4 canonical URI encodes it like any other byte (check `sign.unit.test.ts` vectors).
- Local: the same service code runs against Miniflare, so local behaviour stays code point order.
- The name limit PAR-230 stays on the name. The stored key is one byte longer. Check that PAR-230 + 1 ≤ R2's 1,024-byte key limit.
- Existing objects. Test stages only (no production data exists in this phase). Pass 2 removes and redeploys stage R, or clears `reference-test-…-files`.
- Record a decision amending DEC-0162 "Order", citing this record.

**Alternative, if R2 refuses the byte or the owner prefers it:** ask the owner to change FILES-REQ-001 (owner-origin) to "the storage platform's lexicographic order, each name once". The test then changes in step with the requirement, never before. This is an owner question, not a fix the implementer can make.

**Red test (local, no Cloudflare):**
1. `src/files/fake-store.test-support.ts`: add an option `order: "codepoint" | "r2-observed"`. `r2-observed` compares by UTF-8 bytes, but where one key is a proper prefix of the other, the shorter key sorts after. `list` sorts and applies `startAfter` with the selected comparator, so the fake reproduces E3's sequence for these names.
2. `src/files/service.unit.test.ts`, `[FILES-AC-001]`: with `order: "r2-observed"`, put `p/b, p/a, p/B, p/a/b, p/é, p/a b, p/Z`, list with `limit: 3` following cursors, and expect `[p/B, p/Z, p/a, p/a b, p/a/b, p/b, p/é]` with each once. Also cover `shortPages: 1`. Today this is red: received `[…, p/a b, p/a/b, p/a, …]`, as on Cloudflare. A second case adds `p/a/c` … `p/a/z` (more than one page of extensions of `p/a`) so that a per-page sort cannot make it pass.
3. With the fix, both cases are green under both orders. The existing code point tests stay unchanged.

## How the fix will be verified
1. Before the implementation: one bounded probe on the kept stage R (`reference-test-9mfkg261apxm7s2-files`, or a scratch prefix in it), a handful of requests. `put` `q/a`, `q/a b`, `q/a/b`, `q/a!`, `q/b`. Then `list({prefix:"q/"})` with and without `include`, and `list({prefix:"q/", startAfter:"q/a"})`. Record the orders, which confirm or refute E5's rule. Also `put`/`get`/`list` `q/x\u0001`, and a presigned `GET` of it, to confirm R2 accepts the terminator. Delete the probe keys. Record the results in this record's Review or an addendum.
2. Red-green unit tests above. `npm run test:unit`, and the local driver (FILES-AC-001 still passes locally against Miniflare).
3. Pass 2: FILES-AC-001 on Cloudflare `passed` in the evidence record, and FILES-AC-002 (names with `/`, `%`, `..`, non-ASCII) and FILES-AC-003/-004 transfers still pass with terminated keys.

## Review
