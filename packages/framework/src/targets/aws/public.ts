/**
 * AWS target runtime (`./targets/aws` subpath; importable by generated entry points only,
 * CORE-REQ-005). The generated Lambda entry (G-06) passes the app definition and the embedded
 * resolved configuration; test-stage entries also pass `createAuthMock`, production entries do
 * not import it, so production bundles contain no mock (CORE-REQ-006, PROV-REQ-005).
 *
 * The handler is the shared stage runtime over the AWS adapters behind Hono's AWS Lambda
 * adapter (`handler.ts`; aws.md §2; DEC-0434). It reads the Lambda's own environment
 * (`process.env`, `settings.ts`), and creates its SDK clients once per cold start.
 */
import type { DefinedApp } from "../../core/public.js";
import type { ConfigDeclaration } from "../../config/public.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import type { AuthMock, AuthMockOptions } from "../../auth/mock.js";
import { createGoogleLoginProvider } from "../../google/provider.js";
import { createSsmClient } from "../../secrets/aws.js";
import { dataApiClient } from "../../sql/data-api.js";
import { createAwsLambdaRuntime, type AwsLambdaHandler } from "./handler.js";

export { createAuthMock } from "../../auth/mock.js";
export type { AwsLambdaHandler, FunctionUrlEvent, FunctionUrlResult } from "./handler.js";

export interface AwsLambdaHandlerOptions {
  /** Test stages only: the authentication mock's factory (`createAuthMock`). */
  readonly mock?: (options?: AuthMockOptions) => AuthMock;
}

/** The generated entry's call: the stage's Lambda handler for `app` with its resolved configuration. */
export type CreateAwsLambdaHandler = <C extends ConfigDeclaration, S extends string>(
  app: DefinedApp<C, S>,
  resolved: ResolvedConfig,
  options?: AwsLambdaHandlerOptions,
) => AwsLambdaHandler;

export const createAwsLambdaHandler: CreateAwsLambdaHandler = (app, resolved, options = {}) => {
  const production = !resolved.deployment.isTestStage;
  return createAwsLambdaRuntime(app, resolved, {
    env: process.env,
    dataApi: dataApiClient,
    ssm: (region) => createSsmClient(process.env, region),
    // Production stages log in with Google; a test stage uses the mock unless it configures Google.
    ...(production || resolved.google !== undefined ? { provider: createGoogleLoginProvider() } : {}),
    ...(options.mock === undefined ? {} : { mock: options.mock() }),
  });
};
