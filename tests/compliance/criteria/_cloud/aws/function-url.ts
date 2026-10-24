/**
 * Function URL discovery (AWS-AC-004, AWS-AC-006): the stage Function's own URL, so a test can
 * send requests directly to it, bypassing CloudFront. Lambda `GetFunctionUrlConfig` on the
 * Function `<app>-<stage>-http` (names.ts). 1 call.
 */
import { GetFunctionUrlConfigCommand } from "@aws-sdk/client-lambda";
import { awsCall, awsClients, awsFailure, errorName } from "./api.js";
import { type AwsStage, functionName } from "./names.js";

const FUNCTION_URL = /^https:\/\/[a-z0-9]+\.lambda-url\.[a-z0-9-]+\.on\.aws\/?$/;

/** The stage Function's URL origin, `https://<id>.lambda-url.<region>.on.aws` (no trailing slash). */
export async function functionUrlOrigin(s: AwsStage): Promise<string> {
  const name = functionName(s);
  const what = `reading the Function URL of Lambda function ${name}`;
  let url: string | undefined;
  try {
    url = (await awsCall(what, () => awsClients().lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: name })))).FunctionUrl;
  } catch (error) {
    if (errorName(error) === "ResourceNotFoundException") throw new Error(`${what} failed: the function or its URL does not exist`);
    throw awsFailure(what, error);
  }
  if (url === undefined || !FUNCTION_URL.test(url)) throw new Error(`${what}: unexpected Function URL ${String(url)}`);
  return new URL(url).origin;
}
