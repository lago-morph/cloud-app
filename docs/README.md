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

## Status

| Part | Status |
| --- | --- |
| Conventions, system spec, component map, decision log, parameters register | Reviewed by owner |
| Component designs, contracts, demo spec, end-to-end scenarios | Reviewed by owner |


## Release scope

Release 1 targets **local and Cloudflare** (DEC-0508, owner, 2026-10-24). The AWS target is deferred to a later release: its code, tests and evidence are on the branch `aws`, and the index for resuming it is `ai/implementation/aws-deferred.md`. SYS-REQ-001 and SYS-REQ-026 carry an amendment note for release 1. [components/aws.md](components/aws.md) is kept for the record, and the AWS sections and lines of the other documents are marked "deferred (branch `aws`)". The compliance harness and its traceability and release reports judge local and Cloudflare only.
