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

Reviewer: independent root-cause reviewer (prompt §8). I did not write this diagnosis or the code under it. Base `ff16516`. No Cloudflare call, no suite run.

**Verdict: cause accepted. The proposed fix is not approved as written.** The live probe must run first. If the fix is a terminator, it needs the changes below.

### Cause: accepted
- **The test is correct.** `server-operations.test.ts:89-94` sorts by code points, and FILES-REQ-001 asks for code point order (`docs/components/files.md:16`). For these names that is also UTF-8 byte order. So "R2 sorts by UTF-8 bytes" does not explain the result: byte order puts `…/a` third, and the test expects it third.
- **Paging cannot produce this sequence.** Under byte order, the cursor, `startAfter` and the limit+1 overfetch (`service.ts:117-139`, `cursor.ts:9-28`) give `[B,Z,a]` `[a b,a/b,b]` `[é]`, which is correct. A short truncated page, or a page that missed `a` through eventual consistency, cannot put `a` after `a/b` either. A `startAfter` greater than or equal to `a b` excludes `a` under byte order. So at least one R2 call returned `a` after one of its extensions, which is E3. The test was not retried (`raw/vitest.json`, one attempt, 2.16 s).
- **No delimiter or prefix-listing artefact.** No `delimiter` is passed (`service.ts:125-130`). Also, `a b` contains no `/` and still sorted before `a`. So a hierarchy or "directory" ordering alone cannot explain the result. The prefix is a fresh random id, so leftovers from an earlier run cannot interfere.
- **What remains unproven.** Is it the binding's order only, or also the S3 API's? And is the rule E5's ("a key sorts after its extensions", the same as byte order of `name + 0xFF`)? The probe below answers both.

### Fix: what the terminator breaks (each one must be handled)
1. **PAR-230 (blocking).** PAR-230 is 1,024 bytes *because* that is R2's key limit (`docs/parameters/parameters.md:54`, `names.ts:8,18`). The record's check "PAR-230 + 1 ≤ 1,024" is false. A valid 1,024-byte name would become a 1,025-byte key, and R2 would reject it with `FILES.UNAVAILABLE`. That violates FILES-REQ-002 (`files.md:23`). The FILES-AC-002 tests check only "one byte over" (`server-operations.test.ts:137-140`), so they would not catch this. **Required change:** terminate a name only when its UTF-8 length is below PAR-230. An unterminated key of 1,024 bytes can never be a proper prefix of another key, so the order still holds. Decoding stays unambiguous: strip a trailing U+0001, and keep a 1,024-byte key as it is. Add a unit test with a 1,024-byte name and a 1,023-byte name that is its prefix. Do not shrink PAR-230 instead: it is platform-origin and documented as the R2/S3 limit.
2. **Existing objects (blocking).** After deploy, `get`, `head` and `delete` address `name + U+0001` (`service.ts:105,110,115`). Every object stored before the deploy then reads as missing and cannot be deleted through the API. `list` skips it with only a log line. A silent change that looks like data loss is not acceptable. **Required:** (a) Before pass 2, inventory every `*-files` bucket in the account (owner-visible list) and record the result. (b) If any bucket other than a test stage's holds objects, add an explicit read fallback (`get`/`head` try the terminated key, then the legacy key) or a one-time rename. The decision must name which. (c) If only test stages hold objects, clear them in pass 2 and record that. In every case, list must not drop legacy keys silently: return them, or fail the call.
3. **Tickets.** `createUploadTicket`/`createDownloadTicket` `head` the store key (`service.ts:144,149`). The issuer must sign the store key (`tickets.ts:74`), but `downloadDisposition` must keep the *name*, so a download is not saved with a trailing control character. Tickets issued before the deploy point at legacy keys. The 15-minute lifetime bounds this risk, so note it but do not engineer around it.
4. **DEC-0328 changes meaning.** `keyPath` tests segments for `.`/`..` (`tickets.ts:43-49`). With the terminator, `..` becomes `..\u0001`, which is no longer a dot segment. The documented rule "a name that is only `.` or `..` gets no ticket" (`files.md:90`, DEC-0328) would then lapse silently. `x/../y` still needs the `%2F` form, because only the last segment is changed. **Required:** decide on purpose. Either apply the `.`/`..` check to the *name*, which keeps the documented limitation, or lift it and amend DEC-0328 and files.md:90. A ticket unit test must cover each case, and D-RUN's live `x/../y` check must be repeated with terminated keys.
5. **Local parity is fine.** The local route goes through `FilesService` (`local/route.ts:33,40`), and Miniflare orders by bytes, so the local target gets the same keys. The local route's own token carries the *name*. Keep it that way.
6. **Owners will see the character.** In the R2 dashboard and in `wrangler r2 object get <bucket>/<name>`, every key carries an invisible U+0001, and a lookup by the plain name fails. Document this in files.md §2 Cloudflare and in the decision. Because it is visible to owners, flag it in the plan's owner questions next to the FILES-REQ-001 alternative.
7. **S3 API and AWS.** U+0001 cannot appear in XML 1.0, so an S3 `ListObjectsV2` response without `encoding-type=url` cannot carry these keys. That affects owner tooling (`aws s3 ls`, rclone) against R2 now, and the AWS target's S3 later, because `service.ts` is target-neutral. The probe must check this. The AWS phase must list with `encoding-type=url`. Record this in the decision, or limit the terminator to the Cloudflare store (wrap the store in `targets/cloudflare`, not in the service), since S3 lists in byte order anyway. I prefer limiting it to Cloudflare. The fix stays local to the cause, and AWS keeps plain keys.

