/**
 * The AWS operations of the cloud commands (G-11; DEC-0492): G-10's `createAwsTarget`
 * on G-07's account, built from the process environment.
 *
 * **Child environment.** Every AWS client and every child process the target starts (SST, which
 * runs Pulumi and the Go AWS provider) gets `awsChildEnvironment(env)`:
 * - `SSL_CERT_FILE` from `NODE_EXTRA_CA_CERTS` when the owner has not set it. Node reads
 *   `NODE_EXTRA_CA_CERTS`; Go programs (SST's CLI, Pulumi, `pulumi-resource-aws`) do not, and
 *   read `SSL_CERT_FILE` instead. Behind a TLS-intercepting proxy, the proxy's CA is then
 *   trusted by both.
 * - `HTTPS_PROXY` and `https_proxy` both set to the proxy when either is, and the same for
 *   `NO_PROXY`/`no_proxy`, so Go's and Node's proxy lookups agree.
 * SST's own settings (`AWS_REGION`, `NODE_USE_ENV_PROXY=1`, telemetry off) are added on top by
 * `sstEnvironment` (`provision/aws/environment.ts`). The SDK clients get the proxy-aware handler
 * of `targets/aws/sdk.ts` with this environment as its `proxyEnv` (`createAwsClients`,
 * `createAwsStageClients`).
 */
import { awsAccount as defaultAwsAccount, type AwsAccountOptions, type AwsAccount } from "../../provision/aws/account.js";
import { missingCredentials, type Environment } from "../../provision/aws/environment.js";
import type { FunctionCode } from "../../provision/aws/sst.js";
import { createAwsTarget as defaultCreateAwsTarget, type AwsTargetOptions } from "../../provision/aws/target.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import type { OperationsFactory, OperationsInput, OperationsOptions } from "./operations.js";

const nonEmpty = (value: string | undefined): value is string => value !== undefined && value !== "";

/** Sets `upper` and `lower` to the first of them that is set; leaves both unset otherwise. */
function pair(out: Record<string, string | undefined>, upper: string, lower: string): void {
  const value = nonEmpty(out[upper]) ? out[upper] : out[lower];
  if (!nonEmpty(value)) return;
  out[upper] = value;
  out[lower] = value;
}

/** The environment of the AWS clients and of SST, Pulumi and the Go providers (see the module comment). */
export function awsChildEnvironment(env: Environment): Environment {
  const out: Record<string, string | undefined> = { ...env };
  if (nonEmpty(env.NODE_EXTRA_CA_CERTS) && !nonEmpty(env.SSL_CERT_FILE)) out.SSL_CERT_FILE = env.NODE_EXTRA_CA_CERTS;
  pair(out, "HTTPS_PROXY", "https_proxy");
  pair(out, "NO_PROXY", "no_proxy");
  return out;
}

/** Injection points for unit tests (default: the real G-07 account and G-10 target). */
export interface AwsOperationsDeps {
  readonly account?: (options: AwsAccountOptions) => AwsAccount;
  readonly createTarget?: (options: AwsTargetOptions) => TargetOperations;
}

/** `awsOperations` with its account and target factories injected. */
export function awsOperationsWith(deps: AwsOperationsDeps): OperationsFactory {
  const makeAccount = deps.account ?? defaultAwsAccount;
  const makeTarget = deps.createTarget ?? defaultCreateAwsTarget;
  return (options: OperationsOptions) =>
    ({ appDir, target, code, region }: OperationsInput) => {
      if (target !== "aws") throw new Error(`awsOperations builds only AWS's operations, not target ${target}'s`);
      const env = awsChildEnvironment(options.env);
      if (options.requireCredentials) {
        const missing = missingCredentials(env);
        if (missing.length > 0) throw new Error(`missing AWS credentials: ${missing.join(", ")} (set them in the environment, or name a profile with AWS_PROFILE; values are never printed)`);
      }
      const account = makeAccount({ env, ...(region === undefined ? {} : { region }) });
      return makeTarget({
        env,
        appDir,
        account,
        ...(code === undefined ? {} : { code: code as FunctionCode }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
    };
}

/** The AWS target's PROV operations from the process environment. */
export const awsOperations: OperationsFactory = awsOperationsWith({});
