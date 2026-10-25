/**
 * Admins by role, anyone who signs in is a user (DEC-0521, DEC-0522, DEC-0524, DEC-0525), with the
 * stub login provider, locally: AUTH-AC-003 (docs/components/auth.md) and E2E-007's local
 * in-process run (docs/acceptance/e2e-scenarios.md). A grant or revoke through
 * `TestApp.grantRole`/`revokeRole` changes the level on the next request of the same session,
 * with no new login and no rebuild. Configuration holds no admins or users list.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { createTestApp } from "../../../src/testing/index.js";
import { authApp, disposeAll, expectError, me, newApp } from "./support.js";

afterEach(disposeAll);

describe("the admin role", () => {
  it(tag("AUTH-AC-003", "every stub login is user; grantRole makes the next request admin and revokeRole makes it user again, with the same session"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    await app.loginWithStub("ac003-person");
    const before = await me(app);
    expect(before["level"]).toBe("user");
    const id = before["id"] as string;
    await expectError(await app.request("/api/admin-only"), "AUTH.FORBIDDEN");

    await app.grantRole(id, "admin");
    expect(await me(app)).toStrictEqual({ level: "admin", id, displayName: expect.toSatisfy((v: unknown) => v === null || typeof v === "string") });
    const adminRoute = await app.request("/api/admin-only");
    expect(adminRoute.status).toBe(200);
    expect(await adminRoute.json()).toStrictEqual({ id, level: "admin" });

    await app.revokeRole(id, "admin");
    expect((await me(app))["level"]).toBe("user");
    await expectError(await app.request("/api/admin-only"), "AUTH.FORBIDDEN");

    // Another person is unaffected by someone else's role.
    await app.grantRole(id, "admin");
    await app.loginWithStub("ac003-someone-else");
    expect((await me(app))["level"]).toBe("user");
    expect((await app.request("/api/user-only")).status).toBe(200);
  });

  it("an admins or users list in the framework configuration is refused, as the build refuses it", async () => {
    await expect(createTestApp(authApp(), { stubLoginProvider: true, config: { framework: { admins: [] } } })).rejects.toThrow(/unknown field "framework\.admins"/);
    await expect(createTestApp(authApp(), { stubLoginProvider: true, config: { framework: { users: [] } } })).rejects.toThrow(/unknown field "framework\.users"/);
  });
});

describe("E2E-007 becoming an admin (local, in-process)", () => {
  it(tag("E2E-007", "local: log in, copy the ID from /api/auth/me, grant the admin role: admin on the next request and not before"), async () => {
    // 1. Log in to a stage.
    const stage = await newApp({ stubLoginProvider: true });
    await stage.loginWithStub("e2e007-person", { displayName: "Person" });
    // 2. Copy the user ID from the account page.
    const account = await me(stage);
    expect(account["level"]).toBe("user");
    const copied = account["id"];
    expect(typeof copied).toBe("string");
    // Not admin before.
    await expectError(await stage.request("/api/admin-only"), "AUTH.FORBIDDEN");
    // 3. Grant the role (on a stage: `admins grant <address>`); no redeploy, no new login.
    await stage.grantRole(copied as string, "admin");
    expect(await me(stage)).toStrictEqual({ level: "admin", id: copied, displayName: "Person" });
    expect((await stage.request("/api/admin-only")).status).toBe(200);
  });
});
