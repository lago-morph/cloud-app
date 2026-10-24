/**
 * The AWS sandbox-limits setting (DEC-0507): `PROTOTYPE_AWS_SANDBOX=pluralsight` says the AWS
 * account is a Pluralsight cloud sandbox, whose limits are binding (a violation gets the account
 * deleted). While it is on, `setup-account --target aws --region` and the compliance driver refuse
 * a region the sandbox does not allow. Unset or empty, it is off; any other value is refused, so a
 * typo never turns the guard off silently.
 */

export const AWS_SANDBOX_ENV = "PROTOTYPE_AWS_SANDBOX";

/** The regions each known sandbox allows (the Pluralsight sandbox's help article). */
export const SANDBOX_REGIONS = { pluralsight: ["us-east-1", "us-west-2"] } as const satisfies Record<string, readonly string[]>;

export type AwsSandbox = keyof typeof SANDBOX_REGIONS;

/** The sandbox named by `PROTOTYPE_AWS_SANDBOX`, or undefined when it is unset or empty. Throws on an unknown value. */
export function awsSandbox(env: Readonly<Record<string, string | undefined>>): AwsSandbox | undefined {
  const value = env[AWS_SANDBOX_ENV];
  if (value === undefined || value === "") return undefined;
  if (Object.hasOwn(SANDBOX_REGIONS, value)) return value as AwsSandbox;
  throw new Error(`${AWS_SANDBOX_ENV}=${value} is not a known sandbox (known: ${Object.keys(SANDBOX_REGIONS).join(", ")})`);
}

/** Why `region` may not be used under the sandbox setting of `env`, or undefined when it may. */
export function sandboxRegionProblem(env: Readonly<Record<string, string | undefined>>, region: string): string | undefined {
  const sandbox = awsSandbox(env);
  if (sandbox === undefined) return undefined;
  const allowed: readonly string[] = SANDBOX_REGIONS[sandbox];
  if (allowed.includes(region)) return undefined;
  return `region ${region} is not allowed in the ${sandbox} sandbox (${AWS_SANDBOX_ENV}=${sandbox}): only ${allowed.join(", ")}`;
}
