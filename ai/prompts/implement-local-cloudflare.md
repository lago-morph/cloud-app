# One-shot prompt: implement the framework for local and Cloudflare

Paste everything below the line into a new agent session started in this repository.

---

You are implementing the Dual-Cloud Prototyping Framework in this repository. This phase covers two targets: **local** and **Cloudflare**. AWS comes in a later phase (DEC-0082). The Google login is mocked in this phase (§4).

## 1. Your role: orchestrator only

You, the main agent, **only orchestrate**. Subagents do everything else, **including planning**. This keeps your context small for a long run and lets independent work run in parallel.

**You do:**
- launch subagents with precise briefs, and track which work items are done, running, blocked or next;
- integrate their work: merge their branches into the feature branch, push, and keep the pull request up to date;
- pass questions to the owner, and pass the answers back;
- write the final report from the subagents' summaries.

**You do not:**
- plan, design, write or edit code, tests or documents;
- run test suites, or diagnose failures;
- read design documents beyond `docs/README.md` and what you need to write a brief. Give subagents file paths, not file contents.

**Planning is a subagent's job.** First, have a planning subagent read the documents in §2 and write `ai/implementation/plan.md`, then commit it. The plan contains:
- the work items for each phase in §9;
- each item's dependencies;
- which items can run in parallel without touching the same files;
- each item's exit check.

When the plan needs to change, have a planning subagent revise it.

**Every brief states:**
- the task and the work item ID from the plan;
- the documents and contract files to read;
- the files or directories the subagent owns;
- its branch;
- what to return: a short summary of what changed, the commits, the test results, and open questions. Details go into files in the repository, not into the reply.

**Parallel work.** Where it saves wall-clock time, run independent work items at the same time, each in its own git worktree on its own branch (for example the Agent tool with `isolation: "worktree"`). Every subagent commits and pushes its branch before it returns. Merge each branch into the feature branch when its item is done. Do not run two items in parallel if they edit the same files.

## 2. Sources of truth

- The specification and designs are under `docs/`. Read them in the order `docs/README.md` gives:
  1. `CONVENTIONS.md`
  2. `spec/system-spec.md`
  3. `architecture/component-map.md`
  4. each component's design under `docs/components/`, when you work on that component
- Only identified requirements (`*-REQ-*`) and the contract files under `docs/contracts/` are binding. Everything else is design guidance. You may deviate from guidance when you have a reason; record each deviation in the decision log.
- `docs/decisions/decision-log.md` records why things are the way they are:
  - Entries with origin `owner` are the owner's decisions. Do not change them.
  - Entries marked `removed` or `not-adopted` were deliberately dropped. Do not build them.
- Tunable values live in `docs/parameters/parameters.md`. Refer to them by `PAR-` ID. If you change a value, update it there.

## 3. What the owner cares about

- **The target apps:** one or a few users, small data, low usage, low stakes. Downtime is fine. Simplicity and portability beat scale and completeness.
- **Don't over-engineer.** When unsure, build the smallest thing that meets the requirement. The owner has repeatedly rejected machinery built for high-volume, multi-user or critical systems.
- **App code must never see which cloud it runs on.** Cloudflare is used locally too, so be careful not to let Cloudflare concepts leak into app-facing contracts (SYS-REQ-002, SYS-REQ-005).
- **The owner does not read code.** Anything the owner must do (account setup, secrets, the Google client, admin and user IDs, deploy and remove, reading logs) must be written as copy-and-paste steps in the skill and the template README (SKILL-REQ-006).

## 4. Scope of this phase

**Build:**
- the framework package, in one npm-workspace repository laid out as `docs/components/cli.md` §2 describes;
- every component in the component map, with its **local** and **Cloudflare** parts:
  - core: CORE, HTTP
  - capabilities: SQL, MIG, KV, FILES, CFG, SEC, LOG, AUTH
  - the Google login provider: GOOGLE (with the Google login mocked, below)
  - targets and tooling: LOCAL, CF, PROV, CHECK, CLI
  - the compliance suite and reference app: COMPL
  - the skill, the template and the scaffolder: SKILL
- the demo app (DEMO), built last, from the skill alone (see phase F).

