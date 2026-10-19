/**
 * AUTH-AC-001 (current user shape) and AUTH-AC-004 (route protection), local.
 * Source: docs/components/auth.md AUTH-REQ-001, AUTH-REQ-004; docs/contracts/ts/auth.d.ts, core.d.ts.
 */
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { CurrentUser, LoggedInUser, RequestVars } from "../../../src/index.js";
import { mockUsers } from "../../../src/testing/index.js";
import { tag } from "../../../../../tests/support/tags.js";
import { disposeAll, expectError, newApp } from "./support.js";

afterEach(disposeAll);

describe("AUTH current user", () => {
  it(tag("AUTH-AC-001", "type inspection: CurrentUser, LoggedInUser and c.var.user carry only level, id and displayName"), () => {
    type Expected =
      | { readonly level: "anonymous" }
      | { readonly level: "user" | "admin"; readonly id: string; readonly displayName: string | null };
    expectTypeOf<CurrentUser>().toEqualTypeOf<Expected>();
    expectTypeOf<LoggedInUser>().toEqualTypeOf<{ readonly level: "user" | "admin"; readonly id: string; readonly displayName: string | null }>();
    expectTypeOf<RequestVars["user"]>().toEqualTypeOf<CurrentUser>();
    // Reading the ID needs narrowing on CurrentUser: it is not present on the anonymous member.
    expectTypeOf<keyof Extract<CurrentUser, { level: "anonymous" }>>().toEqualTypeOf<"level">();
    expectTypeOf<keyof LoggedInUser>().toEqualTypeOf<"level" | "id" | "displayName">();
    // Runtime half of the type check: the reference routes in support.ts read `c.var.user.id`
    // behind requireUser()/requireAdmin() and `requireCurrentUser(c).id` with no assertion; this
    // file only type-checks if those reads compile.
  });

  it(tag("AUTH-AC-001", "reference route dumping c.var.user shows only the specified fields at each access level"), async () => {
    const anonymous = await newApp({ user: mockUsers.anonymous });
    const resA = await anonymous.request("/api/whoami");
    expect(resA.status).toBe(200);
    expect(await resA.json()).toStrictEqual({ level: "anonymous" });

    for (const level of ["user", "admin"] as const) {
      const id = `ac001-${level}`;
      const app = await newApp({ user: mockUsers[level](id) });
      const res = await app.request("/api/whoami");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toStrictEqual(["displayName", "id", "level"]);
      expect(body["level"]).toBe(level);
      expect(body["id"]).toBe(id);
      expect(body["displayName"] === null || typeof body["displayName"] === "string").toBe(true);
    }
  });

  it(tag("AUTH-AC-001", "a handler behind requireUser() and one calling requireCurrentUser(c) read the user ID"), async () => {
    const app = await newApp({ user: mockUsers.user("ac001-reader") });
    const behindMiddleware = await app.request("/api/user-only");
    expect(behindMiddleware.status).toBe(200);
    expect(await behindMiddleware.json()).toStrictEqual({ id: "ac001-reader", level: "user" });
    const viaCall = await app.request("/api/current");
    expect(viaCall.status).toBe(200);
    expect(((await viaCall.json()) as { id: unknown }).id).toBe("ac001-reader");
  });
});

describe("AUTH route protection", () => {
  it(tag("AUTH-AC-004", "requireUser(): anonymous 401 AUTH.UNAUTHENTICATED; user and admin pass"), async () => {
    const anonymous = await newApp();
    await expectError(await anonymous.request("/api/user-only"), "AUTH.UNAUTHENTICATED");
    const asAnon = anonymous.as(mockUsers.anonymous);
    await expectError(await asAnon.request("/api/user-only"), "AUTH.UNAUTHENTICATED");

    const user = anonymous.as(mockUsers.user("ac004-user"));
    const resU = await user.request("/api/user-only");
    expect(resU.status).toBe(200);
    expect(await resU.json()).toStrictEqual({ id: "ac004-user", level: "user" });

    const admin = anonymous.as(mockUsers.admin("ac004-admin"));
    const resAd = await admin.request("/api/user-only");
    expect(resAd.status).toBe(200);
    expect(await resAd.json()).toStrictEqual({ id: "ac004-admin", level: "admin" });
  });

  it(tag("AUTH-AC-004", "requireAdmin(): anonymous 401 AUTH.UNAUTHENTICATED; user 403 AUTH.FORBIDDEN; admin passes"), async () => {
    const app = await newApp();
    await expectError(await app.as(mockUsers.anonymous).request("/api/admin-only"), "AUTH.UNAUTHENTICATED");
    await expectError(await app.as(mockUsers.user("ac004-u")).request("/api/admin-only"), "AUTH.FORBIDDEN");
    const res = await app.as(mockUsers.admin("ac004-a")).request("/api/admin-only");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ id: "ac004-a", level: "admin" });
  });

  it(tag("AUTH-AC-004", "requireCurrentUser(c) returns the logged-in user and throws AUTH.UNAUTHENTICATED when anonymous"), async () => {
    const app = await newApp();
    await expectError(await app.as(mockUsers.anonymous).request("/api/current"), "AUTH.UNAUTHENTICATED");
    for (const level of ["user", "admin"] as const) {
      const res = await app.as(mockUsers[level](`ac004-cur-${level}`)).request("/api/current");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["id"]).toBe(`ac004-cur-${level}`);
      expect(body["level"]).toBe(level);
    }
  });
});
