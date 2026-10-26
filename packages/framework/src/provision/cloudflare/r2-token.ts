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
 * Stages deployed before DEC-0550 have a per-stage token `<app>-<stage>-files-signing`
 * (`legacySigningTokenName`). Their next deploy switches them to the account credential; `remove`
 * deletes the legacy token when the credential may list tokens, and otherwise leaves it (it is
 * scoped to the deleted stage bucket only).
 */
import { createHash } from "node:crypto";
import type { Stage } from "../core/operations.js";
import { describeFailure, resultOf, succeeded, type CloudflareApi } from "./api.js";
import { missingPermissions, tokenPolicies } from "./email-permissions.js";
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

export async function deleteSigningToken(api: CloudflareApi, accountId: string, id: string): Promise<void> {
  const r = await api("DELETE", `${tokensPath(accountId)}/${id}`);
  if (succeeded(r) || r.status === 404) return;
  throw new Error(`deleting R2 API token ${id} failed: ${describeFailure(r)}`);
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

/** The stored record; undefined when the record (or the state home) does not exist. Reads only. */
async function readSigningRecord(api: CloudflareApi, accountId: string): Promise<{ credentials: SigningCredentials; current: boolean } | undefined> {
  const r = await api("GET", recordPath(accountId));
  if (r.status === 404) return undefined;
  if (r.status < 200 || r.status >= 300) throw new Error(`reading the ${recordResource} failed: ${describeFailure(r)}`);
  return { credentials: parseSigningRecord(r.body), current: signingRecordIsCurrent(r.body) };
}

/** The account's signing credentials; undefined when the record (or the state home) does not exist. Reads only. */
export async function readSigningCredentials(api: CloudflareApi, accountId: string): Promise<SigningCredentials | undefined> {
  return (await readSigningRecord(api, accountId))?.credentials;
}

/**
 * The credential as a shared resource: owned when its record exists and its token denies every
 * account bucket; absent otherwise, so `setup-account` (re)creates it. Reads only.
 */
export async function signingCredentialState(api: CloudflareApi, accountId: string): Promise<"owned" | "absent"> {
  return (await readSigningRecord(api, accountId))?.current === true ? "owned" : "absent";
}

async function writeSigningRecord(api: CloudflareApi, accountId: string, credentials: SigningCredentials): Promise<void> {
  const r = await api("PUT", recordPath(accountId), { tokenId: credentials.id, accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, deniedBuckets: [...ACCOUNT_BUCKETS] });
  if (r.status < 200 || r.status >= 300 || (r.body as { success?: unknown } | null)?.success === false) throw new Error(`writing the ${recordResource} failed: ${describeFailure(r)}`);
}

/**
 * `setup-account`: creates the account signing token and its record. A token of that name left
 * without a record (its value is shown only once), or one whose record predates an account bucket,
 * is replaced: the new token is created and its record written first, and only then are the old
 * ones deleted, so a failure on the way leaves the old key (the one every deployed stage holds)
 * working. `replaced`: the ids of the old tokens deleted; each deployed stage still holds the old
 * key in its Worker secrets until it is redeployed.
 */
export async function createAccountSigningCredential(api: CloudflareApi, accountId: string): Promise<{ readonly replaced: readonly string[] }> {
  const old = (await listTokens(api, accountId)).filter((x) => x.name === SIGNING_TOKEN_NAME);
  const credentials = await createSigningToken(api, accountId);
  try {
    await writeSigningRecord(api, accountId, credentials);
  } catch (error) {
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
          `delete the old token ${t.id} named ${SIGNING_TOKEN_NAME} in the Cloudflare dashboard after redeploying every deployed stage`,
      );
    }
    replaced.push(t.id);
  }
  return { replaced };
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
