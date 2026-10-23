# Decision drafts — fix-pass0

### DEC-PENDING-fix-pass0-1 — A bucket-creation conflict is read back, not taken as foreign (amends DEC-0270)
Origin: ai-proposed · Status: accepted · Affects: DEC-0270, DEC-0334, PROV-REQ-004, PROV-AC-007, `packages/framework/src/provision/cloudflare/account.ts`

DEC-0270 read every HTTP 409 from `POST /accounts/{account}/r2/buckets` as "foreign". Pass 0 check 3 (`validation/cloudflare/pass-0/logs/responses.jsonl`, label `c03-create-existing`) disproved that reading. Creating `prototype-logs` while this account already had it answered 409, code 10004, "The bucket you tried to create already exists, and you own it." R2 bucket names are scoped to an account (DEC-0334 item 1), so a 409 on this account's path means the bucket exists in this account.

Amended reading: on a 409, `createBucket` reads the bucket back with the same `GET /accounts/{account}/r2/buckets/<name>` that inspection uses (DEC-0270's GET readings):
- 200 → owned: no error, because the end state PROV-REQ-004 requires is reached;
- 403 → foreign: "`R2 bucket <name>` already exists but belongs to another account (or this account's credentials cannot read it); nothing was created";
- 404 → an error naming the bucket and `HTTP 409`, with "reading it back found it absent";
- any other answer → inspection's error, "checking `R2 bucket <name>` failed: …".

The code does not rely on the 409 message text, which is not a contract. The read-back costs one GET, and only on a 409. DEC-0270's other readings are unchanged. The 200, 404 and 409 answers are now confirmed live by pass 0 (checks 1–3). The 403 reading stays unverified, because one account cannot produce it (DEC-0334). PROV-AC-007 goes through inspection's GET 403 and is unaffected. The fake (`fake-cloud.test-support.ts`) now answers with the live 409 message.

**Known limitation, accepted and not fixed:** the 409 path is reached only when the bucket appears between `setup-account`'s inspection GET (404) and its POST: a concurrent `setup-account`, or a bucket created by hand. In that race `setup-account` still prints `created: R2 bucket <name>` (`core/setup-account.ts`), although another process created it, because `createSharedResources` returns `void` and `created` is built from its input list. The end state, an owned bucket, is the required one, and no requirement fixes the output wording. Changing it would widen the target-neutral `TargetOperations` interface and the `SetupAccountResult.created` contract, which is out of scope for this fix.

Evidence: `ai/implementation/root-causes/2026-10-23-pass0-F2-create-bucket-409-owned.md` (diagnosis and Review); unit tests in `packages/framework/src/provision/cloudflare/account.unit.test.ts` (the 409-then-200 and 409-then-404 tests failed before the fix; 409-then-403 is a guard).

### DEC-PENDING-fix-pass0-2 — In the sandbox, `remove` cannot delete R2 objects whose names have a `..` segment through the API
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-003, FILES-REQ-002, FILES-AC-002, D-RUN, `packages/framework/src/provision/cloudflare/objects.ts`

Pass 0 (`validation/cloudflare/pass-0/logs/`, label `d02f-delete-dot`) sent `DELETE /accounts/{account}/r2/buckets/prototype-logs/objects/x%2F..%2Fy` and got 403 with the plain-text body "request rejected: path contains traversal sequence". The body format and the request's position point to the sandbox's egress proxy, not Cloudflare. The response headers were not captured, so this is an inference. R2 accepted the same key through the S3 endpoint (PUT 200, GET 200, DELETE 204).

No framework defect was found. Whether real Cloudflare, reached without this proxy, accepts the path is unverified (owner item, plan §11 Q11). If real Cloudflare refuses it, PROV-REQ-003 is broken for valid FILES-REQ-002 names, and the fix is an S3-DELETE fallback in `deleteObjects` (see the root-cause record).

Limitation recorded: in this sandbox, stage removal (`remove`) cannot delete objects in the files bucket whose names have a `..` segment. `remove` reports such a leftover by name and fails (DEC-0263). Only `..` was observed. Names with `.` or empty (`//`) segments are untested. The pass-1 handling is in plan §5 D-RUN. No code was changed.

Evidence: `ai/implementation/root-causes/2026-10-23-pass0-F1-r2-api-delete-traversal-403.md` (diagnosis and Review).

## Parameter changes

None.
