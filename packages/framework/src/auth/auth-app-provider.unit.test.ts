import { describe, expect, it } from "vitest";
import { FrameworkError } from "../core/errors.js";
import { createFakeAuthAppBinding } from "./auth-app-binding.js";
import { AUTH_APP_PROVIDER_ID, createAuthAppProvider } from "./auth-app-provider.js";
import type { ProviderContext } from "./login-provider.js";

const CALLBACK = "https://notes-prod.example.workers.dev/api/auth/callback";
const AUTH_ORIGIN = "https://auth.example.workers.dev";
const APP = "notes-prod";

const ctx: ProviderContext = {
  callbackUrl: CALLBACK,
  getSecret: () => Promise.reject(new Error("the auth-app provider reads no secret")),
  getConfig: () => undefined,
};

const alice = { sub: "cf-sub-alice", email: "alice@example.com", role: "user" } as const;

function setup(now?: () => number) {
  const binding = createFakeAuthAppBinding(now === undefined ? {} : { now });
  const provider = createAuthAppProvider({ binding, app: APP, authAppOrigin: AUTH_ORIGIN });
  /** The query the auth app's redirect back to the app carries for `code`. */
  const back = (state: string, extra: Record<string, string>) => new URLSearchParams({ ...extra, state });
  return { binding, provider, back };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FrameworkError);
  expect((error as FrameworkError).code).toBe("AUTH.LOGIN_FAILED");
  return (error as FrameworkError).message;
}

