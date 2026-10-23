/**
 * Read-only access to account-level R2 buckets for the cloud test hooks (plan item D-T2): the
 * shared log bucket `prototype-logs` (LOG-REQ-004) and the provisioning state home `sst-state`
 * (DEC-0084).
 *
 * How (plan §5 D-T2 "R2 log listing with a read-only R2 token created and deleted by the test"):
 * - The hook creates one account API token with only "Workers R2 Storage Bucket Item Read" on
 *   those two buckets (the DEC-0100 mechanism, read instead of write), with a 30-minute expiry
 *   as a backstop, and deletes it when the process ends (or when `disposeR2Reader()` is called).
 *   Before creating one it deletes this hook's own expired or older-than-an-hour tokens (name
 *   prefix `compliance-r2read-`), so an interrupted process leaves none behind for long.
 * - S3 credentials as DEC-0100: access key ID = token ID, secret access key = SHA-256 (hex) of
 *   the token value. The value is held in memory only, never printed or written.
 * - Listing and reading use R2's S3 endpoint `<account>.r2.cloudflarestorage.com` with SigV4
 *   (path style, region `auto`), not the Cloudflare REST API, so polling a log key costs no
 *   Cloudflare API requests (plan §1 caps). Each process makes 4–5 API requests for the token
 *   (sweep listing, permission group lookup, create, delete, plus one per stale token deleted).
 *
 * Listings are bounded (`MAX_PAGES` pages of 1,000 keys); more is an error, never a silent cut.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { CLOUD_WAITS, USER_AGENT, waitFor } from "../../harness/index.js";
import { accountId, cfApi, cfList, cfOk, failure } from "./api.js";

export const LOG_BUCKET = "prototype-logs";
export const STATE_BUCKET = "sst-state";
const READ_PERMISSION = "Workers R2 Storage Bucket Item Read";
const TOKEN_PREFIX = "compliance-r2read-";
const TOKEN_LIFETIME_MS = 30 * 60_000;
const STALE_AFTER_MS = 60 * 60_000;
const MAX_PAGES = 20;

interface Credentials {
  readonly tokenId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

let current: Promise<Credentials> | undefined;
let exitHookInstalled = false;

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* unencoded). */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** An S3 path: each segment encoded, `/` kept. */
export function s3Path(bucket: string, key?: string): string {
  return `/${rfc3986(bucket)}${key === undefined ? "" : `/${key.split("/").map(rfc3986).join("/")}`}`;
}

/**
 * SigV4 header signing of one S3 GET (service `s3`, region `auto`), exported for its offline
 * unit check against a reference signer. Returns the headers to send.
 */
export function signS3Get(input: { readonly host: string; readonly path: string; readonly query: Readonly<Record<string, string>>; readonly accessKeyId: string; readonly secretAccessKey: string; readonly now: Date }): Record<string, string> {
  const amzDate = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256("");
  const query = Object.keys(input.query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(input.query[k] ?? "")}`)
    .join("&");
  const headers: Record<string, string> = { host: input.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers).sort();
  const canonical = ["GET", input.path, query, names.map((n) => `${n}:${headers[n] ?? ""}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign, "utf8").digest("hex");
  return {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

interface TokenInfo {
  readonly id: string;
  readonly name?: string;
  readonly expires_on?: string;
  readonly issued_on?: string;
}

/** Deletes this hook's own tokens that expired or are older than an hour (an interrupted process's). */
async function sweepStaleTokens(account: string): Promise<void> {
  const tokens = await cfList<TokenInfo>("listing the account's API tokens", `/accounts/${account}/tokens`, 50);
  const now = Date.now();
  for (const t of tokens) {
    if (!(t.name ?? "").startsWith(TOKEN_PREFIX)) continue;
    const expired = t.expires_on !== undefined && Date.parse(t.expires_on) <= now;
    const old = t.issued_on !== undefined && now - Date.parse(t.issued_on) > STALE_AFTER_MS;
    if (expired || old) await cfApi("DELETE", `/accounts/${account}/tokens/${t.id}`);
  }
}

async function readPermissionGroupId(account: string): Promise<string> {
  const filtered = await cfApi<readonly { id: string; name: string }[]>("GET", `/accounts/${account}/tokens/permission_groups?name=${encodeURIComponent(READ_PERMISSION)}`);
  const hit = filtered.body?.success === true ? filtered.body.result.find((g) => g.name === READ_PERMISSION) : undefined;
  if (hit !== undefined) return hit.id;
  const all = await cfOk<readonly { id: string; name: string }[]>("listing token permission groups", "GET", `/accounts/${account}/tokens/permission_groups`);
  const group = all.find((g) => g.name === READ_PERMISSION);
  if (group === undefined) throw new Error(`no token permission group named "${READ_PERMISSION}"`);
  return group.id;
}

async function createReader(): Promise<Credentials> {
  const account = accountId();
  await sweepStaleTokens(account);
  const groupId = await readPermissionGroupId(account);
  const resources = Object.fromEntries([LOG_BUCKET, STATE_BUCKET].map((b) => [`com.cloudflare.edge.r2.bucket.${account}_default_${b}`, "*"]));
  const expiresOn = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  const r = await cfApi<{ id: string; value: string }>("POST", `/accounts/${account}/tokens`, {
    name: `${TOKEN_PREFIX}${randomBytes(6).toString("hex")}`,
    policies: [{ effect: "allow", permission_groups: [{ id: groupId }], resources }],
    expires_on: expiresOn,
  });
  if (r.status !== 200 || r.body === undefined || !r.body.success) throw failure("creating the read-only R2 token", r);
  const created = { tokenId: r.body.result.id, accessKeyId: r.body.result.id, secretAccessKey: sha256(r.body.result.value) };
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // Deletes the token when the process has nothing else to do (async work is allowed in beforeExit).
    process.once("beforeExit", () => void disposeR2Reader());
  }
  return created;
}

