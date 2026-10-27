# ADR: Sign in with Cloudflare through one shared auth app

- **ID**: ADR-fbb555b6f5
- **Status**: Draft (not yet adopted to docs/adr/)
- **Date**: 2026-10-27
- **Source retrospective**: ../2026-10-27-51.md
- **PRs covered**: #43, #47, #51

## Context

Email-and-password sign-in through Better Auth carries a lot that a prototype doesn't need:
- **Plan and domain:** it needs the Workers Paid plan, an email domain and Email Service.
- **Machinery:** a mail sink, rate-limit tables and password pages.
- **Code:** about 4,000 source lines and 3,500 test lines.

The users of a prototype are the owner and a few testers, and all of them can be members of the owner's Cloudflare account. Cloudflare offers private OAuth clients that only account members can use, on every plan.

These facts were verified live on 2026-10-26 and 2026-10-27:
- an RS256 ID token with `sub`, `email` and `email_verified`;
- `/memberships` returns role names;
- a minimal member ("HTTP Applications Read") can authorize but is refused everything else.

## Decision

Prototype apps sign users in through one account-level auth Worker that runs a private Cloudflare OAuth client, maps account membership to a role, and hands the app a single-use code redeemed over a service binding, with no OIDC provider and no Better Auth.

- **The flow:**
  1. The app redirects to the auth app.
  2. The auth app runs the code flow with PKCE S256, checks the ID token, reads `/memberships`, and maps "Super Administrator - All Privileges" or "Administrator" to admin and any other accepted membership to user.
  3. It upserts its D1 `users` table and revokes the Cloudflare tokens.
  4. It redirects back with a code that is hashed, lives 60 s, is single-use, and is bound to the app and its return URL.
  5. The app redeems the code with `env.AUTH.redeem` and sets its own `__Host-session` cookie.
- **Return URLs** must match a registry exactly.
- **Local and `test-` stages** keep mock login.

## Alternatives considered

- **Keep Better Auth:** rejected because of the Paid plan, the email domain, and the size of the mail and password machinery.
- **Auth0 (OIDC) as provider:** evaluated by two agents. It adds an outside tenant, its own sign-up, and a second set of credentials to set up, for no gain when every user is already an account member.
- **OpenAuth as the auth app:** rejected (source read at 98dc596):
  - maintenance has stalled at 0.4.3;
  - it has no ID token;
  - its default redirect check accepts any `*.workers.dev` host;
  - PKCE is optional;
  - its tokens last 30 days and a year.
- **A home-made OIDC provider between the apps and the auth app:** rejected by the owner. The apps and the auth app share one trust boundary, so a single-use code over a service binding is enough. OIDC is for parties that don't trust each other.

## Consequences

- **Easier:**
  - the Workers Free plan suffices;
  - no email domain;
  - no passwords, mail or rate limits;
  - apps hold no Cloudflare credential;
  - roles are managed in the Cloudflare dashboard.
- **Harder:**
  - testers must be account members;
  - the auth app is a single point of failure for new sign-ins, though existing sessions keep working;
  - role names are free text, so the mapping is a PAR;
  - a removed member keeps their session until it renews.
- **Breaking:** 0.1.x password accounts are dropped (v0.2.0, a minor release before 1.0).
- **Still unverified:** the plain "Administrator" role string.

## References

- [`../2026-10-27-51.md`](../2026-10-27-51.md): the source retrospective.
- [`./SKILL-SPEC-b752fd328c-owner-assisted-live-test.md`](./SKILL-SPEC-b752fd328c-owner-assisted-live-test.md): how the OAuth facts were verified.
- `ai/implementation/plan-v0.2.0-auth.md`: §1 D1–D6, §2.1, §2.1a, §2.4, §3, §4.
- PRs the decision was made in: #43, #47.
