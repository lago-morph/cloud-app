/**
 * The account's Secrets Store, as the bootstrap uses it (v0.2.0 plan §5.1 step 2; D7): find or
 * create the store, and put a secret into it by name. Create and put only; binding and reading are
 * item F's (`deploy`). The API never returns a secret's value (it is write-only), and neither does
 * this module: it returns names and IDs only.
 *
 * Endpoints (developers.cloudflare.com/api/resources/secrets_store): `GET`/`POST
 * /accounts/<a>/secrets_store/stores`, `GET`/`POST …/stores/<s>/secrets` (the create takes a list
 * of `{ name, value, scopes }`), and `PATCH …/stores/<s>/secrets/<id>` with `{ value }`. They need
 * "Secrets Store Write" (plan §2.1b). A live account has one store (plan §2.1b); the create of a
 * store when there is none, and its body `{ name }`, are *unverified* (DEC-0685).
 */
import { describeFailure, succeeded, type ApiReply, type CloudflareApi } from "./api.js";

/** PAR-437: the store the bootstrap creates when the account has none. */
export const STORE_NAME = "prototype-framework";

/** Only Workers may use the secrets the bootstrap puts (Secrets Store scopes). */
export const SECRET_SCOPES: readonly string[] = Object.freeze(["workers"]);

const listOf = (r: ApiReply): { id?: unknown; name?: unknown }[] | undefined => {
  const result = (r.body as { result?: unknown } | null)?.result;
  return succeeded(r) && Array.isArray(result) ? (result as { id?: unknown; name?: unknown }[]) : undefined;
};

/** The ID of the account's store: its first one, or a new one named `STORE_NAME` when it has none. */
export async function ensureStore(api: CloudflareApi, accountId: string): Promise<string> {
  const listed = await api("GET", `/accounts/${accountId}/secrets_store/stores?per_page=50`);
  const stores = listOf(listed);
  if (stores === undefined) throw new Error(`listing the account's Secrets Store stores failed: ${describeFailure(listed)}`);
  const first = stores.find((s) => typeof s.id === "string" && s.id !== "");
  if (first !== undefined) return first.id as string;
  const created = await api("POST", `/accounts/${accountId}/secrets_store/stores`, { name: STORE_NAME });
  const id = (created.body as { result?: { id?: unknown } } | null)?.result?.id;
  if (!succeeded(created) || typeof id !== "string" || id === "") throw new Error(`creating the Secrets Store store ${STORE_NAME} failed: ${describeFailure(created)}`);
  return id;
}

/** The names of the store's secrets, with their IDs (never their values). */
export async function secretIds(api: CloudflareApi, accountId: string, storeId: string): Promise<Map<string, string>> {
  const r = await api("GET", `/accounts/${accountId}/secrets_store/stores/${storeId}/secrets?per_page=100`);
  const list = listOf(r);
  if (list === undefined) throw new Error(`listing the Secrets Store's secrets failed: ${describeFailure(r)}`);
  return new Map(list.flatMap((s) => (typeof s.name === "string" && typeof s.id === "string" ? [[s.name, s.id] as const] : [])));
}

/**
 * Puts `value` into the store as the secret `name`: a new secret, or the existing one's value
 * replaced (`existing`: its ID from `secretIds`). Throws naming the secret, never the value.
 */
export async function putSecret(api: CloudflareApi, accountId: string, storeId: string, name: string, value: string, existing?: string): Promise<void> {
  const base = `/accounts/${accountId}/secrets_store/stores/${storeId}/secrets`;
  const r = existing === undefined ? await api("POST", base, [{ name, value, scopes: [...SECRET_SCOPES] }]) : await api("PATCH", `${base}/${existing}`, { value });
  if (!succeeded(r)) throw new Error(`putting the secret ${name} into Secrets Store failed: ${describeFailure(r)}`);
}