The Postgres harness (PGlite) is part of local verification, so the SQL portability rules and dual-dialect migrations are fully in scope even without AWS.

**Google login is mocked.** The owner does not want the run to stop and wait for them to do anything, so there is no Google OAuth client in this phase, and nothing contacts Google:
- All automated tests log in with the authentication mock or the stub login provider (auth.md).
- Build GOOGLE and `certify-auth`, and test them offline only: hand-built tokens, and `fetch` stubbed (GOOGLE-AC-001 local part, GOOGLE-AC-002, GOOGLE-AC-003).
- Do not create the `prodcheck` stage or any other production (non-`test-`) cloud stage. They need a Google client.
- Record as `not-run`, with the detail "Google login mocked for this phase", every criterion or part of one that needs a real Google login, a Google OAuth client, or a production cloud stage. These include:
  - GOOGLE-AC-001 (cloud part), GOOGLE-AC-005
  - AUTH-AC-005 (admin-list part), AUTH-AC-009 (cloud production part), AUTH-AC-011
  - COMPL-AC-005
  - SKILL-AC-006
  - E2E-006, E2E-007 (cloud part), E2E-008

  The evaluating subagent (§7) confirms this list against the documents and adds any that were missed.

**Do not build:**
- the AWS adapters, the AWS target, or AWS provisioning;
- placeholder AWS code that pretends to work.

Keep every interface target-neutral so AWS can be added later without changing app-facing contracts. Where a design names an AWS behavior, it only needs to stay possible.

**Never build:**
- message queues or inbound webhook processing;
- anything else the decision log marks `removed` or `not-adopted`.

## 5. How to work

- **Work on a feature branch.** Commit and push often: sandboxes are ephemeral (CLAUDE.md). Subagents work on their own branches (§1). Open a pull request when a phase is complete, and keep it up to date.
- **Record decisions.** For each design decision a document leaves open, make the simplest reasonable choice and add an `ai-proposed` decision-log entry.
- **Ask the owner when blocked.** If a binding requirement conflicts with reality (a platform cannot do it), stop work on that item, record the problem precisely, and ask the owner. Do not quietly weaken a requirement or test.
- **Keep the docs in sync with the code.** When implementation changes a design detail, update the design document in the same commit. IDs are durable: never renumber or reuse them.
- **Tag tests with what they verify.** Each test carries the acceptance-criterion or scenario IDs it covers (COMPL-REQ-002).
- **Run `verify` before every merge into the feature branch**, once it exists. The framework's own code must pass its own checks too.

## 6. Test layers

There are three layers. Each one runs on its own command (for example `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`), so any layer can be run without the others.

- **Unit tests: red-green TDD.** The implementing subagent works one behavior at a time:
  1. Write a unit test for the behavior.
  2. Run it, and confirm it fails for the expected reason (red).
  3. Write the least code that makes it pass, and run it again (green).
  4. Refactor with the tests still green.

  Unit tests are fast and need no network.
- **Integration tests: one suite per component.** Each test exercises the component together with what it really uses, instead of mocks of those:
  - locally: Miniflare/workerd for D1, R2 and KV, PGlite, and the local file system;
  - on Cloudflare: a `test-` stage, where a criterion's Where column says Cloud.
- **End-to-end tests** implement the `E2E-` scenarios in `docs/acceptance/e2e-scenarios.md`.

## 7. Who writes, runs and judges tests

Use **separate** subagents for these jobs. None of them may be the subagent that wrote the code under test.

1. **Test-case author.** Writes the integration and end-to-end test cases from the requirements, acceptance criteria, contracts and scenarios, not from the implementation. It can work alongside the implementation, from the contracts.
2. **Test runner.** Runs the suites on the named target and produces the evidence: evidence records as compliance.md and the evidence schema specify, plus the raw output each record is based on, committed. It does not change code or tests, and it does not judge results beyond recording them.
3. **Evaluator.** Reads the criteria and the evidence only, and decides each criterion's status: `passed`, `failed`, `blocked` or `not-run`. It checks that the evidence really shows the criterion, and flags anything that does not: for example a skipped test, an assertion weaker than the criterion, or a test tagged with an ID it does not check. Only the evaluator's verdict counts as a pass.

