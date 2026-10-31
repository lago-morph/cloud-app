/**
 * The account's R2 signing credential (DEC-0550, superseding DEC-0100's per-stage token; FILES §2
 * "Cloudflare"; PROV-REQ-004): one account API token named `prototype-r2-signing` with the
 * permission group "Workers R2 Storage Bucket Item Write" on every R2 bucket of the account
 * (`com.cloudflare.api.account.<account>: "*"`), and a `deny` policy for the same group on the
 * account buckets (`ACCOUNT_BUCKETS`: the log bucket, the state home, the mail sink's and the
 * backup bucket `prototype-backups`), so the credential reaches the stage buckets only and a leaked
 * stage secret cannot read or overwrite production backups (DEC-0543). Verified live on 2026-10-25:
 * such a token lists a stage bucket over S3 and gets `403 AccessDenied` on the three account
 * buckets it then denied; the fourth deny entry has the same shape and is not yet verified live.
 *
 * The record names the buckets the token denies (`deniedBuckets`). A record that lacks one of
 * `ACCOUNT_BUCKETS` (a token created before the backup bucket existed) reads as absent, so the
 * deploy preflight sends the owner to `setup-account`, which replaces the token.
 *
 * `setup-account` creates it (the only command that needs "Account API Tokens Write") and keeps
 * its S3 credentials (access key ID = token id, secret access key = lowercase hex SHA-256 of the
 * token value, which Cloudflare returns once) in the stage-independent record
 * `framework/r2-signing.json` in the state home `sst-state`. Every `deploy` copies them into the
 * stage's framework-internal Worker secrets `frameworkR2AccessKeyId` / `frameworkR2SecretAccessKey`
 * (step 5). So `deploy` needs no permission on API tokens. Messages never contain the values.
 *
 * **In Secrets Store (plan-v0.2.0 §5.2 page 1, D7; DEC-0729).** The admin app's account setup
 * (`{ secretsStore: true }`) puts both S3 credentials into the account's Secrets Store under
 * `SIGNING_SECRET_NAMES` (PAR-455), each tagged with the token's id in its comment, and the record
 * then names the store instead of holding the secret (`secretsStore: { storeId }`). `deploy` binds
 * them from the store and no longer copies them into Worker secrets. When Secrets Store is
 * unavailable (a beta, plan §10) the record holds the credentials as before: the Worker-secret
 * fallback. `setup-account` without the option keeps the record form.
 *
 * Stages deployed before DEC-0550 have a per-stage token `<app>-<stage>-files-signing`
 * (`legacySigningTokenName`). Their next deploy switches them to the account credential; `remove`
 * deletes the legacy token when the credential may list tokens, and otherwise leaves it (it is
 * scoped to the deleted stage bucket only).
 */
import { createHash } from "node:crypto";
import type { Stage } from "../core/operations.js";
import { describeFailure, resultOf, succeeded, type CloudflareApi } from "./api.js";
import { ensureStore, putSecret, storedSecrets } from "./secrets-store.js";
import { missingPermissions, tokenPolicies } from "./token-policies.js";
import { ACCOUNT_BUCKETS, legacySigningTokenName, STATE_BUCKET } from "./names.js";

export const ITEM_WRITE_PERMISSION = "Workers R2 Storage Bucket Item Write";
/** The permission `setup-account` needs to create the credential. */
export const TOKEN_WRITE_PERMISSION = "Account API Tokens Write";

/** The account signing token's name. */
export const SIGNING_TOKEN_NAME = "prototype-r2-signing";
/** The record's object key in the state home. */
export const SIGNING_RECORD_KEY = "framework/r2-signing.json";
/** The shared resource as printed to the owner. */
export const SIGNING_RESOURCE = `R2 signing credential ${SIGNING_TOKEN_NAME}`;

/** PAR-455: the Secrets Store names of the S3 credentials (access key ID, secret access key). */
export const SIGNING_SECRET_NAMES = Object.freeze({ accessKeyId: "PROTOTYPE_R2_ACCESS_KEY_ID", secretAccessKey: "PROTOTYPE_R2_SECRET_ACCESS_KEY" });

/** Where a deploy finds the credential (DEC-0729): bound from Secrets Store, or copied into Worker secrets. */
export type SigningPlacement =
  | { readonly kind: "secrets-store"; readonly tokenId: string; readonly storeId: string }
  | { readonly kind: "worker-secrets"; readonly credentials: SigningCredentials };

/** Whether a stored record's token denies every current account bucket. */
export function signingRecordIsCurrent(body: unknown): boolean {
  const denied = typeof body === "object" && body !== null ? (body as { deniedBuckets?: unknown }).deniedBuckets : undefined;
  return Array.isArray(denied) && ACCOUNT_BUCKETS.every((bucket) => denied.includes(bucket));
}

