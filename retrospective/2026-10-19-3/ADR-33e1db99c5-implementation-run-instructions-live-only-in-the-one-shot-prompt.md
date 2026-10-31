# ADR: Implementation-run instructions live only in the one-shot prompt

- **ID**: ADR-33e1db99c5
- **Status**: Draft (not yet adopted; this repository records adopted decisions in `docs/decisions/decision-log.md`, not `docs/adr/`)
- **Date**: 2026-10-19
- **Source retrospective**: ../2026-10-19-3.md
- **PRs covered**: #3

## Context

The one-shot prompt `ai/prompts/implement-local-cloudflare.md` was written for the first implementation run (local and Cloudflare). The owner then added instructions for that run:
- mock the Google login;
- the main agent only orchestrates;
- how to reach Cloudflare from the sandbox;
- three separately runnable test layers;
- separate subagents to author, run and judge tests;
- an evidence-based root cause for every failure, reviewed independently.

The agent recorded the Google mock as decision-log entry DEC-0083 ("Google login is mocked in the first implementation phase", origin owner). The owner replied that the mock "just means I don't want you to stop in the middle and wait for me to do something. This is for the one shot prompt only, take it out of the decision record." DEC-0083 was removed in `3be509e`.

There is an earlier, related entry: DEC-0082 records that the first phase covers local and Cloudflare, and the owner kept it. So the line is not "prompts never appear in the log". It runs between *what the framework must be and the order of work* and *how one run is carried out*.

## Decision

Instructions that govern how a single implementation run is carried out (what is mocked, how agents are organized, how tests are run and judged, how the sandbox reaches the cloud) are written only in that run's prompt under ai/prompts/ and are not recorded in the decision log or the specification.

A decision that changes requirements, design, verification criteria, or the order of phases still goes in the decision log, as DEC-0082 did.

## Alternatives considered

- **Record run instructions as decision-log entries with origin `owner`.** This was tried (DEC-0083) and the owner rejected it. Such entries suggest that requirements or verification have changed, as DEC-0083's "recorded as `not-run` until a later phase" did. A run instruction like "don't block on me" is not that kind of decision.
- **Put run instructions in `CLAUDE.md`.** This was not discussed with the owner, so it is not recorded as a rejected option here. Noted only so a reviewer can raise it.

## Consequences

- The decision log stays a record of what the framework is and why. It is not a log of how each agent run was configured.
- A later run that needs the same instruction must copy it into its own prompt. Nothing outside the prompt says it was ever in force.
- A run instruction that affects evidence (for example, the Google-dependent criteria recorded as `not-run` with "Google login mocked for this phase") is explained by the prompt and by that run's final report, not by the log.

## References

- [`../2026-10-19-3.md`](../2026-10-19-3.md): the source retrospective (Phase 6; Part 3, item 2).
- `ai/prompts/implement-local-cloudflare.md`: the prompt that now carries the instructions (§1, §4, §6–§8, §10).
- `docs/decisions/decision-log.md`: DEC-0082, the kept order-of-work decision.
- PRs the decision was made in: #3 (commits `8c70024`, `3be509e`).
