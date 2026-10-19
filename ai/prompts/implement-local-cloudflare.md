# One-shot prompt: implement the framework for local and Cloudflare

Paste everything below the line into a new agent session started in this repository.

---

You are implementing the Dual-Cloud Prototyping Framework in this repository. This phase covers two targets: **local** and **Cloudflare**. AWS comes in a later phase (DEC-0082).

## 1. Sources of truth

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

## 2. What the owner cares about

- **The target apps:** one or a few users, small data, low usage, low stakes. Downtime is fine. Simplicity and portability beat scale and completeness.
- **Don't over-engineer.** When unsure, build the smallest thing that meets the requirement. The owner has repeatedly rejected machinery built for high-volume, multi-user or critical systems.
- **App code must never see which cloud it runs on.** Cloudflare is used locally too, so be careful not to let Cloudflare concepts leak into app-facing contracts (SYS-REQ-002, SYS-REQ-005).
- **The owner does not read code.** Anything the owner must do (account setup, secrets, the Google client, admin and user IDs, deploy and remove, reading logs) must be written as copy-and-paste steps in the skill and the template README (SKILL-REQ-006).

## 3. Scope of this phase

**Build:**
- the framework package, in one npm-workspace repository laid out as `docs/components/cli.md` §2 describes;
- every component in the component map, with its **local** and **Cloudflare** parts:
  - core: CORE, HTTP
  - capabilities: SQL, MIG, KV, FILES, CFG, SEC, LOG, AUTH
  - the Google login provider: GOOGLE
  - targets and tooling: LOCAL, CF, PROV, CHECK, CLI
  - the compliance suite and reference app: COMPL
  - the skill, the template and the scaffolder: SKILL
- the demo app (DEMO), built last, from the skill alone (see phase F).

The Postgres harness (PGlite) is part of local verification, so the SQL portability rules and dual-dialect migrations are fully in scope even without AWS.

**Do not build:**
- the AWS adapters, the AWS target, or AWS provisioning;
- placeholder AWS code that pretends to work.

Keep every interface target-neutral so AWS can be added later without changing app-facing contracts. Where a design names an AWS behavior, it only needs to stay possible.

**Never build:**
- message queues or inbound webhook processing;
- anything else the decision log marks `removed` or `not-adopted`.

## 4. How to work

- **Work on a feature branch.** Commit and push often: sandboxes are ephemeral (CLAUDE.md). Worktrees are fine. Open a pull request when a phase is complete, and keep it up to date.
- **Record decisions.** For each design decision a document leaves open, make the simplest reasonable choice and add an `ai-proposed` decision-log entry.
- **Ask the owner when blocked.** If a binding requirement conflicts with reality (a platform cannot do it), stop work on that item, record the problem precisely, and ask the owner. Do not quietly weaken a requirement or test.
- **Keep the docs in sync with the code.** When implementation changes a design detail, update the design document in the same commit. IDs are durable: never renumber or reuse them.
- **Tag tests with what they verify.** Each test carries the acceptance-criterion or scenario IDs it covers (COMPL-REQ-002).
- **Run `verify` before every push**, once it exists. The framework's own code must pass its own checks too.

## 5. Phases

Do them in order. Each phase ends with its exit check passing and the work pushed.

**A. Spikes.** Before building on them, test the risky platform assumptions with throwaway code:
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
- the LOCAL target;
- CHECK;
- CLI `dev`, `verify`, `generate-migration` and `reset-local`.

*Exit check:* the template app runs under `dev`, and `verify` passes with no network access.

**C. Local compliance.** Build the reference app, the compliance driver, the evidence records and the traceability report.

*Exit check:* every acceptance criterion whose Where column includes Local passes, and an evidence record exists for each.

**D. Cloudflare.** Build:
- the CF target and the Cloudflare parts of each capability;
- PROV: `setup-account`, `deploy`, `remove`, `secrets set`;
- the per-target operations, including stop and start by turning the `workers.dev` address off and on, and database replacement for schema changes;
- the health check;
- `smoke`.

Then run the compliance suite on a `test-<random>` stage, and set up the long-lived `prodcheck` stage.

*Exit check:* every automated criterion marked Cloud, other than those in `aws.md`, passes on Cloudflare, and a test stage is removed with no leftovers.

**E. Google and skill.**
- Build GOOGLE and `certify-auth`. The owner performs the real Google login. Prepare everything, then hand the owner exact steps. If the owner is not available, record the certification as `blocked` and continue.
- Write the skill, the template README with the owner's step-by-step tasks, the troubleshooting reference, and the scaffolder. The skill's examples come from the template and the reference app only.

**F. Demo.** Have a separate agent build the demo from only:
- the skill;
- the template;
- `docs/demo/demo-spec.md`.

This is E2E-015. Any `FRAMEWORK-ISSUE.md` it raises is a defect to fix in the framework or the skill. Then repeat the build until none remain. Deploy the demo to a Cloudflare test stage and run its smoke test.

## 6. Credentials and cost

- **Local work needs no cloud account.** Do all local work before touching the cloud.
- **Cloudflare credentials come from the environment.** The owner supplies an account ID and an API token with permission for Workers, D1, R2 and R2 API-token creation. In some environments the token is injected by a proxy instead of an environment variable. Find out which applies by checking, not guessing, and never print credential values.
- **Missing prerequisites.** If something is missing (credentials, a permission, the Google OAuth client for `prodcheck`), name it exactly and finish all other work.
- **Never invent credentials.**
- **Cloud resources cost money.** Create only what a phase needs, remove test stages after use, and list anything that remains billable in the final report.

## 7. Definition of done for this phase

- **Local:** every acceptance criterion and end-to-end scenario with Local in its Where column has passed, with evidence.
- **Cloudflare:** every automated criterion and scenario whose Where column says Cloud has passed on Cloudflare, with evidence (milestone items are covered below).
- **AWS:** the AWS runs of those criteria, and criteria that apply only to AWS (for example in `aws.md`), are recorded as `not-run` with the detail "AWS phase not started".
- **Milestone items** (COMPL-REQ-006) either have a record, or are listed as outstanding with the reason.

The framework as a whole is **not** "working" until the AWS phase passes (SYS-REQ-001, COMPL-REQ-006). Do not claim otherwise.

## 8. Final report

Summarize:
- **Delivery:** what was built and the pull request link.
- **Checks:** the result of each check, by evidence status, per target.
- **Spikes:** each spike's result and the decision recorded for it.
- **Decisions:** every decision-log entry added, and every design document changed.
- **Open items:** what is blocked or outstanding, and exactly what the owner needs to do about each, as copy-and-paste steps.
- **Costs:** cloud resources still billable.