## 8. Diagnosing failures

Every failure gets an evidence-based root cause before anything is changed. This applies to any failing test, on any layer and any target, and to failed spikes, builds and deploys. **Do not guess or speculate.** "Probably", "flaky" and "timing" are not root causes without evidence.

1. **Diagnose.** A diagnosing subagent:
   - reproduces the failure;
   - gathers evidence: exact error output, logs, requests and responses, state, a minimal reproduction, and experiments that confirm or rule out each hypothesis;
   - writes a root-cause record in `ai/implementation/root-causes/`.

   The record gives the symptom, the evidence, the chain from cause to symptom with evidence for every link, the proposed fix, and how the fix will be verified. If a link is not proven, the subagent gathers more evidence; it does not fill the gap with a guess.
2. **Review.** An independent subagent, which did not diagnose the failure or write the code, checks that:
   - the evidence supports every link;
   - the alternatives are ruled out;
   - the fix addresses the cause, not the symptom.

   It accepts or rejects the record, with reasons. A rejected record goes back to step 1.
3. **Fix.** Only after acceptance, a subagent implements the fix red-green: first a test that reproduces the failure and fails, then the fix that makes it pass.
4. **Re-check.** The test runner and the evaluator run the affected tests again (§7).

Never skip, delete or weaken a test to get a pass. If a test itself is wrong, that is a root-cause finding and goes through the same steps.

## 9. Phases

Do them in order. Each phase ends with its exit check passing, as judged by the evaluator, and the work pushed.

**A. Spikes.** Before building on them, test the risky platform assumptions with throwaway code:
- What wrangler and SST/Pulumi need to authenticate in this sandbox (§10).
- Whether a deployed stage's `workers.dev` address is reachable from this sandbox (§10).
- An SST/Pulumi update of a Worker keeps the secrets that were set separately (cloudflare.md, Deploy mechanics).
- A stage Worker's `workers.dev` address can be turned off and on again without redeploying (DEC-0078).
- The D1 HTTP API applies one migration file as one atomic batch with `PRAGMA defer_foreign_keys = on` (migrations.md).
- D1 export and import produce a full copy of a database (migrations.md).
- Signed R2 S3-endpoint URLs work for direct browser PUT and GET, with a bucket CORS policy limited to one origin (files.md).
- Local D1 enforces D1's bound-parameter and statement-size limits, or does not (SQL-OQ-1).
- The `sql.d.ts` typing approach, using restricted Drizzle types, type-checks the basic CRUD example (sql.md §2.3).
- The pinned dependency versions work together (PAR-100 and later).

Record each result as a decision-log entry. If an assumption fails, apply the fallback the design names. If it names none, ask the owner.

**B. Local foundation.** Build:
- CORE and HTTP;
- SQL with both dialects, and MIG for local;
- CFG, SEC and LOG for local;
- KV and FILES, including the local same-origin transfer route;
- AUTH, with the mock and the stub login provider;
- GOOGLE, tested offline (§4);
- the LOCAL target;
- CHECK;
- CLI `dev`, `verify`, `generate-migration` and `reset-local`.

*Exit check:* the template app runs under `dev`, and `verify` passes with no network access.

**C. Local compliance.** Build the reference app, the compliance driver, the evidence records and the traceability report.

*Exit check:* every acceptance criterion whose Where column includes Local passes, or is `not-run` under §4, and an evidence record exists for each.

**D. Cloudflare.** Build:
- the CF target and the Cloudflare parts of each capability;
- PROV: `setup-account`, `deploy`, `remove`, `secrets set`;
- the per-target operations, including stop and start by turning the `workers.dev` address off and on, and database replacement for schema changes;
- the health check;
- `smoke`.

Then run the compliance suite on a `test-<random>` stage. Do not set up `prodcheck` (§4).

*Exit check:* every automated criterion marked Cloud, other than those in `aws.md` and those `not-run` under §4, passes on Cloudflare, and a test stage is removed with no leftovers.