describe("auth-app login provider", () => {
  it("its id is 'cf-account', the session's provider field (plan §4.1 step 4)", () => {
    expect(AUTH_APP_PROVIDER_ID).toBe("cf-account");
    expect(setup().provider.id).toBe("cf-account");
  });

  it("begins at the auth app's /start with the app ID, the exact callback URL and a fresh state", async () => {
    const { provider } = setup();
    const begun = await provider.beginLogin(ctx);
    const url = new URL(begun.redirectUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${AUTH_ORIGIN}/start`);
    expect([...url.searchParams.keys()]).toStrictEqual(["app", "return", "state"]);
    expect(url.searchParams.get("app")).toBe(APP);
    expect(url.searchParams.get("return")).toBe(CALLBACK);
    expect(url.searchParams.get("state")).toBe(begun.transactionState);
    expect(begun.transactionState).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await provider.beginLogin(ctx)).transactionState).not.toBe(begun.transactionState);
  });

  it("an auth-app origin with a path or a trailing slash still begins at <origin>/start", async () => {
    const binding = createFakeAuthAppBinding();
    for (const authAppOrigin of [`${AUTH_ORIGIN}/`, `${AUTH_ORIGIN}/ignored/path`]) {
      const begun = await createAuthAppProvider({ binding, app: APP, authAppOrigin }).beginLogin(ctx);
      expect(begun.redirectUrl.startsWith(`${AUTH_ORIGIN}/start?`)).toBe(true);
    }
  });

  it("a malformed auth-app origin is CORE.MISCONFIGURED, naming no value", async () => {
    const provider = createAuthAppProvider({ binding: createFakeAuthAppBinding(), app: APP, authAppOrigin: "not a url" });
    await expect(provider.beginLogin(ctx)).rejects.toMatchObject({ code: "CORE.MISCONFIGURED" });
  });

  it("completes a valid code as the Cloudflare subject, with no display name, using the code up", async () => {
    const { binding, provider, back } = setup();
    const { transactionState } = await provider.beginLogin(ctx);
    const code = binding.issueCode(alice, { app: APP, returnUrl: CALLBACK });
    expect(await provider.completeLogin(ctx, back(transactionState, { code }), transactionState)).toStrictEqual({ subject: alice.sub, displayName: null, roles: [] });
    expect(binding.calls.redeem).toBe(1);
    expect(await failure(provider.completeLogin(ctx, back(transactionState, { code }), transactionState))).toBe("code refused");
  });

  it("the identity carries the role at redemption, not at code issue (plan §4.1 step 5)", async () => {
    const { binding, provider, back } = setup();
    const { transactionState: s } = await provider.beginLogin(ctx);
    const code = binding.issueCode(alice, { app: APP, returnUrl: CALLBACK });
    binding.setRole(alice.sub, "admin");
    expect(await provider.completeLogin(ctx, back(s, { code }), s)).toMatchObject({ roles: ["admin"] });
  });

  it("a state mismatch fails before any redemption", async () => {
    const { binding, provider, back } = setup();
    const { transactionState } = await provider.beginLogin(ctx);
    const code = binding.issueCode(alice, { app: APP, returnUrl: CALLBACK });
    expect(await failure(provider.completeLogin(ctx, back("other-state", { code }), transactionState))).toBe("state mismatch");
    expect(binding.calls.redeem).toBe(0);
  });

  it("the auth app's error redirect, or no code, is 'provider refused' with no redemption", async () => {
    const { binding, provider, back } = setup();
    const { transactionState } = await provider.beginLogin(ctx);
    expect(await failure(provider.completeLogin(ctx, back(transactionState, { error: "login_failed" }), transactionState))).toBe("provider refused");
    const code = binding.issueCode(alice, { app: APP, returnUrl: CALLBACK });
    expect(await failure(provider.completeLogin(ctx, back(transactionState, { code, error: "login_failed" }), transactionState))).toBe("provider refused");
    expect(await failure(provider.completeLogin(ctx, back(transactionState, {}), transactionState))).toBe("provider refused");
    expect(binding.calls.redeem).toBe(0);
  });

  it("a code issued to another app, expired, or for an unregistered return URL is 'code refused'", async () => {
    let now = 1_000_000;
    const { binding, provider, back } = setup(() => now);
    const { transactionState: s } = await provider.beginLogin(ctx);
    const other = binding.issueCode(alice, { app: "other-prod" });
    expect(await failure(provider.completeLogin(ctx, back(s, { code: other }), s))).toBe("code refused");
    const late = binding.issueCode(alice, { app: APP, returnUrl: CALLBACK });
    now += 60_001;
    expect(await failure(provider.completeLogin(ctx, back(s, { code: late }), s))).toBe("code refused");
    const gone = binding.issueCode(alice, { app: APP, returnUrl: CALLBACK });
    binding.unregisterApp(APP);
    expect(await failure(provider.completeLogin(ctx, back(s, { code: gone }), s))).toBe("code refused");
  });

  it("an unavailable auth app is 'auth app unavailable', and the code stays usable", async () => {
    const { binding, provider, back } = setup();
    const { transactionState: s } = await provider.beginLogin(ctx);
    const code = binding.issueCode(alice, { app: APP, returnUrl: CALLBACK });
    binding.failNext(1);
    expect(await failure(provider.completeLogin(ctx, back(s, { code }), s))).toBe("auth app unavailable");
    expect(await provider.completeLogin(ctx, back(s, { code }), s)).toMatchObject({ subject: alice.sub });
  });

  it("accountStatus maps the auth app's role: admin is the role list ['admin'], user an empty list, no user null", async () => {
    const { binding, provider } = setup();
    binding.issueCode(alice, { app: APP });
    expect(await provider.accountStatus(alice.sub)).toStrictEqual({ verified: true, roles: [] });
    binding.setRole(alice.sub, "admin");
    expect(await provider.accountStatus(alice.sub)).toStrictEqual({ verified: true, roles: ["admin"] });
    binding.setRole(alice.sub, null);
    expect(await provider.accountStatus(alice.sub)).toBeNull();
    expect(await provider.accountStatus("never-signed-in")).toBeNull();
  });

  it("accountStatus throws when the auth app cannot answer", async () => {
    const { binding, provider } = setup();
    binding.setUnavailable(true);
    await expect(provider.accountStatus(alice.sub)).rejects.toThrow();
  });
});
