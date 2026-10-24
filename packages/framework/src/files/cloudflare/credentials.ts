/**
 * The S3 credentials of a stage's R2 API token (DEC-0100), for provisioning: it creates the token
 * (`POST /accounts/<account>/tokens`), derives these once from the response, and stores them as
 * the framework-internal Worker secrets `frameworkR2AccessKeyId` / `frameworkR2SecretAccessKey`.
 * The token value is returned once by Cloudflare and must never be printed. Web Crypto only.
 */
import type { S3Credentials } from "../s3/sign.js";

/** The part of the token-creation result the credentials come from. */
export interface R2ApiToken {
  readonly id: string;
  readonly value: string;
}

/** Access key ID = token `id`; secret access key = lowercase hex SHA-256 of token `value`. */
export async function s3CredentialsFromToken(token: R2ApiToken): Promise<S3Credentials> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.value)));
  const secretAccessKey = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  return { accessKeyId: token.id, secretAccessKey };
}
