import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import type { ProviderContext } from "./login-provider.js";
import { STUB_PROVIDER_ID, createStubLoginProvider, stubCallbackUrl } from "./stub-provider.js";

const ctx: ProviderContext = {
  callbackUrl: "http://localhost:8787/api/auth/callback",
  getSecret: () => Promise.reject(new Error("the stub reads no secret")),
  getConfig: () => undefined,
};

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FrameworkError);
  expect((error as FrameworkError).code).toBe("AUTH.LOGIN_FAILED");
  return (error as FrameworkError).message;
}

describe("stub login provider", () => {
  it(tag("AUTH-AC-008", "its id is 'stub' and it redirects straight to the callback URL it was given"), async () => {
    const stub = createStubLoginProvider();
    expect(stub.id).toBe(STUB_PROVIDER_ID);
    expect(STUB_PROVIDER_ID).toBe("stub");
    const begun = await stub.beginLogin(ctx);
    const url = new URL(begun.redirectUrl);
    expect(`${url.origin}${url.pathname}`).toBe(ctx.callbackUrl);
    expect(url.searchParams.get("state")).toBe(begun.transactionState);
    expect(begun.transactionState.length).toBeGreaterThanOrEqual(16);
    expect((await stub.beginLogin(ctx)).transactionState).not.toBe(begun.transactionState);
  });

  it("completes as the subject and display name set on the callback URL, or a default subject", async () => {
    const stub = createStubLoginProvider();
    const begun = await stub.beginLogin(ctx);
    const url = stubCallbackUrl(begun.redirectUrl, { subject: "alice", displayName: "Alice" });
    expect(await stub.completeLogin(ctx, new URL(url).searchParams, begun.transactionState)).toStrictEqual({ subject: "alice", displayName: "Alice" });
    const plain = await stub.beginLogin(ctx);
    const identity = await stub.completeLogin(ctx, new URL(plain.redirectUrl).searchParams, plain.transactionState);
    expect(identity.subject).not.toBe("");
    expect(identity.displayName).toBeNull();
  });

  it(tag("AUTH-AC-010", "fails with fixed reasons: state mismatch, provider refused, replayed code"), async () => {
    const stub = createStubLoginProvider();
    const a = await stub.beginLogin(ctx);
    const b = await stub.beginLogin(ctx);
    expect(await failure(stub.completeLogin(ctx, new URL(a.redirectUrl).searchParams, b.transactionState))).toBe("state mismatch");

    const refused = new URL(stubCallbackUrl(a.redirectUrl, { subject: "s", failure: "refused" }));
    expect(await failure(stub.completeLogin(ctx, refused.searchParams, a.transactionState))).toBe("provider refused");

    const replayed = new URL(stubCallbackUrl(b.redirectUrl, { subject: "s", failure: "replayed" }));
    expect(await failure(stub.completeLogin(ctx, replayed.searchParams, b.transactionState))).toMatch(/^token exchange rejected/);
  });

  it(tag("AUTH-AC-010", "a code completes at most once"), async () => {
    const stub = createStubLoginProvider();
    const begun = await stub.beginLogin(ctx);
    const query = new URL(begun.redirectUrl).searchParams;
    await stub.completeLogin(ctx, query, begun.transactionState);
    expect(await failure(stub.completeLogin(ctx, query, begun.transactionState))).toMatch(/^token exchange rejected/);
  });
});
