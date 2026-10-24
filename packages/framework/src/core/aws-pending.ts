/**
 * The places where `"aws"` is a valid `Target` but phase G has not built the AWS behaviour yet
 * (G-01; plan-aws.md §3). Each such place throws this error instead of falling through to
 * another target's code, so an AWS command or build fails loudly and names what is missing.
 * The G item that builds the behaviour removes its call.
 */

export const AWS_NOT_IMPLEMENTED = "AWS target not yet implemented (phase G)";

export class AwsNotImplementedError extends Error {
  override readonly name = "AwsNotImplementedError";

  /** `what`: the missing behaviour, and the G item that builds it. */
  constructor(what: string) {
    super(`${AWS_NOT_IMPLEMENTED}: ${what}`);
  }
}
