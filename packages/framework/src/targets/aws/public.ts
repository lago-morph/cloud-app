/**
 * AWS target runtime (`./targets/aws` subpath; importable by generated entry points only,
 * CORE-REQ-005). G-01 stub: it declares the contract's names, and the entry point throws until
 * G-05 builds the runtime on `assembleStage` and Hono's AWS Lambda adapter (aws.md §2;
 * DEC-PENDING-g-s1-3). The generated Lambda entry (G-06) passes the app definition and the
 * embedded resolved configuration; test-stage entries also pass `createAuthMock`, production
 * entries do not import it, so production bundles contain no mock (CORE-REQ-006, PROV-REQ-005).
 *
 * The event and result types stay opaque here, so the subpath's declarations need no
 * `@types/aws-lambda`; G-05 narrows them to Function URL (payload 2.0) shapes.
 */
import type { DefinedApp } from "../../core/public.js";
import type { ConfigDeclaration } from "../../config/public.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import type { AuthMock, AuthMockOptions } from "../../auth/mock.js";
import { AwsNotImplementedError } from "../../core/aws-pending.js";

export { createAuthMock } from "../../auth/mock.js";

/** The HTTP Lambda's handler: one Function URL event and its Lambda context in, the response out. */
export type AwsLambdaHandler = (event: unknown, context: unknown) => Promise<unknown>;

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

export const createAwsLambdaHandler: CreateAwsLambdaHandler = () => {
  throw new AwsNotImplementedError("the AWS Lambda runtime, createAwsLambdaHandler (G-05)");
};
