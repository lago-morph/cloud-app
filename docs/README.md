# Documentation Index

Specification and design documents for the Dual-Cloud Prototyping Framework.

## Reading order

1. [CONVENTIONS.md](CONVENTIONS.md) — what is binding, identifiers, traceability, origins, parameter categories, contract formats.
2. [spec/system-spec.md](spec/system-spec.md) — what the framework is and the system requirements (`SYS-REQ-…`).
3. [architecture/component-map.md](architecture/component-map.md) — components, responsibilities, and dependencies.
4. The component documents under [components/](components/) for the parts you are working on (linked from the component map), with their contracts under [contracts/](contracts/).
5. [demo/demo-spec.md](demo/demo-spec.md) — the demo app, and [acceptance/e2e-scenarios.md](acceptance/e2e-scenarios.md) — end-to-end scenarios verifying the system requirements.

Reference material:

- [decisions/decision-log.md](decisions/decision-log.md) — every recorded decision and its origin.
- [parameters/parameters.md](parameters/parameters.md) — every limit, timeout, default, and version pin.
- [../QUICKSTART.md](../QUICKSTART.md) — the user's one page: a local app in one line, Cloudflare in one command ([components/setup.md](components/setup.md)).
- [RELEASING.md](RELEASING.md) — publishing the npm packages and the Claude Code plugin, and the owner's one-time steps.

## Status

| Part | Status |
| --- | --- |
| Conventions, system spec, component map, decision log, parameters register | Reviewed by owner |
| Component designs, contracts, demo spec, end-to-end scenarios | Reviewed by owner |

"Reviewed by owner" records a past review. It is not an approval gate for later changes: those follow each item's origin (CONVENTIONS §4), and agents keep the end-to-end scenarios current without owner approval.


## Release scope

Release 1 targets **local and Cloudflare** (DEC-0508, owner, 2026-10-24). The AWS target is deferred to a later release: its code, tests and evidence are on the branch `aws`, and the index for resuming it is `ai/implementation/aws-deferred.md`. SYS-REQ-001 and SYS-REQ-026 carry an amendment note for release 1. [components/aws.md](components/aws.md) is kept for the record, and the AWS sections and lines of the other documents are marked "deferred (branch `aws`)". The compliance harness and its traceability and release reports judge local and Cloudflare only.

## Login in release 1 (v0.2.0)

The real login is sign-in with Cloudflare, through the account's shared auth app (DEC-0691): only members of the owner's Cloudflare account can sign in. An app redirects to the auth app, which runs Cloudflare's OAuth flow and returns a one-time code that the app redeems over a service binding; the app keeps its own session. See [components/auth.md](components/auth.md) (AUTH) and the internal contracts [contracts/ts/internal/login-provider.d.ts](contracts/ts/internal/login-provider.d.ts) (`LoginProvider`) and [contracts/ts/internal/auth-app.d.ts](contracts/ts/internal/auth-app.d.ts) (the auth app's binding). Email and password login and the framework's email are removed: [components/password.md](components/password.md) (PWD) and [components/mail.md](components/mail.md) (MAIL) are kept, marked retired (DEC-0696). Google sign-in stays dropped (DEC-0513): [components/google.md](components/google.md) is kept, marked retired, and its code is on the branch `google`.

A member whose Cloudflare account role is an administrator role is an admin; any other member is a user (DEC-0690). A role change takes effect at the person's next sign-in or role refresh. Configuration holds no admin or users list, and there is no `admins` command. The real sign-in is checked by the owner once per release, and its automated parts on every cloud run (DEC-0692). SYS-REQ-018, SYS-REQ-019, SYS-REQ-026 and SYS-REQ-027 carry v0.2.0 amendments.