export interface SigningCredentials {
  /** The token's id (its identifier for removal). */
  readonly id: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const tokensPath = (accountId: string) => `/accounts/${accountId}/tokens`;
const recordPath = (accountId: string) => `/accounts/${accountId}/r2/buckets/${STATE_BUCKET}/objects/${encodeURIComponent(SIGNING_RECORD_KEY)}`;
const recordResource = `record ${SIGNING_RECORD_KEY} in R2 bucket ${STATE_BUCKET}`;

/** The token's policies: Item Write on every bucket of the account, denied on the account buckets. */
export function signingTokenPolicies(groupId: string, accountId: string): unknown[] {
  const account = `com.cloudflare.api.account.${accountId}`;
  return [
    { effect: "allow", permission_groups: [{ id: groupId }], resources: { [account]: "*" } },
    {
      effect: "deny",
      permission_groups: [{ id: groupId }],
      resources: { [account]: Object.fromEntries(ACCOUNT_BUCKETS.map((bucket) => [`com.cloudflare.edge.r2.bucket.${accountId}_default_${bucket}`, "*"])) },
    },
  ];
}

async function itemWriteGroupId(api: CloudflareApi, accountId: string): Promise<string> {
  const groups = resultOf<{ id: string; name: string }[]>(await api("GET", `${tokensPath(accountId)}/permission_groups`), "reading the API token permission groups");
  const group = groups.find((g) => g.name === ITEM_WRITE_PERMISSION);
  if (!group) throw new Error(`the API token permission group "${ITEM_WRITE_PERMISSION}" was not found on this account`);
  return group.id;
}

async function createSigningToken(api: CloudflareApi, accountId: string): Promise<SigningCredentials> {
  const groupId = await itemWriteGroupId(api, accountId);
  const r = await api("POST", tokensPath(accountId), { name: SIGNING_TOKEN_NAME, policies: signingTokenPolicies(groupId, accountId) });
  const token = resultOf<{ id?: unknown; value?: unknown }>(r, `creating the ${SIGNING_RESOURCE}`);
  if (typeof token.id !== "string" || typeof token.value !== "string") throw new Error(`creating the ${SIGNING_RESOURCE}: Cloudflare returned no token id or value`);
  return { id: token.id, accessKeyId: token.id, secretAccessKey: createHash("sha256").update(token.value).digest("hex") };
}

/** All the account's tokens; with `refusedIsNone`, a refused first page (HTTP 401/403) lists none. */
async function listTokens(api: CloudflareApi, accountId: string, options: { readonly refusedIsNone?: boolean } = {}): Promise<{ id: string; name: string }[]> {
  const tokens: { id: string; name: string }[] = [];
  for (let page = 1; ; page++) {
    const r = await api("GET", `${tokensPath(accountId)}?per_page=50&page=${page}`);
    if (page === 1 && options.refusedIsNone === true && (r.status === 401 || r.status === 403)) return [];
    tokens.push(...resultOf<{ id: string; name: string }[]>(r, "listing the account's API tokens"));
    const info = (r.body as { result_info?: { total_pages?: unknown } }).result_info;
    if (typeof info?.total_pages !== "number" || page >= info.total_pages) return tokens;
  }
}

/** Deletes a signing token by ID; a failure names it by `name` only, never the ID (SETUP-REQ-007). */
export async function deleteSigningToken(api: CloudflareApi, accountId: string, id: string, name: string = SIGNING_TOKEN_NAME): Promise<void> {
  const r = await api("DELETE", `${tokensPath(accountId)}/${id}`);
  if (succeeded(r) || r.status === 404) return;
  throw new Error(`deleting the R2 API token ${name} failed: ${describeFailure(r)}`);
}

/** Validates a stored record; throws naming the record (never a value) when it is not one. */
export function parseSigningRecord(body: unknown): SigningCredentials {
  const r = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const { tokenId, accessKeyId, secretAccessKey } = r;
  if (typeof tokenId !== "string" || tokenId === "" || typeof accessKeyId !== "string" || accessKeyId === "" || typeof secretAccessKey !== "string" || !/^[0-9a-f]{64}$/.test(secretAccessKey)) {
    throw new Error(`the ${recordResource} is not a valid signing record; run setup-account --target cloudflare with the setup token to replace it`);
  }
  return { id: tokenId, accessKeyId, secretAccessKey };
}

/** A record of either form (DEC-0729); throws naming the record, never a value, when it is neither. */
function parsePlacement(body: unknown): SigningPlacement {
  const r = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const storeId = (r["secretsStore"] as { storeId?: unknown } | undefined)?.storeId;
  if (storeId === undefined) return { kind: "worker-secrets", credentials: parseSigningRecord(body) };
  const { tokenId, accessKeyId } = r;
  if (typeof storeId !== "string" || storeId === "" || typeof tokenId !== "string" || tokenId === "" || typeof accessKeyId !== "string" || accessKeyId === "" || "secretAccessKey" in r) {
    throw new Error(`the ${recordResource} is not a valid signing record; run account setup again to replace it`);
  }
  return { kind: "secrets-store", tokenId, storeId };
}

/** The stored record; undefined when the record (or the state home) does not exist. Reads only. */
async function readSigningRecord(api: CloudflareApi, accountId: string): Promise<{ placement: SigningPlacement; current: boolean } | undefined> {
  const r = await api("GET", recordPath(accountId));
  if (r.status === 404) return undefined;
  if (r.status < 200 || r.status >= 300) throw new Error(`reading the ${recordResource} failed: ${describeFailure(r)}`);
  return { placement: parsePlacement(r.body), current: signingRecordIsCurrent(r.body) };
}

/** The account's signing credentials when the record holds them (not in Secrets Store); undefined without a record. Reads only. */
export async function readSigningCredentials(api: CloudflareApi, accountId: string): Promise<SigningCredentials | undefined> {
  const placement = (await readSigningRecord(api, accountId))?.placement;
  return placement?.kind === "worker-secrets" ? placement.credentials : undefined;
}

/** Where the deploy finds the credential; undefined when the record (or the state home) does not exist. Reads only. */
export async function readSigningPlacement(api: CloudflareApi, accountId: string): Promise<SigningPlacement | undefined> {
  return (await readSigningRecord(api, accountId))?.placement;
}

/**
 * The credential as a shared resource: owned when its record exists and its token denies every
 * account bucket; absent otherwise, so `setup-account` (re)creates it. Reads only.
 */
export async function signingCredentialState(api: CloudflareApi, accountId: string): Promise<"owned" | "absent"> {
  const record = await readSigningRecord(api, accountId);
  if (record?.current !== true) return "absent";
  if (record.placement.kind === "worker-secrets") return "owned";
  // Held in Secrets Store: both secrets must be there, tagged with this record's token (DEC-0729).
  const { tokenId, storeId } = record.placement;
  let stored: Awaited<ReturnType<typeof storedSecrets>>;
  try {
    stored = await storedSecrets(api, accountId, storeId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Only a refusal names the permission; another failure is reported as it is.
    if (/HTTP 40[13]/.test(detail)) throw new Error(`checking the ${SIGNING_RESOURCE} in Secrets Store needs "Secrets Store Read": ${detail}`);
    throw error;
  }
  return Object.values(SIGNING_SECRET_NAMES).every((name) => stored.get(name)?.comment === tokenId) ? "owned" : "absent";
}

/** Puts both S3 credentials into Secrets Store; the store's ID, or undefined when Secrets Store is unavailable (plan §10). */
/** Statuses of the store listing that mean Secrets Store is not available to this credential (not entitled, or not permitted). */
const STORE_REFUSED = new Set([401, 403, 404]);

/**
 * Puts both S3 credentials into Secrets Store (DEC-0729). Falls back (`unavailable`, with the
 * reason) only when the store listing is refused, before anything is written; any other failure
 * throws. `onWrite` is called before the first put, from which point the store may hold the new key.
 */
async function putInSecretsStore(api: CloudflareApi, accountId: string, credentials: SigningCredentials, onWrite: () => void): Promise<{ storeId: string } | { unavailable: string }> {
  const probe = await api("GET", `/accounts/${accountId}/secrets_store/stores?per_page=50`);
  if (STORE_REFUSED.has(probe.status)) return { unavailable: `Secrets Store refused the listing: ${describeFailure(probe)}` };
  if (!succeeded(probe)) throw new Error(`listing the account's Secrets Store stores failed: ${describeFailure(probe)}`);
  const storeId = await ensureStore(api, accountId);
  const existing = await storedSecrets(api, accountId, storeId);
  onWrite();
  for (const [field, name] of Object.entries(SIGNING_SECRET_NAMES) as [keyof typeof SIGNING_SECRET_NAMES, string][]) {
    await putSecret(api, accountId, storeId, name, credentials[field], existing.get(name)?.id, credentials.id);
  }
  return { storeId };
}

async function writeSigningRecord(api: CloudflareApi, accountId: string, credentials: SigningCredentials, storeId?: string): Promise<void> {
  const body =
    storeId === undefined
      ? { tokenId: credentials.id, accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, deniedBuckets: [...ACCOUNT_BUCKETS] }
      : { tokenId: credentials.id, accessKeyId: credentials.accessKeyId, deniedBuckets: [...ACCOUNT_BUCKETS], secretsStore: { storeId } };
  const r = await api("PUT", recordPath(accountId), body);
  if (r.status < 200 || r.status >= 300 || (r.body as { success?: unknown } | null)?.success === false) throw new Error(`writing the ${recordResource} failed: ${describeFailure(r)}`);
}

/**
 * `setup-account`: creates the account signing token and its record. A token of that name left
 * without a record (its value is shown only once), or one whose record predates an account bucket,
 * is replaced: the new token is created and its record written first, and only then are the old
 * ones deleted, so a failure on the way leaves the old key (the one every deployed stage holds)
 * working. `replaced`: the ids of the old tokens deleted; each deployed stage still holds the old
 * key in its Worker secrets until it is redeployed (a stage bound to Secrets Store reads the new key
 * at once).
 *
 * `secretsStore` (the admin app's account setup, DEC-0729): put the credentials into Secrets Store
 * and write the record naming the store; `where` says whether that worked or the record holds them
 * because Secrets Store refused access (`reason`). Any other Secrets Store failure throws. Once a
 * put may have reached the store, a failure keeps the new token (stages bound to the store may
 * already read its key) and every old one, and says to run account setup again.
 */
export async function createAccountSigningCredential(
  api: CloudflareApi,
  accountId: string,
  options: { readonly secretsStore?: boolean } = {},
): Promise<{ readonly replaced: readonly string[]; readonly where?: "secrets-store" | "record"; readonly reason?: string }> {
  const old = (await listTokens(api, accountId)).filter((x) => x.name === SIGNING_TOKEN_NAME);
  const credentials = await createSigningToken(api, accountId);
  let storeId: string | undefined;
  let reason: string | undefined;
  let written = false;
  try {
    if (options.secretsStore === true) {
      const put = await putInSecretsStore(api, accountId, credentials, () => (written = true));
      if ("storeId" in put) storeId = put.storeId;
      else reason = put.unavailable;
    }
    await writeSigningRecord(api, accountId, credentials, storeId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (written) {
      throw new Error(
        `Secrets Store may hold part of the new ${SIGNING_RESOURCE} (its key ID beside the old secret), but ${detail}; the new and the old tokens were kept: run account setup again; stages bound to the store cannot sign R2 transfers until then`,
      );
    }
    await deleteSigningToken(api, accountId, credentials.id).catch(() => undefined);
    throw error;
  }
  const replaced: string[] = [];
  for (const t of old.filter((x) => x.id !== credentials.id)) {
    try {
      await deleteSigningToken(api, accountId, t.id);
    } catch (error) {
      throw new Error(
        `the new ${SIGNING_RESOURCE} and its record are in place, but ${error instanceof Error ? error.message : String(error)}; ` +
          `delete the older token named ${SIGNING_TOKEN_NAME} (not the newest one) in the Cloudflare dashboard after redeploying every deployed stage`,
      );
    }
    replaced.push(t.id);
  }
  if (options.secretsStore !== true) return { replaced };
  return storeId === undefined ? { replaced, where: "record", ...(reason === undefined ? {} : { reason }) } : { replaced, where: "secrets-store" };
}

/** `setup-account`, before anything changes: the token permission by name when the credential lacks it. Reads only. */
export async function tokenWriteProblems(api: CloudflareApi, accountId: string): Promise<string[]> {
  let policies;
  try {
    policies = await tokenPolicies(api, accountId);
  } catch (error) {
    return [`${error instanceof Error ? error.message : String(error)} (creating the ${SIGNING_RESOURCE} needs "${TOKEN_WRITE_PERMISSION}"; use the setup token, DEC-0551)`];
  }
  const missing = missingPermissions(policies, [{ name: TOKEN_WRITE_PERMISSION, scope: "account" }], accountId, "");
  return missing.length === 0 ? [] : [`the Cloudflare API token lacks the permission "${TOKEN_WRITE_PERMISSION}" (account), which creating the ${SIGNING_RESOURCE} needs; run setup-account with the setup token (DEC-0551)`];
}

/**
 * A stage's legacy per-stage signing token (DEC-0100), by its exact name; undefined when there is
 * none, or when the credential may not list tokens (the everyday token, DEC-0551), so `remove` and
 * the stage listing work without the token permission.
 */
export async function findLegacySigningToken(api: CloudflareApi, accountId: string, stage: Stage): Promise<{ id: string } | undefined> {
  const tokens = await listTokens(api, accountId, { refusedIsNone: true });
  const found = tokens.find((t) => t.name === legacySigningTokenName(stage));
  return found ? { id: found.id } : undefined;
}