### Smaller fixes considered
- **Sort within one bounded overfetch: not sufficient.** I agree with "Alternatives ruled out". Under E5, a name follows all of its extensions, and their number is unbounded. A `head` on every proper prefix of each listed key costs up to PAR-230 calls per key. That is not bounded in any useful sense.
- **List through R2's S3 API instead of the binding: a real candidate, decided by the probe.** If S3 `ListObjectsV2` (with `start-after`) on R2 returns byte order while the binding does not, then `list` alone can use the S3 API with the stage's existing R2 token (`cloudflare/credentials.ts`, already used for tickets). The storage format does not change, legacy objects stay visible, PAR-230 is untouched, and nothing changes for owners. The cost is an extra signed `fetch` per page and XML parsing. If both paths show E5, use the terminator, as amended above.
- The owner alternative (change FILES-REQ-001) still stands, as the record says.

### Red test: one change
Before the probe, the `r2-observed` comparator in the fake is a hypothesis. After the probe, implement the rule the probe measured, cite the probe in `fake-store.test-support.ts`'s header, and change its line 3 ("Lists in code point order like R2"), which is false on Cloudflare. If the S3-list fix is chosen, the red test is a unit test of the S3 list adapter, using signed-request vectors and fixtures of the XML response.

### Probe (replaces "How the fix will be verified" step 1: a temporary bucket, not stage R; 11 objects)
1. `wrangler r2 bucket create rc-probe-r2order-<6 hex>`. Make a temporary R2 API token scoped to it, or use the stage token if it is account-scoped. Write each 1-byte object through the **binding** with a scratch Worker run by `wrangler dev --remote`, with binding `B` set to that bucket. Its routes are `put?k=`, `list?…` and `head?k=`, and they return JSON with `JSON.stringify` keys:
   `q/a`, `q/a b` (0x20), `q/a!` (0x21), `q/a/b` (0x2F), `q/a0` (0x30), `q/aa` (0x61), `q/aé` (0xC3A9), `q/b`, and the terminated keys `t/a\u0001`, `t/a b\u0001`, `t/a/b\u0001`.
2. Binding listings. Record each `objects[].key` array exactly:
   - L1 `list({prefix:"q/"})`
   - L2 the same with `include:["httpMetadata"]`
   - L3 `{prefix:"q/", startAfter:"q/a"}`
   - L4 `{prefix:"q/", startAfter:"q/a b"}`
   - L5 `{prefix:"q/", limit:2}`, following R2's own `cursor` to the end
   - L6 `{prefix:"q/a"}`
   - L7 `{prefix:"q/", delimiter:"/"}` (objects and `delimitedPrefixes`)
   - L8 `{prefix:"t/"}`

   What each rule predicts for L1. E5: `a b, a!, a/b, a0, aa, aé, a, b`. "End sorts between 0x2F and 0x30": `a b, a!, a/b, a, a0, aa, aé, b`. Byte order: `a, a b, a!, a/b, a0, aa, aé, b`. L3 shows whether `startAfter` follows the same order: under E5 it gives `[q/b]`. For the terminator fix, L8 must be `t/a\u0001, t/a b\u0001, t/a/b\u0001`.
3. S3 API (SigV4 via `sign.ts` in a Node scratch script): `GET /<bucket>?list-type=2&prefix=q/` and `…&prefix=q/&start-after=q/a`, which decide the S3-list alternative. Then `…&prefix=t/` without `encoding-type=url` (is the XML well-formed?) and with it.
4. Presigned GET of `t/a\u0001` (path `t/a%01`): expect 200 and 1 byte. Presigned PUT to `t/up\u0001`, then a binding `head`: it must exist under exactly that key. One `head` of a 1,024-byte key, to confirm R2's limit counts bytes.
5. Delete every object, then `wrangler r2 bucket delete`. Add the raw outputs and the predictions they match as an addendum to this record. About 30 requests in all.
