/**
 * The two OAuth clients the bootstrap creates (v0.2.0 plan §5.1 step 2; DEC-0684): no sign-in
 * scope can create a client (plan §2.1a), so the bootstrap token (OAuth Client Write) makes both.
 *
 * - **The admin client** (`prototype-framework-admin`): private and confidential, for the admin app
 *   (`prototype-admin`). Required scopes `user-details.read` and `memberships.read`; optional
 *   scopes for everything the admin pages need (plan §5.2), including one per everyday-token group
 *   (§2.1a: a token made through a grant holds only groups its scopes cover).
 * - **The sign-in client** (`prototype-framework-sign-in`): private and confidential, for the auth
 *   app (`prototype-auth`). The two required scopes only.
 *
 * Both are made with `response_types ["code","id_token"]`, because the API drops `openid` otherwise
 * (plan §2.1), and the authorization-code grant only (no refresh: the auth app revokes its tokens).
 * A client's secret appears only in its create answer (§2.1), so it goes straight into Secrets Store
 * (DEC-0685), with the client's ID beside it, under the names of `CLIENT_SECRET_NAMES` (PAR-436):
 * the admin app and the auth app read both from their bindings. Each entry's comment holds the
 * client's ID, so a client is kept only when both entries name a client listed under its name. Any
 * other client of that name is useless (its secret cannot be read again): it is deleted and made
 * anew. The secret is never printed or returned; `onSecret` hands it to the run's redaction.
 *
 * *Unverified* (DEC-0684; the live pass checks them): the create body's field names other than
 * `redirect_uris` and `response_types` (`name`, `grant_types`, `token_endpoint_auth_method`,
 * `scopes`, `optional_scopes`), the answer's `client_id` and `client_secret`, the list's fields, and
 * `DELETE …/oauth_clients/<id>`.
 */
import { randomSubdomain } from "./account.js";
import { describeFailure, succeeded, type CloudflareApi } from "./api.js";
import { ensureStore, putSecret, storedSecrets } from "./secrets-store.js";

/** The page size of the client list; one page is read (review of PR 31). */
const CLIENTS_PAGE = 100;

export type ClientKind = "admin" | "signin";

/** The Workers whose callbacks the clients redirect to (PAR-438). */
export const APP_SCRIPTS: Readonly<Record<ClientKind, string>> = Object.freeze({ admin: "prototype-admin", signin: "prototype-auth" });

/** The clients' names, by which a later run finds them. */
export const CLIENT_NAMES: Readonly<Record<ClientKind, string>> = Object.freeze({ admin: "prototype-framework-admin", signin: "prototype-framework-sign-in" });

/** PAR-436: the Secrets Store names of each client's ID and secret. */
export const CLIENT_SECRET_NAMES: Readonly<Record<ClientKind, { readonly id: string; readonly secret: string }>> = Object.freeze({
  admin: Object.freeze({ id: "PROTOTYPE_ADMIN_CLIENT_ID", secret: "PROTOTYPE_ADMIN_CLIENT_SECRET" }),
  signin: Object.freeze({ id: "PROTOTYPE_SIGNIN_CLIENT_ID", secret: "PROTOTYPE_SIGNIN_CLIENT_SECRET" }),
});

/** Plan §4.1 step 2 and §5.1: both clients' required scopes. */
export const REQUIRED_SCOPES: readonly string[] = Object.freeze(["user-details.read", "memberships.read"]);

/**
 * The admin client's optional scopes (plan §5.2): account setup (Workers, D1, R2, Secrets Store,
 * and the signing credential, an API token), the everyday token (`account-api-tokens.write` and
 * one scope per everyday group: `workers-scripts.write`, `workers-r2.write`, `d1.write`,
 * `secrets-store.read`), and the read-only status page. The same six as the live test (§2.1a).
 */
export const ADMIN_OPTIONAL_SCOPES: readonly string[] = Object.freeze(["account-api-tokens.write", "d1.write", "secrets-store.read", "secrets-store.write", "workers-r2.write", "workers-scripts.write"]);

/** The app's public origin under the account's `workers.dev` subdomain. */
export const appOrigin = (kind: ClientKind, subdomain: string): string => `https://${APP_SCRIPTS[kind]}.${subdomain}.workers.dev`;

/** The create body of one client (`POST /accounts/<a>/oauth_clients`). */
export function clientBody(kind: ClientKind, subdomain: string): Record<string, unknown> {
  return {
    name: CLIENT_NAMES[kind],
    redirect_uris: [`${appOrigin(kind, subdomain)}/callback`],
    response_types: ["code", "id_token"],
    grant_types: ["authorization_code"],
    token_endpoint_auth_method: "client_secret_post",
    scopes: [...REQUIRED_SCOPES],
    optional_scopes: kind === "admin" ? [...ADMIN_OPTIONAL_SCOPES] : [],
  };
}

