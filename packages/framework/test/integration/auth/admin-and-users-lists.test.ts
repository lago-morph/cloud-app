/**
 * Admin list and users list with the stub login provider, locally.
 * AUTH-AC-003, AUTH-AC-012 (docs/components/auth.md), CFG-AC-005 local part
 * (docs/components/config.md), E2E-007 local in-process run (docs/acceptance/e2e-scenarios.md:
 * "Locally this runs as an in-process test (createTestApp with the stub login provider) …
 * the redeploy is a rebuild").
 *
 * A "build" here is one `createTestApp` call; its `config` option carries the stage's
 * `framework` values (B-T3 decision 1).
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import type { TestApp } from "../../../src/testing/index.js";
import { disposeAll, expectError, frameworkConfig, me, newApp } from "./support.js";

afterEach(disposeAll);

/** Logs `subject` in on a fresh build without lists and returns its user ID from /api/auth/me. */
async function userIdOf(subject: string): Promise<string> {
  const app = await newApp({ stubLoginProvider: true });
  await app.loginWithStub(subject);
  const body = await me(app);
  expect(body["level"]).toBe("user");
  return body["id"] as string;
}

async function build(lists: { admins?: string[]; users?: string[] }): Promise<TestApp> {
  return newApp({ stubLoginProvider: true, config: frameworkConfig(lists) });
}

async function levelAfterLogin(app: TestApp, subject: string): Promise<unknown> {
  await app.loginWithStub(subject);
  return (await me(app))["level"];
}

describe("admin list", () => {
  it(tag("AUTH-AC-003", "adding and removing a user ID in framework.admins (with rebuild) changes that user's level"), async () => {
    const id = await userIdOf("ac003-person");

    const withAdmin = await build({ admins: [id] });
    await withAdmin.loginWithStub("ac003-person");
    expect(await me(withAdmin)).toStrictEqual({ level: "admin", id, displayName: expect.toSatisfy((v: unknown) => v === null || typeof v === "string") });
    const adminRoute = await withAdmin.request("/api/admin-only");
    expect(adminRoute.status).toBe(200);
    expect(await adminRoute.json()).toStrictEqual({ id, level: "admin" });

    const removed = await build({ admins: [] });
    await removed.loginWithStub("ac003-person");
    const after = await me(removed);
    expect(after["level"]).toBe("user");
    expect(after["id"]).toBe(id);
    await expectError(await removed.request("/api/admin-only"), "AUTH.FORBIDDEN");

    // Another person is unaffected by someone else's admin entry.
    const other = await build({ admins: [id] });
    expect(await levelAfterLogin(other, "ac003-someone-else")).toBe("user");
  });
});

describe("users list", () => {
  it(tag("AUTH-AC-012", "framework.users set to one ID: listed subject is user, admins-only subject is admin, any other is anonymous with unlistedId"), async () => {
    const listedId = await userIdOf("ac012-listed");
    const adminId = await userIdOf("ac012-admin");
    const otherId = await userIdOf("ac012-other");

    const listed = await build({ users: [listedId], admins: [adminId] });
    await listed.loginWithStub("ac012-listed");
    const listedMe = await me(listed);
    expect(listedMe["level"]).toBe("user");
    expect(listedMe["id"]).toBe(listedId);
    expect(listedMe).not.toHaveProperty("unlistedId");
    expect((await listed.request("/api/user-only")).status).toBe(200);

    const admin = await build({ users: [listedId], admins: [adminId] });
    await admin.loginWithStub("ac012-admin");
    const adminMe = await me(admin);
    expect(adminMe["level"]).toBe("admin");
    expect(adminMe["id"]).toBe(adminId);

    const other = await build({ users: [listedId], admins: [adminId] });
    await other.loginWithStub("ac012-other");
    await expectError(await other.request("/api/user-only"), "AUTH.UNAUTHENTICATED");
    expect(await me(other)).toStrictEqual({ level: "anonymous", unlistedId: otherId });
    // App code never sees the unlisted ID.
    const dump = await other.request("/api/whoami");
    expect(await dump.json()).toStrictEqual({ level: "anonymous" });
  });

  it(tag("AUTH-AC-012", "without framework.users every validated login is at least user"), async () => {
    const adminId = await userIdOf("ac012-noll-admin");
    for (const subject of ["ac012-noll-a", "ac012-noll-b", "ac012-noll-c"]) {
      const app = await build({ admins: [adminId] });
      expect(await levelAfterLogin(app, subject)).toBe("user");
      expect((await app.request("/api/user-only")).status).toBe(200);
    }
    const app = await build({ admins: [adminId] });
    expect(await levelAfterLogin(app, "ac012-noll-admin")).toBe("admin");
  });
});

describe("lists change only with a new build", () => {
  it(tag("CFG-AC-005", "local: an ID added to framework.admins makes the user admin only after the next build; removing it reverts only after the next build"), async () => {
    const id = await userIdOf("cfg005-admin");
    const values = { admins: [] as string[] };

    const before = await build(values);
    expect(await levelAfterLogin(before, "cfg005-admin")).toBe("user");
    // Changing the values after the build has no effect on that build.
    values.admins.push(id);
    expect(await levelAfterLogin(before, "cfg005-admin")).toBe("user");
    expect((await me(before))["level"]).toBe("user");

    const next = await build(values);
    expect(await levelAfterLogin(next, "cfg005-admin")).toBe("admin");

    values.admins.splice(0, values.admins.length);
    expect(await levelAfterLogin(next, "cfg005-admin")).toBe("admin");
    const reverted = await build(values);
    expect(await levelAfterLogin(reverted, "cfg005-admin")).toBe("user");
  });

  it(tag("CFG-AC-005", "local: adding framework.users without a logged-in user's ID makes that user anonymous only after the next build"), async () => {
    const id = await userIdOf("cfg005-user");
    const otherId = await userIdOf("cfg005-someone");
    const values: { users?: string[] } = {};

    const before = await build(values);
    expect(await levelAfterLogin(before, "cfg005-user")).toBe("user");
    values.users = [otherId];
    expect(await levelAfterLogin(before, "cfg005-user")).toBe("user");

    const next = await build(values);
    await next.loginWithStub("cfg005-user");
    expect(await me(next)).toStrictEqual({ level: "anonymous", unlistedId: id });
    await expectError(await next.request("/api/user-only"), "AUTH.UNAUTHENTICATED");
  });
});

describe("E2E-007 becoming an admin (local, in-process)", () => {
  it(tag("E2E-007", "local: log in, copy the ID from /api/auth/me, add it to the admin list, rebuild: admin after and not before"), async () => {
    const values = { admins: [] as string[] };
    // 1. Log in to a stage.
    const stage = await build(values);
    await stage.loginWithStub("e2e007-person", { displayName: "Person" });
    // 2. Copy the user ID from the account page.
    const account = await me(stage);
    expect(account["level"]).toBe("user");
    const copied = account["id"];
    expect(typeof copied).toBe("string");
    // Not admin before.
    await expectError(await stage.request("/api/admin-only"), "AUTH.FORBIDDEN");
    // 3. Add it to the admin list in configuration.
    values.admins.push(copied as string);
    await expectError(await stage.request("/api/admin-only"), "AUTH.FORBIDDEN");
    // 4. Redeploy (a rebuild locally).
    const redeployed = await build(values);
    await redeployed.loginWithStub("e2e007-person", { displayName: "Person" });
    expect(await me(redeployed)).toStrictEqual({ level: "admin", id: copied, displayName: "Person" });
    const adminRoute = await redeployed.request("/api/admin-only");
    expect(adminRoute.status).toBe(200);
  });
});
