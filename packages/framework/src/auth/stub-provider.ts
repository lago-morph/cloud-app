/**
 * Test-only stub login provider (auth.md §2 "Stub provider"). Implements the internal
 * `LoginProvider` and speaks no protocol: `beginLogin` redirects straight to the callback URL it
 * was given, with a fresh `state` and `code`; `completeLogin` checks the state, refuses a code it
 * has already completed (like a real provider's single-use code), and returns the subject and
 * display name that `stubCallbackUrl` put on the callback URL. Used only by `createTestApp`
 * (`./testing`); never part of a cloud bundle (CORE-REQ-006).
 */
import { FrameworkError } from "../core/errors.js";
import type { AccountStatus, LoginProvider, ProviderIdentity } from "./login-provider.js";
import { withRole, withoutRole, type Role } from "./roles.js";
import { base64urlEncode } from "./signing.js";
import { deriveUserId } from "./user-id.js";

/** The stub's provider name, part of the user-ID derivation (DEC-0227). */
export const STUB_PROVIDER_ID = "stub";

/** Subject used when the callback URL names none. */
export const STUB_DEFAULT_SUBJECT = "stub-subject";

export type StubFailure = "refused" | "replayed";

export interface StubLogin {
  readonly subject: string;
  readonly displayName?: string;
  readonly failure?: StubFailure;
}

function randomToken(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(18)));
}

function failed(reason: string): FrameworkError {
  return new FrameworkError("AUTH.LOGIN_FAILED", reason);
}

/**
 * The stub's redirect URL with the person's choices added, as a browser would arrive at the
 * callback. `createTestApp`'s `loginWithStub` uses it.
 */
export function stubCallbackUrl(redirectUrl: string, login: StubLogin): string {
  const url = new URL(redirectUrl);
  url.searchParams.set("subject", login.subject);
  if (login.displayName !== undefined) url.searchParams.set("name", login.displayName);
  if (login.failure === "refused") url.searchParams.set("error", "access_denied");
  if (login.failure === "replayed") url.searchParams.set("replay", "1");
  return url.toString();
}

/**
 * The stub with its in-memory accounts (auth.md §2 "Stub provider", DEC-0525): one per subject
 * that has logged in, verified and with no roles. `changeRole` is what `TestApp.grantRole` and
 * `revokeRole` write.
 */
export interface StubLoginProvider extends LoginProvider {
  accountStatus(subject: string): Promise<AccountStatus | null>;
  /** Adds or removes `role` on the account whose user ID is `userId`; false when there is none. */
  changeRole(userId: string, role: Role, change: "grant" | "revoke"): Promise<boolean>;
}

export function createStubLoginProvider(): StubLoginProvider {
  const usedCodes = new Set<string>();
  const accounts = new Map<string, { roles: string[] }>();
  return Object.freeze({
    id: STUB_PROVIDER_ID,
    async beginLogin(ctx) {
      const state = randomToken();
      const url = new URL(ctx.callbackUrl);
      url.searchParams.set("state", state);
      url.searchParams.set("code", randomToken());
      return { redirectUrl: url.toString(), transactionState: state };
    },
    async completeLogin(_ctx, query, transactionState): Promise<ProviderIdentity> {
      if (query.get("state") !== transactionState) throw failed("state mismatch");
      const code = query.get("code");
      if (query.has("error") || code === null) throw failed("provider refused");
      if (query.has("replay") || usedCodes.has(code)) throw failed("token exchange rejected (HTTP 400, code already used)");
      usedCodes.add(code);
      const subject = query.get("subject") ?? STUB_DEFAULT_SUBJECT;
      if (!accounts.has(subject)) accounts.set(subject, { roles: [] });
      return { subject, displayName: query.get("name") };
    },
    async accountStatus(subject: string): Promise<AccountStatus | null> {
      const account = accounts.get(subject);
      return account === undefined ? null : { verified: true, roles: [...account.roles] };
    },
    async changeRole(userId: string, role: Role, change: "grant" | "revoke"): Promise<boolean> {
      for (const [subject, account] of accounts) {
        if ((await deriveUserId(STUB_PROVIDER_ID, subject)) !== userId) continue;
        account.roles = change === "grant" ? withRole(account.roles, role) : withoutRole(account.roles, role);
        return true;
      }
      return false;
    },
  } satisfies StubLoginProvider);
}
