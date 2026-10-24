/**
 * Deployment identity (CORE-REQ-003, core.md §2 "Deployment identity").
 *
 * The build (CLI) calls `createDeployment` with the app definition's name, the stage, and
 * the target, and embeds the result in the generated entry point. The target and the
 * test-stage flag are framework-internal; app code sees only `appIdentity(...)`.
 */
import { FrameworkError } from "./errors.js";
import type { DeploymentIdentity } from "./public.js";

/** PAR-290: maximum app name length. */
export const APP_NAME_MAX_LENGTH = 20;
/** PAR-291: maximum stage name length. */
export const STAGE_NAME_MAX_LENGTH = 20;

/** Every supported target (CORE-REQ-005: one `./targets/<target>` subpath each). */
export type Target = "local" | "cloudflare" | "aws";

/** The full, framework-internal identity of one deployment. Fixed by the build. */
export interface Deployment {
  readonly app: string;
  readonly stage: string;
  readonly target: Target;
  /** True exactly when the stage name starts with `test-` (PROV-REQ-005). */
  readonly isTestStage: boolean;
}

const APP_NAME = new RegExp(`^[a-z0-9]{1,${APP_NAME_MAX_LENGTH}}$`);
const STAGE_NAME = new RegExp(`^[a-z0-9-]{1,${STAGE_NAME_MAX_LENGTH}}$`);

export const APP_NAME_RULE = `app names use lowercase letters and digits only, no hyphens, 1 to ${APP_NAME_MAX_LENGTH} characters (PAR-290)`;
export const STAGE_NAME_RULE = `stage names use lowercase letters, digits, and hyphens, 1 to ${STAGE_NAME_MAX_LENGTH} characters (PAR-291)`;

/** Throws CORE.MISCONFIGURED naming the app-name rule unless `app` satisfies it. */
export function checkAppName(app: string): void {
  if (!APP_NAME.test(app)) {
    throw new FrameworkError("CORE.MISCONFIGURED", `app name ${JSON.stringify(app)} breaks the app-name rule: ${APP_NAME_RULE}`);
  }
}

/** Throws CORE.MISCONFIGURED naming the stage-name rule unless `stage` satisfies it. */
export function checkStageName(stage: string): void {
  if (!STAGE_NAME.test(stage)) {
    throw new FrameworkError("CORE.MISCONFIGURED", `stage name ${JSON.stringify(stage)} breaks the stage-name rule: ${STAGE_NAME_RULE}`);
  }
}

/**
 * Validates the names and computes the test-stage flag from the stage name. The flag is never
 * taken from configuration or the caller.
 */
export function createDeployment(input: { readonly app: string; readonly stage: string; readonly target: Target }): Deployment {
  checkAppName(input.app);
  checkStageName(input.stage);
  return Object.freeze({
    app: input.app,
    stage: input.stage,
    target: input.target,
    isTestStage: input.stage.startsWith("test-"),
  });
}

/** What app code sees as `c.var.deployment`: only the app and stage (CORE-REQ-003, DEC-0068). */
export function appIdentity(deployment: Deployment): DeploymentIdentity {
  return Object.freeze({ app: deployment.app, stage: deployment.stage });
}
