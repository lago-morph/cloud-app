/**
 * The runtime `SecretsService` (SEC-REQ-001, SEC-REQ-005). Workers-compatible (no Node APIs).
 */
import type { Target } from "../core/identity.js";
import { secretLocation } from "../config/secret-locations.js";
import { FrameworkError } from "../core/errors.js";
import { logFailure } from "../log/failures.js";
import type { LogService } from "../log/public.js";
import { FRAMEWORK_SECRETS, isReservedSecretName, type FrameworkSecretName } from "./names.js";
import type { SecretsService } from "./public.js";

/** Reads one secret by logical name; resolves `undefined` when the stage has no value. */
export type SecretReader = (name: string) => Promise<string | undefined>;

/** Local and Cloudflare: the value is the Worker env binding `SECRET_<NAME>` (SEC-REQ-003). */
export function envSecretReader(env: Readonly<Record<string, unknown>>, target: Target): SecretReader {
  return async (name) => {
    const value = env[secretLocation(target, name)];
    return typeof value === "string" ? value : undefined;
  };
}

export interface SecretsServiceOptions {
  readonly declared: readonly string[];
  readonly read: SecretReader;
  /** The request's log, for the LOG-REQ-005 entry of a `SEC.UNAVAILABLE` failure. */
  readonly log?: LogService;
}

/**
 * A store failure becomes `SEC.UNAVAILABLE` (SEC-REQ-005), logged once through `logFailure`. The
 * store's own error is not carried into the message or the log, so nothing it holds can leak.
 */
async function readOrUnavailable(options: Omit<SecretsServiceOptions, "declared">, name: string): Promise<string | undefined> {
  try {
    return await options.read(name);
  } catch (thrown) {
    if (thrown instanceof FrameworkError) throw thrown;
    const failure = new FrameworkError("SEC.UNAVAILABLE", `secret ${JSON.stringify(name)} could not be read: the secret store is unavailable`);
    if (options.log !== undefined) logFailure(options.log, failure);
    throw failure;
  }
}

/** The app's service: only declared names outside the reserved `framework` prefix are readable. */
export function createSecretsService<S extends string>(options: SecretsServiceOptions): SecretsService<S> {
  const declared = options.declared.filter((name) => !isReservedSecretName(name));
  return serviceOver<S>(new Set(declared), "is not declared by the app", options);
}

/** Framework code's reader of its internal secrets (secrets.md §2); app names are refused. */
export function createFrameworkSecrets(options: Omit<SecretsServiceOptions, "declared">): SecretsService<FrameworkSecretName> {
  return serviceOver<FrameworkSecretName>(new Set(Object.values(FRAMEWORK_SECRETS)), "is not a framework-internal secret", options);
}

function serviceOver<S extends string>(readable: ReadonlySet<string>, refusal: string, options: Omit<SecretsServiceOptions, "declared">): SecretsService<S> {
  // SEC-REQ-005: one service per request, so values found here are reused within that request only.
  const values = new Map<string, string>();
  return {
    async get(name: S): Promise<string> {
      if (!readable.has(name)) {
        throw new FrameworkError("SEC.UNDECLARED", `secret ${JSON.stringify(name)} ${refusal}`);
      }
      const known = values.get(name);
      if (known !== undefined) return known;
      const value = await readOrUnavailable(options, name);
      if (value === undefined || value === "") {
        throw new FrameworkError("SEC.MISSING", `secret ${JSON.stringify(name)} has no value in this stage`);
      }
      values.set(name, value);
      return value;
    },
  };
}
