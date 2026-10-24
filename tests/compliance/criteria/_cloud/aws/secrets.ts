/**
 * Stage secrets in SSM Parameter Store (SEC-REQ-003 AWS row: SecureString parameters at
 * `/<app>/<stage>/secrets/<name>`).
 *
 * - `deleteStageSecret` is SEC-AC-005's and PROV-AC-002's test hook: it deletes the parameter
 *   directly in SSM, not through the framework. 1 API call.
 * - `stageSecretLocations` lists the parameter names under the stage's secrets path (names only,
 *   never values: no decryption is requested). One call per 10 parameters, bounded.
 */
import { DeleteParameterCommand, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { awsCall, awsClients, awsFailure, errorName, MAX_PAGES } from "./api.js";
import { type AwsStage, secretParameterName, secretParameterPath, stageParameterPath } from "./names.js";

/** Deletes secret `name` (logical name) of the stage directly in SSM; an absent parameter is an error. */
export async function deleteStageSecret(stage: AwsStage, name: string): Promise<void> {
  const parameter = secretParameterName(stage, name);
  const what = `deleting SSM parameter ${parameter}`;
  try {
    await awsCall(what, () => awsClients().ssm.send(new DeleteParameterCommand({ Name: parameter })));
  } catch (error) {
    if (errorName(error) === "ParameterNotFound") throw new Error(`${what} failed: the parameter does not exist`);
    throw awsFailure(what, error);
  }
}

/** Every parameter name under `path` (recursive), sorted; values are not read. */
export async function parameterNames(path: string, recursive: boolean): Promise<string[]> {
  const names: string[] = [];
  let token: string | undefined;
  const what = `listing SSM parameters under ${path}`;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let r;
    try {
      r = await awsCall(what, () => awsClients().ssm.send(new GetParametersByPathCommand({ Path: path, Recursive: recursive, WithDecryption: false, MaxResults: 10, ...(token === undefined ? {} : { NextToken: token }) })));
    } catch (error) {
      throw awsFailure(what, error);
    }
    for (const p of r.Parameters ?? []) if (p.Name !== undefined) names.push(p.Name);
    token = r.NextToken;
    if (token === undefined || token === "") return names.sort();
  }
  throw new Error(`${what}: more than ${String(MAX_PAGES)} pages; the hook does not list further`);
}

/** SEC-REQ-003 locations of the secrets set on the stage (`/<app>/<stage>/secrets/<name>`), sorted. */
export function stageSecretLocations(stage: AwsStage): Promise<string[]> {
  return parameterNames(secretParameterPath(stage), false);
}

/** Every SSM parameter of the stage, under `/<app>/<stage>/` (PROV §2 "Removal"), sorted. */
export function stageParameters(stage: AwsStage): Promise<string[]> {
  return parameterNames(stageParameterPath(stage), true);
}