function reader(): Promise<Credentials> {
  current ??= createReader().catch((error: unknown) => {
    current = undefined;
    throw error;
  });
  return current;
}

/** Deletes the read-only token of this process, if one was created. Idempotent. */
export async function disposeR2Reader(): Promise<void> {
  const pending = current;
  current = undefined;
  if (pending === undefined) return;
  let creds: Credentials;
  try {
    creds = await pending;
  } catch {
    return;
  }
  const r = await cfApi("DELETE", `/accounts/${accountId()}/tokens/${creds.tokenId}`);
  if (r.status !== 200 && r.status !== 404) throw failure("deleting the read-only R2 token", r);
}

function host(): string {
  return `${accountId()}.r2.cloudflarestorage.com`;
}

async function s3Get(path: string, query: Readonly<Record<string, string>>): Promise<{ status: number; text: string }> {
  const creds = await reader();
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k] ?? "")}`)
    .join("&");
  const send = async (): Promise<{ status: number; text: string }> => {
    const headers = signS3Get({ host: host(), path, query, accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, now: new Date() });
    const response = await fetch(`https://${host()}${path}${qs === "" ? "" : `?${qs}`}`, { headers: { ...headers, "user-agent": USER_AGENT }, signal: AbortSignal.timeout(CLOUD_WAITS.requestMs) });
    return { status: response.status, text: await response.text() };
  };
  // A new token is usually usable at once (DEC-0100); allow a bounded propagation wait on 401/403.
  return waitFor(async () => {
    const r = await send();
    if (r.status === 401 || r.status === 403) throw new Error(`R2 answered HTTP ${String(r.status)} to the read-only token`);
    return r;
  }, { what: `R2 GET ${path}`, timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 2_000 });
}

function xmlDecode(text: string): string {
  return text.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    if (e === "amp") return "&";
    return String.fromCodePoint(e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

export interface ObjectInfo {
  readonly key: string;
  readonly etag: string;
  readonly lastModified: string;
  readonly size: number;
}

/** Every key in `bucket` starting with `prefix` (S3 ListObjectsV2), sorted; bounded. */
export async function listKeys(bucket: string, prefix: string): Promise<string[]> {
  return (await listObjects(bucket, prefix)).map((o) => o.key);
}

/** Every object in `bucket` starting with `prefix`, with its ETag, last-modified time and size, sorted by key; bounded. */
export async function listObjects(bucket: string, prefix: string): Promise<ObjectInfo[]> {
  const objects: ObjectInfo[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: Record<string, string> = { "list-type": "2", prefix, "max-keys": "1000", ...(token === undefined ? {} : { "continuation-token": token }) };
    const r = await s3Get(s3Path(bucket), query);
    if (r.status !== 200) throw new Error(`listing R2 bucket ${bucket} (prefix ${prefix}) failed: HTTP ${String(r.status)} ${/<Code>([^<]*)<\/Code>/.exec(r.text)?.[1] ?? ""}`.trim());
    for (const m of r.text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const body = m[1] ?? "";
      const field = (name: string): string => xmlDecode(new RegExp(`<${name}>([^<]*)</${name}>`).exec(body)?.[1] ?? "");
      objects.push({ key: field("Key"), etag: field("ETag"), lastModified: field("LastModified"), size: Number(field("Size")) });
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(r.text)) return objects.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    token = xmlDecode(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(r.text)?.[1] ?? "");
    if (token === "") throw new Error(`listing R2 bucket ${bucket}: truncated listing without a continuation token`);
  }
  throw new Error(`listing R2 bucket ${bucket} (prefix ${prefix}): more than ${String(MAX_PAGES * 1000)} keys; the hook does not list further`);
}

/** The body of one object of `bucket` as UTF-8 text. */
export async function readObject(bucket: string, key: string): Promise<string> {
  const r = await s3Get(s3Path(bucket, key), {});
  if (r.status !== 200) throw new Error(`reading R2 object ${bucket}/${key} failed: HTTP ${String(r.status)}`);
  return r.text;
}

/** Whether an account-level bucket exists (Cloudflare API: 200 → yes, 404 → no; anything else is an error). */
export async function bucketExists(bucket: string): Promise<boolean> {
  const r = await cfApi("GET", `/accounts/${accountId()}/r2/buckets/${encodeURIComponent(bucket)}`);
  if (r.status === 404) return false;
  if (r.status === 200 && r.body?.success === true) return true;
  throw failure(`reading R2 bucket ${bucket}`, r);
}
