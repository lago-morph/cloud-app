/**
 * The stage Worker's secrets and public route on Cloudflare (cloudflare.md "Deploy mechanics"
 * `setSecret`, `stopApp`, `startApp`; SEC-REQ-003; DEC-0078, DEC-0087, DEC-0090).
 *
 * Secrets are Worker secrets named `SECRET_<NAME>` (SEC-REQ-003), written through the script's
 * secrets API, never through SST: an SST upload that declared a binding with a secret's name
 * would replace the secret (DEC-0087). Stopping turns the Worker's `workers.dev` route off,
 * starting turns it on; `previews_enabled: false` is always sent, since a body without it turns
 * preview URLs on (DEC-0090). The call answers with the new state, which is checked.
 *
 * A production stage's link to the account's auth app (plan-v0.2.0 §3, §4.1; DEC-0667, DEC-0725):
 * the auth app's registry is the D1 database its Worker `prototype-auth` (PAR-438) binds as `DB`,
 * found from that Worker's settings, so `deploy` and `remove` need no name of their own for it.
 * They write and clear the registry through the D1 HTTP API ("D1 Write", plan §5.2 page 2) with
 * the auth app's own statements (`auth-app/store.ts`), so the pair the auth app matches exactly is
 * the pair written here.
 */
import { ensureSchema, registerReturnUrl, unregisterApp, type D1Like, type D1Statement } from "../../auth-app/store.js";
import { secretLocation } from "../../config/secret-locations.js";
import type { Stage } from "../core/operations.js";
import { describeFailure, resultOf, succeeded, type CloudflareApi } from "./api.js";
import { d1Client, type D1Client } from "./d1/client.js";
import { workerName } from "./names.js";
import { APP_SCRIPTS } from "./oauth-clients.js";

const scriptPath = (accountId: string, stage: Stage) => `/accounts/${accountId}/workers/scripts/${workerName(stage)}`;

