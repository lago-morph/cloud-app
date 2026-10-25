/**
 * The environment the driver passes to the test processes, and how tests read it. Tests never
 * branch on the target except where a criterion states a per-target expectation
 * (COMPL-REQ-001); they use `baseUrl` and the harness helpers.
 */
import type { ReleaseTarget } from "./catalogue.js";
import { USER_AGENT } from "./http.js";

export const ENV = {
  target: "COMPLIANCE_TARGET",
  stage: "COMPLIANCE_STAGE",
  baseUrl: "COMPLIANCE_BASE_URL",
  runId: "COMPLIANCE_RUN_ID",
  /**
   * The run's tier, `automated` or `milestone` (DEC-0560): a clause that changes shared account
   * state runs only in a milestone pass, so a test can tell which pass it is in.
   */
  mode: "COMPLIANCE_RUN_MODE",
  /**
   * The value the driver set for the reference app's test secret `apiKey` on a cloud run stage
   * (DEC-0277; read by `testSecretValue()` in `criteria/core/support/stores.ts`).
   */
  testSecret: "COMPLIANCE_SECRET_API_KEY",
} as const;

export interface TargetEnv {
  readonly target: ReleaseTarget;
  readonly stage?: string;
  /** Base URL of the reference app on this target; throws when the driver did not set one. */
  readonly baseUrl: string;
  readonly runId?: string;
  /** The run's tier; `automated` when the driver did not say (a run outside the driver). */
  readonly mode: "automated" | "milestone";
}

type Env = Readonly<Record<string, string | undefined>>;

export function readTargetEnv(env: Env = process.env): TargetEnv {
  const target = env[ENV.target] ?? "local";
  if (target !== "local" && target !== "cloudflare") throw new Error(`${ENV.target}=${target} is not one of local, cloudflare (AWS is deferred to a later release, DEC-0508)`);
  const stage = env[ENV.stage];
  const runId = env[ENV.runId];
  const baseUrl = env[ENV.baseUrl];
  const mode = env[ENV.mode] === "milestone" ? "milestone" : "automated";
  return {
    target,
    mode,
    ...(stage === undefined ? {} : { stage }),
    ...(runId === undefined ? {} : { runId }),
    get baseUrl(): string {
      if (baseUrl === undefined || baseUrl === "") {
        throw new Error(`${ENV.baseUrl} is not set: run the tests through \`npm run compliance -- --target <t>\`, which starts or deploys the reference app and sets it`);
      }
      return baseUrl;
    },
  };
}

/** The environment for a test process: the parent's, plus the target variables. */
export function childEnv(base: Env, t: { readonly target: ReleaseTarget; readonly stage?: string; readonly baseUrl?: string; readonly runId: string; readonly testSecret?: string; readonly mode?: "automated" | "milestone" }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) out[k] = v;
  out[ENV.target] = t.target;
  out[ENV.runId] = t.runId;
  if (t.mode !== undefined) out[ENV.mode] = t.mode;
  if (t.stage !== undefined) out[ENV.stage] = t.stage;
  if (t.baseUrl !== undefined) out[ENV.baseUrl] = t.baseUrl;
  if (t.testSecret !== undefined) out[ENV.testSecret] = t.testSecret;
  if (t.target !== "local") out.NODE_USE_ENV_PROXY = "1";
  return out;
}

/** Playwright `use` options for compliance specs: the base URL and the explicit User-Agent. */
export function browserOptions(env: Env = process.env): { baseURL?: string; userAgent: string } {
  const baseUrl = env[ENV.baseUrl];
  return { ...(baseUrl === undefined || baseUrl === "" ? {} : { baseURL: baseUrl }), userAgent: USER_AGENT };
}
