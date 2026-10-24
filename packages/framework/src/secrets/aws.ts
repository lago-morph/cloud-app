/**
 * The AWS secret reader (SEC-REQ-003, SEC-REQ-005; secrets.md §2 "AWS"): secret `<name>` is
 * the SSM SecureString parameter `/<app>/<stage>/secrets/<name>` (`secretLocation`, G-01), read
 * with `GetParameter` and decryption using the Lambda role.
 *
 * - `ParameterNotFound`, or a parameter without a value, resolves `undefined`, which
 *   `createSecretsService` reports as `SEC.MISSING`.
 * - Any other failure rejects with a plain error naming only the SDK error's name, which the
 *   service turns into `SEC.UNAVAILABLE` and logs once (DEC-0157). The store's own message is
 *   never carried, so nothing it holds can leak (SEC-REQ-002).
 * - Nothing is cached here: every call is one `GetParameter` (SEC-REQ-005, SEC-AC-005). The
 *   per-request reuse of a found value is the service's, which lives for one request only.
 *
 * The client is created once per cold start (`createSsmClient`, aws.md §2) and shared by every
 * request's reader. App and framework-internal secrets use the same path.
 */
import { GetParameterCommand, SSMClient, type GetParameterCommandOutput } from "@aws-sdk/client-ssm";
import { secretLocation, type SecretScope } from "../config/secret-locations.js";
import { proxyAwareHandler, type Environment } from "../targets/aws/sdk.js";
import type { SecretReader } from "./service.js";

/** The SSM client of one Lambda environment, in its region, with the shared request handler. */
export function createSsmClient(env: Environment, region: string): SSMClient {
  return new SSMClient({ region, requestHandler: proxyAwareHandler(env) });
}

function errorName(thrown: unknown): string {
  if (typeof thrown === "object" && thrown !== null) {
    const name = (thrown as { name?: unknown }).name;
    if (typeof name === "string" && name !== "") return name;
  }
  return "an unknown error";
}

/** Reads the stage's secrets from SSM; no value is remembered between calls. */
export function ssmSecretReader(client: Pick<SSMClient, "send">, scope: SecretScope): SecretReader {
  return async (name) => {
    const command = new GetParameterCommand({ Name: secretLocation("aws", name, scope), WithDecryption: true });
    let output: GetParameterCommandOutput;
    try {
      output = await client.send(command);
    } catch (thrown) {
      // Matched by name, not class: a bundled entry may hold another copy of the SDK's classes.
      if (errorName(thrown) === "ParameterNotFound") return undefined;
      throw new Error(`SSM GetParameter failed with ${errorName(thrown)}`);
    }
    const value = output.Parameter?.Value;
    return typeof value === "string" && value !== "" ? value : undefined;
  };
}