/** The account's `workers.dev` subdomain, registered (Workers Scripts Write, plan §5.1) when it has none. */
export async function ensureSubdomain(api: CloudflareApi, accountId: string, newSubdomain: () => string = randomSubdomain): Promise<string> {
  const r = await api("GET", `/accounts/${accountId}/workers/subdomain`);
  const current = (r.body as { result?: { subdomain?: unknown } | null } | null)?.result?.subdomain;
  if (succeeded(r) && typeof current === "string" && current !== "") return current;
  if (r.status !== 404 && !succeeded(r)) throw new Error(`reading the account's workers.dev subdomain failed: ${describeFailure(r)}`);
  const subdomain = newSubdomain();
  const put = await api("PUT", `/accounts/${accountId}/workers/subdomain`, { subdomain });
  if (!succeeded(put)) throw new Error(`registering a workers.dev subdomain failed: ${describeFailure(put)}`);
  return subdomain;
}

export interface OAuthClientsOptions {
  /** The account's `workers.dev` subdomain (`ensureSubdomain`). */
  readonly subdomain: string;
  /** Receives each new client secret, for the run's redaction; never for printing. */
  readonly onSecret?: (value: string) => void;
}

/** Makes sure both clients exist with their ID and secret in Secrets Store; which were created and which kept. */
export async function ensureOAuthClients(api: CloudflareApi, accountId: string, options: OAuthClientsOptions): Promise<{ readonly created: ClientKind[]; readonly kept: ClientKind[] }> {
  const listed = await api("GET", `/accounts/${accountId}/oauth_clients?per_page=${String(CLIENTS_PAGE)}`);
  const body = listed.body as { result?: unknown; result_info?: { total_count?: unknown } } | null;
  const list = body?.result;
  if (!succeeded(listed) || !Array.isArray(list)) throw new Error(`listing the account's OAuth clients failed: ${describeFailure(listed)}`);
  // One page only: a client missed on a later page would be made twice (review of PR 31).
  const total = body?.result_info?.total_count;
  if (typeof total === "number" && total > list.length) throw new Error(`the account has ${String(total)} OAuth clients, more than one page of ${String(CLIENTS_PAGE)}; setup reads one page only`);
  const storeId = await ensureStore(api, accountId);
  const stored = await storedSecrets(api, accountId, storeId);
  const created: ClientKind[] = [];
  const kept: ClientKind[] = [];
  for (const kind of ["admin", "signin"] as const) {
    const names = CLIENT_SECRET_NAMES[kind];
    const existing = (list as { client_id?: unknown; id?: unknown; name?: unknown }[]).filter((c) => c.name === CLIENT_NAMES[kind]);
    // Kept only when both entries name, in their comment, a client listed under this name (DEC-0685):
    // an entry left by a deleted client or by a part-done replacement does not count.
    const owner = stored.get(names.id)?.comment;
    if (owner !== undefined && stored.get(names.secret)?.comment === owner && existing.some((c) => (c.client_id ?? c.id) === owner)) {
      kept.push(kind);
      continue;
    }
    for (const old of existing) {
      const id = old.client_id ?? old.id;
      if (typeof id !== "string") continue;
      const d = await api("DELETE", `/accounts/${accountId}/oauth_clients/${id}`);
      if (!succeeded(d)) throw new Error(`deleting the OAuth client ${CLIENT_NAMES[kind]}, whose secret is not in Secrets Store, failed: ${describeFailure(d)}`);
    }
    const r = await api("POST", `/accounts/${accountId}/oauth_clients`, clientBody(kind, options.subdomain));
    if (!succeeded(r)) throw new Error(`creating the OAuth client ${CLIENT_NAMES[kind]} failed: ${describeFailure(r)}`);
    const result = (r.body as { result?: { client_id?: unknown; client_secret?: unknown } } | null)?.result;
    const clientId = result?.client_id;
    const secret = result?.client_secret;
    if (typeof secret !== "string" || secret === "") throw new Error(`creating the OAuth client ${CLIENT_NAMES[kind]}: Cloudflare's answer held no client secret`);
    options.onSecret?.(secret);
    if (typeof clientId !== "string" || clientId === "") throw new Error(`creating the OAuth client ${CLIENT_NAMES[kind]}: Cloudflare's answer held no client ID`);
    try {
      await putSecret(api, accountId, storeId, names.secret, secret, stored.get(names.secret)?.id, clientId);
      await putSecret(api, accountId, storeId, names.id, clientId, stored.get(names.id)?.id, clientId);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; the client ${CLIENT_NAMES[kind]} was created, and the next setup run replaces the client`);
    }
    created.push(kind);
  }
  return { created, kept };
}
