/**
 * The auth app's deploy by the admin app's account setup (v0.2.0 plan §5.2 page 1, §3; D5;
 * DEC-0719), with the signed-in admin's grant:
 * - its D1 database `prototype-auth` (PAR-450), found by name or created; the auth app applies its
 *   own schema on its first request (DEC-0656);
 * - the Worker `prototype-auth` (`APP_SCRIPTS.signin`, PAR-438) uploaded as one ES module, bound to
 *   that database as `DB` (F's deploy finds the registry through this binding, DEC-0725), to the
 *   sign-in client's ID and secret in Secrets Store (stored there by the bootstrap, PAR-436), and to
 *   its account and public origin (`auth-app/config.ts`); its `workers.dev` route on, previews off.
 * It stops before any write when the sign-in client is not in Secrets Store. Every run uploads this
 * framework's auth app, so a newer framework updates it.
 */
import { describeFailure, succeeded, type CloudflareApi } from "./api.js";
import { APP_SCRIPTS, appOrigin, CLIENT_SECRET_NAMES } from "./oauth-clients.js";
import { storedSecrets } from "./secrets-store.js";

/** PAR-450: the auth app's D1 database (tables `users`, `codes`, `registry`, `sign_ins`; auth-app/store.ts). */
export const AUTH_APP_DATABASE = "prototype-auth";

/** The auth app's binding names, as `auth-app/config.ts` and `auth-app/worker.ts` read them. */
export const AUTH_APP_BINDINGS = Object.freeze({ db: "DB", clientId: "AUTH_APP_CLIENT_ID", clientSecret: "AUTH_APP_CLIENT_SECRET", accountId: "AUTH_APP_ACCOUNT_ID", origin: "AUTH_APP_ORIGIN" });

export const AUTH_APP_MODULE = "worker.js";
export const AUTH_APP_COMPATIBILITY_DATE = "2026-10-01";

const SCRIPT = APP_SCRIPTS.signin;
const WHAT = `the auth app (Worker ${SCRIPT})`;

/** The UUID of the auth app's database, creating it when absent. */
export async function ensureAuthDatabase(api: CloudflareApi, accountId: string): Promise<{ uuid: string; created: boolean }> {
  const base = `/accounts/${accountId}/d1/database`;
  const listed = await api("GET", `${base}?name=${encodeURIComponent(AUTH_APP_DATABASE)}&per_page=10`);
  const list = (listed.body as { result?: { uuid?: unknown; name?: unknown }[] } | null)?.result;
  if (!succeeded(listed) || !Array.isArray(list)) throw new Error(`listing the account's D1 databases failed: ${describeFailure(listed)}`);
  const found = list.find((d) => d.name === AUTH_APP_DATABASE);
  if (typeof found?.uuid === "string") return { uuid: found.uuid, created: false };
  const made = await api("POST", base, { name: AUTH_APP_DATABASE });
  const uuid = (made.body as { result?: { uuid?: unknown } } | null)?.result?.uuid;
  if (!succeeded(made) || typeof uuid !== "string") throw new Error(`creating the auth app's D1 database ${AUTH_APP_DATABASE} failed: ${describeFailure(made)}`);
  return { uuid, created: true };
}

export interface AuthAppDeployOptions {
  /** The auth app's Worker module (`auth-app/worker.ts` bundled). */
  readonly source: string;
  /** The Secrets Store holding the sign-in client. */
  readonly storeId: string;
  /** The account's `workers.dev` subdomain. */
  readonly subdomain: string;
}

/** Deploys the auth app and its database; its public origin. */
export async function deployAuthApp(api: CloudflareApi, accountId: string, options: AuthAppDeployOptions): Promise<{ origin: string; databaseId: string; databaseCreated: boolean }> {
  const stored = await storedSecrets(api, accountId, options.storeId);
  for (const name of [CLIENT_SECRET_NAMES.signin.id, CLIENT_SECRET_NAMES.signin.secret]) {
    if (!stored.has(name)) throw new Error(`the sign-in client's ${name} is not in Secrets Store: run npm run cloudflare-setup with a bootstrap token first`);
  }
  const db = await ensureAuthDatabase(api, accountId);
  const origin = appOrigin("signin", options.subdomain);
  const secret = (name: string, secretName: string) => ({ type: "secrets_store_secret", name, store_id: options.storeId, secret_name: secretName });
  const metadata = {
    main_module: AUTH_APP_MODULE,
    compatibility_date: AUTH_APP_COMPATIBILITY_DATE,
    bindings: [
      { type: "d1", name: AUTH_APP_BINDINGS.db, id: db.uuid },
      secret(AUTH_APP_BINDINGS.clientId, CLIENT_SECRET_NAMES.signin.id),
      secret(AUTH_APP_BINDINGS.clientSecret, CLIENT_SECRET_NAMES.signin.secret),
      { type: "plain_text", name: AUTH_APP_BINDINGS.accountId, text: accountId },
      { type: "plain_text", name: AUTH_APP_BINDINGS.origin, text: origin },
    ],
  };
  const script = `/accounts/${accountId}/workers/scripts/${SCRIPT}`;
  const form = new FormData();
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
  form.set(AUTH_APP_MODULE, new Blob([options.source], { type: "application/javascript+module" }), AUTH_APP_MODULE);
  const uploaded = await api("PUT", script, form);
  if (!succeeded(uploaded)) throw new Error(`uploading ${WHAT} failed: ${describeFailure(uploaded)}`);
  const routed = await api("POST", `${script}/subdomain`, { enabled: true, previews_enabled: false });
  if (!succeeded(routed)) throw new Error(`turning on the workers.dev route of ${WHAT} failed: ${describeFailure(routed)}`);
  return { origin, databaseId: db.uuid, databaseCreated: db.created };
}
