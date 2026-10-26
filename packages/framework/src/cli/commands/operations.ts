/**
 * The cloud commands' PROV operations, one factory per cloud target (D-05; DEC-0492). `deploy`, `remove`, `setup-account`, `secrets set` and the compliance
 * harness's leftover check all take their target's operations from `targetOperations`, which
 * dispatches on `--target` to the target's own factory:
 * - `cloudflare`: `cloudflareOperations` (D-03 with D-04's databases and D-02's CORS parts),
 *   unchanged from D-05.
 * Release 1 has the one cloud target; the AWS factory is deferred to a later release (DEC-0508,
 * branch `aws`). A target never falls through to another target's factory.
 */
import type { Target } from "../../core/identity.js";
import { bucketCorsPolicy, checkStorageCors } from "../../files/cloudflare/cors.js";
import { createCloudflareApi, createCloudflareBytesApi } from "../../provision/cloudflare/api.js";
import { fetchTransfer } from "../../provision/cloudflare/d1/native-copy.js";
import { workersPlanReader } from "../../provision/cloudflare/plan.js";
import { d1DatabaseOperations } from "../../provision/cloudflare/d1/operations.js";
import { missingCredentials } from "../../provision/cloudflare/environment.js";
import type { WorkerCode } from "../../provision/cloudflare/sst.js";
import { createCloudflareTarget } from "../../provision/cloudflare/target.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import type { ProcessEnvironment } from "./smoke-cloud.js";

export interface OperationsOptions {
  readonly env: ProcessEnvironment;
  /** Default the global `fetch` (the process runs with `NODE_USE_ENV_PROXY=1` behind a proxy). */
  readonly fetch?: typeof fetch;
  /**
   * Refuse, naming them, when credential variables are missing (remove, setup-account, secrets).
   * `deploy` leaves it off: its step 1 reports every missing prerequisite itself.
   */
  readonly requireCredentials: boolean;
}

/** What a command knows when it asks for its target's operations. */
export interface OperationsInput {
  readonly appDir: string;
  readonly target: Target;
  /** `deploy` only: the built code, as the target's `prepare` made it. */
  readonly code?: unknown;
}

/** Builds the operations of one command run. */
export type StageOperations = (input: OperationsInput) => TargetOperations;

/** One target's factory: the process-wide options first, then the command's input. */
export type OperationsFactory = (options: OperationsOptions) => StageOperations;

export type CloudTarget = Exclude<Target, "local">;

/** The cloud target's PROV operations from the process environment (Cloudflare: D-03 with D-04's databases and D-02's CORS parts). */
export const cloudflareOperations: OperationsFactory =
  (options) =>
  ({ appDir, target, code }) => {
    if (target !== "cloudflare") throw new Error(`cloudflareOperations builds only Cloudflare's operations, not target ${target}'s`);
    const env = options.env;
    if (options.requireCredentials) {
      const missing = missingCredentials(env);
      if (missing.length > 0) throw new Error(`missing Cloudflare credentials: ${missing.join(", ")} (set them in the environment or in .env.cloudflare; values are never printed)`);
    }
    const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
    const withFetch = options.fetch === undefined ? {} : { fetch: options.fetch };
    const api = createCloudflareApi({ token: env.CLOUDFLARE_API_TOKEN ?? "", ...withFetch });
    return createCloudflareTarget({
      api,
      bytes: createCloudflareBytesApi({ token: env.CLOUDFLARE_API_TOKEN ?? "", ...withFetch }),
      accountId,
      env,
      appDir,
      databases: d1DatabaseOperations({
        api,
        accountId,
        native: { transfer: fetchTransfer(options.fetch) },
        plan: workersPlanReader(api, accountId, env),
      }),
      files: {
        bucketCors: (origin) => bucketCorsPolicy(origin),
        storagePreflight: ({ accountId: account, bucket, origin }) => checkStorageCors({ accountId: account, bucket, publicOrigin: origin, ...withFetch }),
      },
      ...(code === undefined ? {} : { code: code as WorkerCode }),
      ...withFetch,
    });
  };

/** The registration point: each cloud target's factory. */
export const OPERATIONS_FACTORIES: Readonly<Record<CloudTarget, OperationsFactory>> = Object.freeze({
  cloudflare: cloudflareOperations,
});

/** The operations of `--target` from its own factory; `local` has none. */
export function targetOperations(options: OperationsOptions, factories: Readonly<Record<CloudTarget, OperationsFactory>> = OPERATIONS_FACTORIES): StageOperations {
  return (input) => {
    if (input.target === "local") throw new Error("there are no provisioning operations for target local");
    const factory = Object.hasOwn(factories, input.target) ? factories[input.target] : undefined;
    if (factory === undefined) throw new Error(`there are no provisioning operations for target ${String(input.target)}`);
    return factory(options)(input);
  };
}