**E. Skill.** Write the skill, the template README with the owner's step-by-step tasks (including the Google setup steps the owner will follow later), the troubleshooting reference, and the scaffolder. The skill's examples come from the template and the reference app only.

**F. Demo.** Have a separate subagent build the demo from only:
- the skill;
- the template;
- `docs/demo/demo-spec.md`.

This is E2E-015. Any `FRAMEWORK-ISSUE.md` it raises is a defect to fix in the framework or the skill; diagnose it as in §8. Then repeat the build until none remain. Deploy the demo to a Cloudflare test stage and run its smoke test.

## 10. Cloudflare access in this sandbox, credentials and cost

**Account and token:**
- The account ID is in the environment variable `CLOUDFLARE_ACCOUNT_ID`.
- The API token is **not** in the environment. The sandbox's outbound proxy adds it to every HTTPS request to `api.cloudflare.com`. Do not send an `Authorization` header yourself.
- Check access first. This should return `"success": true` and "This API Token is valid and active":
  ```
  curl -sS "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/tokens/verify"
  ```

**Tools:**
- wrangler and SST/Pulumi normally expect `CLOUDFLARE_API_TOKEN`, and wrangler may otherwise try an interactive login, which cannot work here. Find out by experiment what makes each tool work through the proxy (phase A), and record the result as a decision-log entry. Do not guess. If a tool cannot be made to work, stop that item and ask the owner.
- The injected token covers `api.cloudflare.com` only. Other Cloudflare hosts use their own credentials or none:
  - R2's S3 endpoint, `<account ID>.r2.cloudflarestorage.com`, uses the R2 API token the framework creates. It was reachable from this sandbox on 2026-10-19.
  - Stage addresses on `workers.dev` were not confirmed reachable. A request to a made-up `workers.dev` name was refused by the proxy, so check with a real deployed Worker in phase A.
  - If the proxy refuses a host (403, or a failed CONNECT), report the host to the owner. Do not work around it.

**Proxy:**
- All outbound HTTPS goes through a proxy. Its CA bundle is `/root/.ccr/ca-bundle.crt`.
- Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set (Node 22.21 or later).
- For problems, read `/root/.ccr/README.md` and run `curl -sS "$HTTPS_PROXY/__agentproxy/status"`.
- Never disable TLS verification or unset `HTTPS_PROXY`.

**Rules:**
- **Never print, log or commit a credential value**, including in evidence records and root-cause records.
- **Local work needs no cloud account.** Do all local work before touching the cloud.
- **Missing prerequisites.** If something is missing (a permission, a reachable host), name it exactly and finish all other work.
- **Never invent credentials**, including placeholder Google client IDs.
- **Cloud resources cost money.** Create only what a phase needs, remove test stages after use, and list anything that remains billable in the final report.

## 11. Definition of done for this phase

- **Local:** every acceptance criterion and end-to-end scenario with Local in its Where column has passed, with evidence, except those `not-run` under §4.
- **Cloudflare:** every automated criterion and scenario whose Where column says Cloud has passed on Cloudflare, with evidence, except those `not-run` under §4 (milestone items are covered below).
- **Google:** criteria that need a real Google login, a Google client or a production cloud stage are recorded as `not-run` with the detail "Google login mocked for this phase".
- **AWS:** the AWS runs of those criteria, and criteria that apply only to AWS (for example in `aws.md`), are recorded as `not-run` with the detail "AWS phase not started".
- **Milestone items** (COMPL-REQ-006) either have a record, or are listed as outstanding with the reason.

The framework as a whole is **not** "working" until the AWS phase passes and the real Google login is certified (SYS-REQ-001, COMPL-REQ-006). Do not claim otherwise.

## 12. Final report

Summarize:
- **Delivery:** what was built and the pull request link.
- **Checks:** the result of each check, by evidence status, per target, as judged by the evaluator.
- **Spikes:** each spike's result and the decision recorded for it.
- **Failures:** each root-cause record, and whether its review accepted it.
- **Decisions:** every decision-log entry added, and every design document changed.
- **Open items:** what is blocked or outstanding, including the Google criteria, and exactly what the owner needs to do about each, as copy-and-paste steps.
- **Costs:** cloud resources still billable.
