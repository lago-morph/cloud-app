# C-T5 decision drafts — run-level tests for COMPL-AC-001 and COMPL-AC-003

Test-case author item (prompt §7.1), written from compliance.md (COMPL-REQ-001, -003, -006, COMPL-AC-001, COMPL-AC-003, "Driver"), the evidence contract and the Where columns/lines, not from the driver's code. Follows DEC-PENDING-fix-c3-1, which kept both IDs off `UNIT_LEVEL` because they are properties of a real run. Local only; no Cloudflare calls. No driver, selection or `UNIT_LEVEL` change.

### DEC-PENDING-C-T5-1 — COMPL-AC-001 and COMPL-AC-003 are compliance-level, evidenced by nested real runs of the command in a clone
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-AC-001, COMPL-AC-003, DEC-PENDING-fix-c3-1, `tests/compliance/criteria/compl/`

Both criteria are stated over runs of the one command, so they are not unit-level and stay off `UNIT_LEVEL`. Their tests (`tests/compliance/criteria/compl/{targets,evidence}.test.ts`, integration layer, selected by the driver like every other criterion) run the real `npm run compliance -- …` as a child process:
- in a throwaway `git clone --shared` of HEAD with the installed `node_modules` linked in (untracked, excluded), so a test can commit a deliberate case or modify a tracked file without touching the working tree the enclosing run records from;
- with `--out <temp dir>`, no `COMPLIANCE_*`/`CLOUDFLARE_*`/`AWS_*` variables, and a dead proxy, so a nested run can make no cloud call;
- never recursing into the real suites: a nested run either blocks every ID (`--blocked '*=…'`, so it lists and records without starting `dev`, deploying or running a test) or uses `--self-test` (only `harness/self-test/`).
Each record a nested run writes is checked against `docs/contracts/schemas/evidence.schema.json` by a small checker in the test support (independent of the writer's own validator).

### DEC-PENDING-C-T5-2 — How each clause is read
Origin: ai-proposed · Status: accepted (assumption; owner review open) · Affects: COMPL-AC-001, COMPL-AC-003

COMPL-AC-001:
- "One command runs the suite against each target": the same command with `--target local|cloudflare|aws` writes a record for that target and commit. "Per-target lists of executed criteria and scenarios" = the IDs in that record's results; a blocked-everything run lists what the run would execute, and that a full run executes exactly that list is shown by the enclosing run's own record and E2E-004's coverage part. The test does not execute a cloud run (prohibited here; also the enclosing cloud run is that evidence).
- The oracle reads the Where columns/lines itself ("cloud" = both clouds, except in cloudflare.md/aws.md; a segment naming no target inherits the first segment's targets), and compares both ways (nothing extra, nothing missing) per target and tier. Phase not-run rules (AWS, Google mocked) change a result's status, not membership, so IDs still match the Where texts.
- "Milestone items are compared only in milestone runs": no milestone-only item appears in any automated run, and the union of the three milestone runs' lists equals COMPL-REQ-006's named list.

COMPL-AC-003:
- "Validate against the schema": records of a self-test run and of a list-only run conform to the contract.
- "A deliberately omitted criterion": read two ways, both tested: (a) its only test removed from the suite (committed in the clone; `--self-test`) → `not-run` with a reason; (b) left out with `--only` → every omitted local ID `not-run` with a reason, none `passed`.
- "A deliberately failing HTTP check": a self-test case committed in the clone uses the harness client (`expectStatus`) against a local server answering 503 with an ErrorResponse carrying a random code and requestId; the record's `failed` detail must contain all three.
- "Started from a working tree with a modified tracked file": `docs/README.md` modified in the clone → non-zero exit and no file at all under `--out`, both for `--self-test` and for a list-only local run; control: after reverting, the same clone records.
- Where "cloud": the clauses are properties of the driver and writer, which are target-independent; on a cloud run these tests run the same local nested runs (a nested cloud run would deploy). The cloud HTTP-failure path uses the same `HttpCheckError` message. Open for the owner if a cloud-specific check is wanted.

Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T5.

Parameter changes: none.
