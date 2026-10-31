/**
 * A refused sign-in in the auth app. `reason` is one fixed, loggable phrase (the failed-login
 * rule of auth.md §2: never a code, state or token); the person sees only a generic page.
 */
export class SignInError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`sign-in refused: ${reason}`);
    this.name = "SignInError";
    this.reason = reason;
  }
}
