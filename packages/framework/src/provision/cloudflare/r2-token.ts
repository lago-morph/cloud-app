/**
 * The stage's R2 signing token (DEC-0100; cloudflare.md `remove`; PROV-REQ-002 step 1): an
 * account API token with the permission group "Workers R2 Storage Bucket Item Write" on the
 * stage bucket only, named `<app>-<stage>-files-signing`. Its S3 credentials are access key
 * ID = token id and secret access key = lowercase hex SHA-256 of the token value, which
 * Cloudflare returns once; they go only into the stage's framework-internal Worker secrets.
 * Messages never contain the value.
 *
 * Preflight cannot ask Cloudflare "may I create a token?" without creating one, so it checks
 * that the credential can read the token permission groups and the account's tokens, the reads
 * creation itself needs; a refusal names the permission (DEC-PENDING-D-03-5).
 */
import { createHash } from "node:crypto";
import type { Stage } from "../core/operations.js";
import { describeFailure, resultOf, succeeded, type CloudflareApi } from "./api.js";
import { filesBucketName, signingTokenName } from "./names.js";

export const ITEM_WRITE_PERMISSION = "Workers R2 Storage Bucket Item Write";

/** How the missing permission is named to the owner. */
const TOKEN_PERMISSION = "the permission to create R2 API tokens (Account API Tokens: Edit)";

export interface SigningCredentials {
  /** The token's id (its identifier for removal). */
  readonly id: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const tokensPath = (accountId: string) => `/accounts/${accountId}/tokens`;

async function itemWriteGroupId(api: CloudflareApi, accountId: string): Promise<string> {
  const groups = resultOf<{ id: string; name: string }[]>(await api("GET", `${tokensPath(accountId)}/permission_groups`), "reading the API token permission groups");
  const group = groups.find((g) => g.name === ITEM_WRITE_PERMISSION);
  if (!group) throw new Error(`the API token permission group "${ITEM_WRITE_PERMISSION}" was not found on this account`);
  return group.id;
}

export async function createSigningToken(api: CloudflareApi, accountId: string, stage: Stage): Promise<SigningCredentials> {
  const groupId = await itemWriteGroupId(api, accountId);
  const name = signingTokenName(stage);
  const r = await api("POST", tokensPath(accountId), {
    name,
    policies: [
      {
        effect: "allow",
        permission_groups: [{ id: groupId }],
        resources: { [`com.cloudflare.edge.r2.bucket.${accountId}_default_${filesBucketName(stage)}`]: "*" },
      },
    ],
  });
  const token = resultOf<{ id?: unknown; value?: unknown }>(r, `creating the R2 signing token ${name}`);
  if (typeof token.id !== "string" || typeof token.value !== "string") throw new Error(`creating the R2 signing token ${name}: Cloudflare returned no token id or value`);
  return { id: token.id, accessKeyId: token.id, secretAccessKey: createHash("sha256").update(token.value).digest("hex") };
}

async function listTokens(api: CloudflareApi, accountId: string): Promise<{ id: string; name: string }[]> {
  const tokens: { id: string; name: string }[] = [];
  for (let page = 1; ; page++) {
    const r = await api("GET", `${tokensPath(accountId)}?per_page=50&page=${page}`);
    tokens.push(...resultOf<{ id: string; name: string }[]>(r, "listing the account's API tokens"));
    const info = (r.body as { result_info?: { total_pages?: unknown } }).result_info;
    if (typeof info?.total_pages !== "number" || page >= info.total_pages) return tokens;
  }
}

/** The stage's token by its exact name, if it exists. */
export async function findSigningToken(api: CloudflareApi, accountId: string, stage: Stage): Promise<{ id: string } | undefined> {
  const found = (await listTokens(api, accountId)).find((t) => t.name === signingTokenName(stage));
  return found ? { id: found.id } : undefined;
}

export async function deleteSigningToken(api: CloudflareApi, accountId: string, id: string): Promise<void> {
  const r = await api("DELETE", `${tokensPath(accountId)}/${id}`);
  if (succeeded(r) || r.status === 404) return;
  throw new Error(`deleting R2 API token ${id} failed: ${describeFailure(r)}`);
}

/** Preflight: the token permission by name when the credential lacks it; reads only. */
export async function tokenCreationProblems(api: CloudflareApi, accountId: string): Promise<string[]> {
  for (const path of [`${tokensPath(accountId)}/permission_groups`, `${tokensPath(accountId)}?per_page=50&page=1`]) {
    const r = await api("GET", path);
    if (!succeeded(r)) return [`the Cloudflare API token lacks ${TOKEN_PERMISSION}: ${describeFailure(r)}`];
  }
  return [];
}
