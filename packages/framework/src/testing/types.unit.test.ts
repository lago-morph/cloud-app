/**
 * `./testing` shows test code only application concepts (CORE-REQ-005, AUTH-REQ-001; E2E-005's type
 * test; root cause ai/implementation/root-causes/2026-10-31-T7-testing-types-email.md, DEC-0734):
 * no MAIL (removed in v0.2.0) and sign-in identities without an email address. The type assertions
 * are checked by `npm run typecheck`, which compiles this file.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createFakeAuthAppBinding } from "../auth/auth-app-binding.js";
import { testAuthApp } from "./auth-app-adapter.js";
import type { TestApp, TestAppOptions } from "./index.js";

const CONTRACT = new URL("../../../../docs/contracts/ts/testing.d.ts", import.meta.url);

/** Identifiers and string literals of a declaration file, comments excluded (as E2E-005's scan reads them). */
function typeTokens(source: string): string[] {
  const out: string[] = [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.Identifier) out.push(scanner.getTokenText());
    else if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) out.push(scanner.getTokenValue());
  }
  return out;
}

/** The identity `./testing` takes: the subject and the role, nothing else. */
interface Identity {
  readonly sub: string;
  readonly role: "admin" | "user";
}

describe("./testing types (testing.d.ts, DEC-0734)", () => {
  it("TestApp and TestAppOptions have no MAIL member", () => {
    expectTypeOf<"mail" extends keyof TestApp ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<"mailSender" extends keyof TestAppOptions ? true : false>().toEqualTypeOf<false>();
  });

  it("loginWithAuthApp and authApp.issueCode take a subject and a role, with no email address", () => {
    expectTypeOf<Parameters<TestApp["loginWithAuthApp"]>[0]>().toEqualTypeOf<Identity>();
    expectTypeOf<Parameters<TestApp["authApp"]["issueCode"]>[0]>().toEqualTypeOf<Identity>();
  });

  it("the contract, docs/contracts/ts/testing.d.ts, declares no mail, email or password name either", () => {
    const tokens = typeTokens(readFileSync(CONTRACT, "utf8"));
    expect(tokens.length, "the contract was read").toBeGreaterThan(100);
    expect(tokens.filter((t) => /mail|password/i.test(t))).toStrictEqual([]);
  });
});

describe("TestApp.authApp over the fake auth app (DEC-0734)", () => {
  it("hands the fake a made-up address on the reserved auth-app.test domain, so its redeem keeps the internal shape", async () => {
    const fake = createFakeAuthAppBinding();
    const code = testAuthApp(fake).issueCode({ sub: "cf-sub-alice", role: "admin" }, { app: "a" });
    expect(await fake.redeem({ code, app: "a" })).toStrictEqual({ sub: "cf-sub-alice", email: "cf-sub-alice@auth-app.test", role: "admin" });
  });

  it("an email a JavaScript caller still passes is not used", async () => {
    const fake = createFakeAuthAppBinding();
    const identity = { sub: "cf-sub-bob", role: "user", email: "bob@example.com" } as Identity;
    const code = testAuthApp(fake).issueCode(identity, { app: "a" });
    expect((await fake.redeem({ code, app: "a" }))?.email).toBe("cf-sub-bob@auth-app.test");
  });

  it("passes issueCode's returnUrl to the fake", async () => {
    const fake = createFakeAuthAppBinding();
    const code = testAuthApp(fake).issueCode({ sub: "s", role: "user" }, { app: "a", returnUrl: "https://a.example/api/auth/callback" });
    fake.unregisterApp("a");
    // Registers only the default return URL again; a code bound to it would now pass.
    const control = testAuthApp(fake).issueCode({ sub: "s", role: "user" }, { app: "a" });
    expect(await fake.redeem({ code, app: "a" }), "the code is bound to the given return URL, no longer registered").toBeNull();
    expect(await fake.redeem({ code: control, app: "a" })).not.toBeNull();
  });

  it("forwards setRole, unregisterApp, failNext, setUnavailable and calls to the fake", async () => {
    const fake = createFakeAuthAppBinding();
    const app = testAuthApp(fake);
    const code = app.issueCode({ sub: "s", role: "user" }, { app: "a" });
    app.setRole("s", "admin");
    expect(await fake.role("s")).toBe("admin");
    app.failNext(1);
    await expect(fake.role("s")).rejects.toThrow(/unavailable/);
    app.setUnavailable(true);
    await expect(fake.role("s")).rejects.toThrow(/unavailable/);
    app.setUnavailable(false);
    app.unregisterApp("a");
    expect(await fake.redeem({ code, app: "a" })).toBeNull();
    expect(app.calls).toStrictEqual({ redeem: 1, role: 3 });
    app.setRole("s", null);
    expect(await fake.role("s")).toBeNull();
  });
});
