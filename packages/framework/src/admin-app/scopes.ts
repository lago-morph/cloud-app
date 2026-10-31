/**
 * PAR-447: the optional scopes each admin page requests through the admin client (v0.2.0 plan
 * §5.2: "Each requests only its own optional scopes"; D8). Every grant also asks for `openid` and
 * the client's required scopes (`user-details.read`, `memberships.read`), so the admin app can
 * check who signed in and that they are still an administrator. A scope must be one the admin
 * client offers (`ADMIN_OPTIONAL_SCOPES`, oauth-clients.ts), or Cloudflare refuses the request.
 *
 * - `signin`: none; the session only says who the admin is.
 * - `setup` (page 1): deploy the auth app with its D1 database, the shared buckets, Secrets Store,
 *   and the signing credential (an API token, D7).
 * - `everyday` (page 2): `account-api-tokens.write` to create the token, plus one scope for every
 *   group of the everyday set, because a token created through a grant holds only groups its
 *   scopes cover (§2.1a).
 * - `status` (page 3): reads the Workers, the setup record in R2 and the auth app's D1. The client
 *   offers no read variants of these (DEC-0713), so the write scopes are asked for; the page only reads.
 */
/**
 * The admin client's required scopes, as `REQUIRED_SCOPES` in oauth-clients.ts (a unit test keeps
 * them equal). Not imported from there: that module pulls in Node's crypto, and this one is
 * bundled into the Worker.
 */
const REQUIRED_SCOPES: readonly string[] = Object.freeze(["user-details.read", "memberships.read"]);

export const PAGE_SCOPES = Object.freeze({
  signin: Object.freeze([] as string[]),
  setup: Object.freeze(["workers-scripts.write", "d1.write", "workers-r2.write", "secrets-store.write", "account-api-tokens.write"]),
  everyday: Object.freeze(["account-api-tokens.write", "workers-scripts.write", "workers-r2.write", "d1.write", "secrets-store.read"]),
  status: Object.freeze(["workers-scripts.write", "workers-r2.write", "d1.write"]),
});

export type AdminPageId = keyof typeof PAGE_SCOPES;

export const isPageId = (v: unknown): v is AdminPageId => typeof v === "string" && Object.hasOwn(PAGE_SCOPES, v);

/** The `scope` parameter of a page's authorization request. */
export const grantScope = (page: AdminPageId): string => ["openid", ...REQUIRED_SCOPES, ...PAGE_SCOPES[page]].join(" ");