/** `SECRET_<UPPER_SNAKE>` → the lowerCamelCase logical name; undefined for other bindings. */
export function logicalSecretName(location: string): string | undefined {
  if (!location.startsWith("SECRET_")) return undefined;
  const [first = "", ...rest] = location.slice("SECRET_".length).toLowerCase().split("_");
  return first + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

export async function setSecret(api: CloudflareApi, accountId: string, stage: Stage, name: string, value: string): Promise<void> {
  const r = await api("PUT", `${scriptPath(accountId, stage)}/secrets`, { name: secretLocation("cloudflare", name), text: value, type: "secret_text" });
  if (r.status === 404) throw new Error(`setting secret ${name} failed: Worker ${workerName(stage)} does not exist yet; run deploy first`);
  resultOf(r, `setting secret ${name} on Worker ${workerName(stage)}`);
}

/** Logical names of the Worker's secrets; null while the Worker does not exist. */
export async function listSetSecrets(api: CloudflareApi, accountId: string, stage: Stage): Promise<ReadonlySet<string> | null> {
  const r = await api("GET", `${scriptPath(accountId, stage)}/secrets`);
  if (r.status === 404) return null;
  const secrets = resultOf<{ name: string }[]>(r, `listing the secrets of Worker ${workerName(stage)}`);
  return new Set(secrets.map((s) => logicalSecretName(s.name)).filter((n): n is string => n !== undefined));
}

/** Turns the stage Worker's `workers.dev` route on (`startApp`) or off (`stopApp`). */
export async function setRoute(api: CloudflareApi, accountId: string, stage: Stage, enabled: boolean): Promise<void> {
  const what = `turning ${enabled ? "on" : "off"} the workers.dev route of Worker ${workerName(stage)}`;
  const r = await api("POST", `${scriptPath(accountId, stage)}/subdomain`, { enabled, previews_enabled: false });
  const result = resultOf<{ enabled?: unknown; previews_enabled?: unknown } | null>(r, what);
  if (result?.enabled !== enabled || result.previews_enabled !== false) {
    throw new Error(`${what}: Cloudflare answered enabled ${String(result?.enabled)}, previews_enabled ${String(result?.previews_enabled)} (${describeFailure(r)})`);
  }
}

/** The auth app's Worker (PAR-438) and the binding of its registry database (DEC-0725). */
export const AUTH_APP_SCRIPT = APP_SCRIPTS.signin;
export const AUTH_APP_REGISTRY_BINDING = "DB";
/** The path of an app's sign-in callback, registered as its return URL (DEC-0667). */
export const AUTH_CALLBACK_PATH = "/api/auth/callback";

/** What a production stage's deploy and remove do with the account's auth app. */
export interface AuthAppLink {
  /** What stops a production stage from signing in: the auth app or its registry missing; empty when both exist. Reads only. */
  problems(): Promise<string[]>;
  /** Registers the app's return URL (exact pair, idempotent); throws when the auth app or its registry is missing. */
  register(app: string, returnUrl: string): Promise<void>;
  /** Clears the app's return URLs and outstanding codes; nothing to do when the auth app or its registry is absent. */
  unregister(app: string): Promise<void>;
}

const NO_AUTH_APP = `the account's auth app (Worker ${AUTH_APP_SCRIPT}) is not deployed; a production stage signs in through it: run account setup in the admin app first`;
const NO_REGISTRY = `the account's auth app (Worker ${AUTH_APP_SCRIPT}) has no registry (its D1 binding ${AUTH_APP_REGISTRY_BINDING}); run account setup in the admin app again`;

type Param = string | number | null;

/** One statement of the auth app's store, sent through the D1 HTTP API's `/query`. */
class HttpStatement implements D1Statement {
  constructor(
    private readonly send: (statements: readonly HttpStatement[]) => Promise<Record<string, unknown>[][]>,
    readonly sql: string,
    readonly params: readonly Param[] = [],
  ) {}
  bind(...values: unknown[]): D1Statement {
    return new HttpStatement(this.send, this.sql, values as Param[]);
  }
  async first<T>(): Promise<T | null> {
    return ((await this.send([this]))[0]?.[0] as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: ((await this.send([this]))[0] ?? []) as T[] };
  }
  async run(): Promise<unknown> {
    return this.send([this]);
  }
}

/** The auth app's `D1Like` over the D1 HTTP API: each statement, or each batch, is one atomic `/query`. */
function httpD1(client: D1Client, uuid: string): D1Like {
  const send = (statements: readonly HttpStatement[]) => client.batch(uuid, statements.map((s) => ({ sql: s.sql, params: s.params })));
  return {
    prepare: (sql) => new HttpStatement(send, sql),
    batch: (statements) => send(statements as HttpStatement[]),
  };
}

/** The auth app link over the Cloudflare API (DEC-0725). */
export function cloudflareAuthAppLink(api: CloudflareApi, accountId: string): AuthAppLink {
  const client = d1Client(api, accountId);
  /** The registry's database UUID; "absent" without the Worker, "no-registry" without its `DB` binding. */
  async function registry(): Promise<string> {
    const r = await api("GET", `/accounts/${accountId}/workers/scripts/${AUTH_APP_SCRIPT}/settings`);
    if (r.status === 404) return "absent";
    if (!succeeded(r)) throw new Error(`reading the settings of the auth app's Worker ${AUTH_APP_SCRIPT} failed: ${describeFailure(r)}`);
    const bindings = (r.body as { result?: { bindings?: unknown } } | null)?.result?.bindings;
    const db = (Array.isArray(bindings) ? (bindings as Record<string, unknown>[]) : []).find((b) => b["type"] === "d1" && b["name"] === AUTH_APP_REGISTRY_BINDING);
    // The upload names a D1 binding's database `id`; `database_id` is accepted too until the live pass shows the settings' field (DEC-0725).
    const id = db?.["id"] ?? db?.["database_id"];
    return typeof id === "string" && id !== "" ? id : "no-registry";
  }
  const problem = (state: string): string[] => (state === "absent" ? [NO_AUTH_APP] : state === "no-registry" ? [NO_REGISTRY] : []);
  return {
    problems: async () => problem(await registry()),
    async register(app, returnUrl) {
      const uuid = await registry();
      const [missing] = problem(uuid);
      if (missing !== undefined) throw new Error(missing);
      const db = httpD1(client, uuid);
      // The auth app applies its schema on first use (DEC-0656); a stage deployed before that use needs it now.
      await ensureSchema(db);
      await registerReturnUrl(db, app, returnUrl);
    },
    async unregister(app) {
      const uuid = await registry();
      if (problem(uuid).length > 0) return;
      const db = httpD1(client, uuid);
      await ensureSchema(db);
      await unregisterApp(db, app);
    },
  };
}
