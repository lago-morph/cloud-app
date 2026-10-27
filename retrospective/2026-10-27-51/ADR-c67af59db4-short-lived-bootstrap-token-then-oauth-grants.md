# ADR: Short-lived bootstrap token, then OAuth grants for account setup

- **ID**: ADR-c67af59db4
- **Status**: Draft (not yet adopted to docs/adr/)
- **Date**: 2026-10-27
- **Source retrospective**: ../2026-10-27-51.md
- **PRs covered**: #30, #43, #47

## Context

Setup should be possible for owners with little Cloudflare experience, run by an agent in a cloud sandbox, without high-privilege tokens sitting in files or in the session log.

Three platform facts shape it, all verified live:
- **The API refuses to create a token that holds Account API Tokens Write** (400, code 1001). So the first token must come from the dashboard. A deep link can pre-tick its permission groups, and was verified to.
- **A token can delete itself only if it holds that permission;** without it, the call returns 403/9109.
- **A signed-in member's OAuth grant can do what their role allows,** within the scopes the client has. It can even create API tokens whose groups those scopes cover.

The v0.1.1 wizard used a long-lived bootstrap token for the whole setup. With an admin app available, the bootstrap only has to deploy that app.

## Decision

Cloudflare setup starts from a bootstrap API token that must expire within one day, is never stored, deletes itself at once if its expiry is longer, and is deleted after it deploys the admin app; every later setup action runs under the signed-in owner's own OAuth grant.

- **Permissions:** Workers Scripts Write, OAuth Client Write, Secrets Store Write, and Account API Tokens Write. The last is needed only for self-deletion.
- **What the bootstrap does:** it creates both OAuth clients, the sign-in client and the admin client, because no OAuth scope can create clients. It puts their secrets straight into Secrets Store, since each is shown once. It deploys the admin app, deletes itself, and comments out its line in `.env.cloudflare`.
- **What the admin app does:** account setup and the everyday token. Each page requests only its own optional scopes.

## Alternatives considered

- **v0.1.1's single high-privilege bootstrap for all setup:** it works, but the powerful token lives for the whole setup and can do everything. Superseded once the admin app exists.
- **The agent creates the bootstrap token:** impossible, since the API refuses tokens with Account API Tokens Write.
- **Keep the bootstrap token for re-runs:** rejected. A stored token is a standing risk, and an interrupted run should leave at most a 1-day window.
- **The agent shows the everyday token in chat:** rejected, because anything displayed lands in the session log. The admin app shows it in the browser instead.

## Consequences

- **Easier:**
  - the high-privilege credential lives at most a day and usually minutes;
  - the agent never sees later secrets;
  - permission changes later on can use `PUT /tokens/{id}`, which keeps the value.
- **Harder:**
  - setup needs a browser sign-in by an admin member;
  - a token with too long an expiry is destroyed, and the owner must make a new one;
  - the admin client must list every optional scope any page needs, decided in advance.

## References

- [`../2026-10-27-51.md`](../2026-10-27-51.md): the source retrospective.
- [`./ADR-fbb555b6f5-sign-in-with-cloudflare-through-one-shared-auth-app.md`](./ADR-fbb555b6f5-sign-in-with-cloudflare-through-one-shared-auth-app.md): the sign-in design it serves.
- `ai/implementation/plan-v0.2.0-auth.md`: §1 D8–D10, §2.1a, §2.1b, §2.3, §5.
- `ai/implementation/plan-setup-wizard.md`: the token facts and the deep links.
- PRs the decision was made in: #30, #43, #47.
