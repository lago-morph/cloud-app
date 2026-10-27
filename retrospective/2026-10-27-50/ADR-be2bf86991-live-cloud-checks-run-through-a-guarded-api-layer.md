# ADR: Live cloud checks run through a guarded API layer that allow-lists token writes

- **ID**: ADR-be2bf86991
- **Status**: Draft (not yet adopted to docs/adr/)
- **Date**: 2026-10-27
- **Source retrospective**: ../2026-10-27-50.md
- **PRs covered**: #39 (via #42), #42, #44, #45, #46

## Context

The setup wizard's `cloudflare-setup` creates, updates in place and deletes Cloudflare API tokens. Its live check had to run on the owner's real account, using the owner's own dashboard-made admin token, which also stood in for the bootstrap token. The owner's rules were: never change or delete that token, name every created token with a fixed prefix and a 2-hour expiry, delete them all at the end, stay within call budgets, and stop on any 429.

Three findings showed that rules held only in prose, or only in the product, were not enough. A reviewer bypassed the product's token guard with path spellings that the URL parser normalises (`..`, backslash, percent-encoding). A whole-feature review showed that a deny-list guard still allowed deleting any of the owner's *other* tokens. And when the guard correctly refused the bootstrap self-delete against the owner's token, the refusal crashed the run (exit 1).

## Decision

Every live check against an owner's cloud account sends all API calls through one guarded layer that refuses, before sending, any token write except on tokens the pass itself created. The product's own setup command skips (rather than attempts) deleting a protected bootstrap token.

The parts of this decision:
- Both guards (the product's `guardTokenWrites` and the live layer) judge the path that is actually sent: `sentPath(path)` normalises it as the URL parser does and decodes each segment.
- The product guard allows only the bootstrap token's own DELETE and the everyday token's in-place PUT; the live layer allows writes only on IDs it created, and checks a PUT body's name and expiry.
- The live layer counts every request, HEAD probes included, against the budgets, and refuses all later calls after a 429. `CloudflareRequestsStopped` is rethrown, never swallowed.
- When the bootstrap ID is in `protectedTokenIds` / `PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS`, setup sends no DELETE, keeps the line in `.env.cloudflare`, prints a note and exits 0.

## Alternatives considered

- **Rely on the product's guard alone.** Rejected: it protects only named IDs, and a driver bug outside the product would be unguarded.
- **Deny-list the owner's token only.** Rejected: any other token on the account stays deletable by a bug.
- **Let the guard refuse the protected self-delete and accept the failure.** Rejected: every live run exits 1, so SETUP-AC-011 can never pass live, and the refusal masks real failures.
- **Allow one self-delete of the owner's token.** Rejected outright: it breaks the owner's rule.

## Consequences

- Easier: a live pass can't modify any token it didn't create, whatever the driver does; guard bypasses are unit-tested in 30 forms.
- Harder: a live pass can't exercise the real bootstrap self-delete unless the owner supplies a separate, deletable bootstrap token. SETUP-AC-011's self-delete clause rests on the fake API plus plan §2's live evidence (owner question 20).
- Accepted: the CLI runs inside the live pass (deploy/remove) were counted and token-guarded but not budget-enforced by the layer.

## References

- [`../2026-10-27-50.md`](../2026-10-27-50.md): the source retrospective.
- [`./SKILL-SPEC-66c173e7c7-guarded-live-cloud-pass.md`](./SKILL-SPEC-66c173e7c7-guarded-live-cloud-pass.md): the related skill spec.
- `packages/framework/src/provision/cloudflare/cloudflare-setup.ts` (`guardTokenWrites`), `packages/framework/src/provision/cloudflare/api.ts` (`sentPath`, `CloudflareRequestsStopped`), `ai/implementation/spikes/live-wizard/guarded-api.ts`.
- Decisions DEC-0589, DEC-0613–0619; PRs #42, #44, #45, #46.
