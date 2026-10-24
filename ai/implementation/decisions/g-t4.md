# Decision drafts — g-t4

Evidence: the G-T4 commits on `claude/implement-aws-g-t4`. Unit tests: `tests/compliance/harness/{expected,results,reports,driver,node-deps,aws-usage}.unit.test.ts` and `tests/compliance/criteria/_cloud/aws/{criteria-hooks,usage,secrets-logs}.unit.test.ts`. Integration: `tests/compliance/criteria/sql/data-api-retry.test.ts`. No AWS endpoint was contacted: the hook tests use aws-sdk-client-mock behind the framework's AWS network guard, and the driver tests use a fake target.

### DEC-PENDING-g-t4-1 — The AWS not-run detail is "AWS live run pending (no account)"
Origin: ai-proposed · Status: accepted · Affects: `tests/compliance/harness/expected.ts` (`PHASE_RULES` `*`/aws, `AWS_LIVE_PENDING`), plan-aws.md §2, G-EV

The `*` rule on `aws`, in any tier, now has the detail "AWS live run pending (no account)" instead of "AWS phase not started". Phase G builds and pre-checks the AWS code offline. Only phase L records AWS evidence. The rule stays until L-RUN. A dry run of the wiring against fakes (G-RUN) passes its own rules through `DriverDeps.notRunRules`.

### DEC-PENDING-g-t4-2 — DEC-0397's not-run parts become required clauses
Origin: ai-proposed · Status: accepted · Supersedes: DEC-0397 · Affects: CORE-AC-006, SQL-AC-006, `expected.ts` (`CLAUSE_RULES`), `results.ts`

The two part rules of DEC-0397 are removed. In their place, `CLAUSE_RULES` names each clause and a title pattern on `local`, automated tier:
- CORE-AC-006 "AWS-bundle clause": `\bAWS[- ]bundle\b`. This is G-06's bundle inspection; its test title must name the AWS bundle.
- SQL-AC-006 "Data API retry-loop clause": `\bData API retry[- ]loop clause\b`. This is the new criteria test `tests/compliance/criteria/sql/data-api-retry.test.ts`.

A clause with no executed test of its own whose title matches is recorded as its own `not-run` entry: "<part>: no test tagged [ID] for this clause ran on local". So the criterion's other tests passing never stands in for the clause. Until G-06 lands, a local run therefore records CORE-AC-006's AWS-bundle clause as not-run.

The SQL-AC-006 clause test is a criteria-side test in the integration layer, not G-02's unit test. SQL-AC-006 is not unit-level (DEC-0319), so the unit layer would not count G-02's test. Making SQL-AC-006 unit-level would also have counted G-02's Data API fake tests (conflict, too large), which are a pre-check (DEC-PENDING-g-f1-1). The clause test injects the error source (a client whose every call is rejected with `DatabaseResumingException`) and a virtual clock. It runs at three jitter levels.

PROV-AC-007's AWS case (G-07, unit level) and CORE-AC-005's `./targets/aws` tests (G-01, integration layer) were already tagged and selected, so they are not duplicated. `expected.unit.test.ts` checks that they are still there.

### DEC-PENDING-g-t4-3 — Skip notes become the not-run detail
Origin: ai-proposed · Status: accepted · Affects: compliance.md "Driver" ("each skipped tagged test adds a `not-run` entry"), AWS-AC-005, `tests/compliance/harness/{skip-notes-reporter,reports,results,driver}.ts`

Vitest's JSON report has no field for a `skip(note)` note. The driver now adds a reporter, `tests/compliance/harness/skip-notes-reporter.ts`, before the JSON reporter. It copies the note into the test's `meta.skipNote`, which the JSON report does carry. Playwright notes are read from the `skip` annotation.

A skipped test with a note gets its own `not-run` entry, and its detail is the note (a leading "not-run:" is dropped, and the detail is capped at 1,000 characters). Skipped tests without a note are still listed together by title.

### DEC-PENDING-g-t4-4 — Driver `--target aws`: names, leftovers, usage caps
Origin: ai-proposed · Status: accepted (to be confirmed live) · Affects: compliance.md "Driver" and "Test stages", plan §1 "Cloud usage limits", `tests/compliance/harness/{aws-usage,driver,node-deps}.ts`, `criteria/_cloud/aws/usage.ts`, `criteria/prov/support/stage.ts`

- **Names.** The run stage is still `test-<run ID>`. Before deploying, the driver checks the stage's fixed AWS names (DEC-PENDING-G-S2/G-08-1):
  - the cluster `<app>-<stage>`: at most 63 characters, starting with a letter, with no doubled, leading or trailing hyphen;
  - the Function `<app>-<stage>-http`: at most 64 characters;
  - the bucket `<app>-<stage>-files-<account-id>`: at most 63 characters.

  With PAR-290 and PAR-291 every run stage passes. The check stops a hand-given `--stage` that would break a rule.
- **Leftovers.** The leftover check uses the framework's own operations factory, the one `remove` wires (`cloudflareOperations`, which G-11 extends to AWS with G-10's `TargetOperations`). Until then it throws "AWS target not yet implemented", and the record lists that as a failed leftover check. Tests pass a `FakeTarget` through `OperationsFactory`. The AWS deploy output's public origin is the CloudFront URL, never the Function URL.
- **At most 3 Aurora clusters at once.** Before deploying, the driver counts the account's test-stage clusters (`<app>-test-…`, RDS `DescribeDBClusters` through the counted hooks). It refuses a fourth: the deploy is not attempted, the stage is not added to the pending list, and the criteria are recorded not-run with the reason. Further stages made by stage-lifecycle tests take the same check (`requireClusterRoom` in `takeStageRoom`), which reports a missing prerequisite on AWS. On Cloudflare that check is still the D1 database cap.
- **API-call count.** Each process that uses the hooks prints `[g-t1] aws api calls in this process: <n>`. The driver sums these lines per test run, adds its own process's count, and writes the result to `raw/aws-usage.log`. It sets `COMPLIANCE_AWS_MAX_CALLS` to what is left of the run's cap for each run, and starts no further run once the cap is used up. A total above the cap gives exit 1. The proposed run cap is 2,000 hook calls, `COMPLIANCE_AWS_MAX_RUN_CALLS` overrides it. Calls the framework CLI makes (deploy, remove, the leftover check) are not counted.

### DEC-PENDING-g-t4-5 — `cloudHooks("aws")` carries the `AwsCloudHooks` members
Origin: ai-proposed · Status: accepted (to be confirmed live) · Affects: `tests/compliance/criteria/_cloud/aws/{criteria-hooks,index,api}.ts`, AWS-AC-002…006

`awsCloudHooks()` returns G-T2's `AwsCloudHooks`:
- `simulatePrincipalPolicy`, `functionUrl` and `observeCluster` are G-T1's simulation, Function URL and pause observer. An observer that reports "never pauses" maps to not paused, and the detail says so.
- `stageResources` reads the role from the Function, the cluster ARN and the credentials secret's ARN.
- `stageFunctions` lists Lambda functions with the stage's name prefix.
- `stageNatGateways` lists NAT gateways that are not `deleted` and are in the shared VPC (found by the tag `prototype-framework=shared-network`, DEC-PENDING-G-07-1), in any VPC a stage function names, or tagged with the stage. An EC2 client is added to the hooks' clients.

## Parameter changes

Proposed: an AWS hook API-call cap per compliance run, 2,000 (overridable with `COMPLIANCE_AWS_MAX_RUN_CALLS`), and the three-cluster cap (`MAX_AWS_CLUSTERS`).
